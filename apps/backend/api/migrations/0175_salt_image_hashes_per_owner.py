"""Give every Photo an image hash salted with its own owner's id (#1957).

``Photo.image_hash`` is the file's MD5 with the owner's user id appended, so
that two users holding the same bytes get two different keys. A path in two
users' scan scope has a single File row, though, hashed for whoever scanned it
first, and the scan used to copy that hash onto the second user's Photo as
well. Both rows then answered to one hash: ``/media/...`` resolved it to
either of them, the face crops of both were named after it, and so were the
thumbnails, which a rotation by one user rebuilt for both.

Every Photo whose hash carries another user's id gets its owner's id instead,
and ``last_modified`` moves on so synced clients pick the new hash up. What is
named after the hash comes along:

* thumbnails: the files are copied to the new name and the Thumbnail row points
  at the copies. The old files are still the other user's, so they are only
  removed once nothing refers to them any more;
* face crops: the same, for every face of the photo;
* the similarity index is rebuilt from the database at container start
  (``build_similarity_index``), and a cached video conversion is made again
  under the new name on the next play.

A file that cannot be copied leaves its row pointing at the old file, which
still serves; regenerating thumbnails or rescanning faces makes new ones.
Photos of the ``deleted`` placeholder user keep their hashes: they carry the
ids of the accounts that were deleted, and nobody signs in to see them. A
photo whose new hash is already taken is left alone and logged.

Reversing is a no-op: a hash salted with its owner's id is what the earlier
code made for every upload, so it runs on these rows unchanged.

Self-contained on purpose: a migration must not import application code that
may move or change after it ships.
"""

import logging
import os
import shutil
from functools import partial

from django.conf import settings
from django.db import migrations, transaction
from django.db.models import Q
from django.utils import timezone

logger = logging.getLogger(__name__)

MD5_HEX_LENGTH = 32
HEX_DIGITS = frozenset("0123456789abcdef")
DELETED_USERNAME = "deleted"
THUMBNAIL_FIELDS = ("thumbnail_big", "square_thumbnail", "square_thumbnail_small")


def owner_salted(image_hash, owner_id):
    """``image_hash`` salted for ``owner_id``, or None when it already is.

    None too for a hash that is not an MD5 followed by a user id: nothing
    here knows what such a hash was made from.
    """
    content = image_hash[:MD5_HEX_LENGTH]
    salt = image_hash[MD5_HEX_LENGTH:]
    if len(content) != MD5_HEX_LENGTH or not set(content) <= HEX_DIGITS:
        return None
    if not (salt.isascii() and salt.isdigit()) or salt == str(owner_id):
        return None
    return content + str(owner_id)


def _renamed(name, old_hash, new_hash):
    """``name`` with the leading ``old_hash`` of its file name replaced.

    The directory part is kept as stored, separator included.
    """
    base = os.path.basename(name)
    rest = base[len(old_hash) :]
    if not base.startswith(old_hash) or rest[:1] not in (".", "_"):
        return None
    return name[: len(name) - len(base)] + new_hash + rest


def _copy_media_file(name, new_name):
    """Copy a file under MEDIA_ROOT; True when ``new_name`` exists afterwards."""
    source = os.path.join(settings.MEDIA_ROOT, name)
    target = os.path.join(settings.MEDIA_ROOT, new_name)
    if os.path.exists(target):
        return True
    if not os.path.isfile(source):
        return False
    try:
        shutil.copyfile(source, target)
    except OSError as error:
        logger.warning(f"Could not copy {source} to {target}: {error}")
        return False
    return True


def _remove_unreferenced_thumbnail(Thumbnail, Photo, name, old_hash):
    """Delete a thumbnail file once no row names it or would reuse it."""
    if (
        Thumbnail.objects.filter(
            Q(thumbnail_big=name)
            | Q(square_thumbnail=name)
            | Q(square_thumbnail_small=name)
        ).exists()
        # Thumbnails are found by name: a photo still holding the hash makes
        # its next generate_thumbnail reuse the file instead of rebuilding it.
        or Photo.objects.filter(image_hash=old_hash).exists()
    ):
        return
    _remove_media_file(name)


def _remove_unreferenced_face_crop(Face, name):
    """Delete a face crop once no face names it."""
    if not Face.objects.filter(image=name).exists():
        _remove_media_file(name)


def _remove_media_file(name):
    try:
        os.remove(os.path.join(settings.MEDIA_ROOT, name))
    except OSError:
        pass


def _move_thumbnails(Thumbnail, Photo, photo_id, old_hash, new_hash, cleanups):
    thumbnail = Thumbnail.objects.filter(photo_id=photo_id).first()
    if thumbnail is None:
        return
    changed = []
    for field in THUMBNAIL_FIELDS:
        name = getattr(thumbnail, field).name
        new_name = _renamed(name, old_hash, new_hash) if name else None
        if new_name and _copy_media_file(name, new_name):
            setattr(thumbnail, field, new_name)
            changed.append(field)
            cleanups.append(
                partial(
                    _remove_unreferenced_thumbnail, Thumbnail, Photo, name, old_hash
                )
            )
    if changed:
        thumbnail.save(update_fields=changed)


def _move_face_crops(Face, photo_id, old_hash, new_hash, cleanups):
    for face in Face.objects.filter(photo_id=photo_id).exclude(image=""):
        name = face.image.name
        new_name = _renamed(name, old_hash, new_hash) if name else None
        if new_name and _copy_media_file(name, new_name):
            Face.objects.filter(pk=face.pk).update(image=new_name)
            cleanups.append(partial(_remove_unreferenced_face_crop, Face, name))


def _photos_to_resalt(Photo):
    rows = (
        Photo.objects.exclude(owner__username=DELETED_USERNAME)
        .exclude(owner__isnull=True)
        .values_list("pk", "image_hash", "owner_id")
        .iterator(chunk_size=2000)
    )
    for pk, image_hash, owner_id in rows:
        new_hash = owner_salted(image_hash or "", owner_id)
        if new_hash is not None:
            yield pk, image_hash, new_hash


def salt_image_hashes_per_owner(apps, schema_editor):
    Photo = apps.get_model("api", "Photo")
    Thumbnail = apps.get_model("api", "Thumbnail")
    Face = apps.get_model("api", "Face")

    resalted = 0
    taken = set()
    # The old files are removed once the new names are committed.
    cleanups = []
    for pk, old_hash, new_hash in list(_photos_to_resalt(Photo)):
        if new_hash in taken or Photo.objects.filter(image_hash=new_hash).exists():
            logger.warning(
                f"Photo {pk}: {new_hash} is taken, keeping the hash {old_hash}"
            )
            continue
        taken.add(new_hash)
        Photo.objects.filter(pk=pk).update(
            image_hash=new_hash, last_modified=timezone.now()
        )
        _move_thumbnails(Thumbnail, Photo, pk, old_hash, new_hash, cleanups)
        _move_face_crops(Face, pk, old_hash, new_hash, cleanups)
        resalted += 1

    for cleanup in cleanups:
        transaction.on_commit(cleanup)
    print(f"Salted the image hash of {resalted} photo(s) with their owner's id.")


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0174_user_rating_mode"),
    ]

    operations = [
        migrations.RunPython(salt_image_hashes_per_owner, migrations.RunPython.noop),
    ]
