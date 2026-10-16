"""
File and Photo creation handlers.

This module contains functions for creating File records and grouping
them into Photo objects.
"""

import datetime
import logging
import os
import tempfile
from functools import partial
from uuid import UUID

from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from api.directory_watcher.file_grouping import (
    FILE_TYPE_PRIORITY,
    find_matching_image_for_video,
    find_matching_jpeg_photo,
    get_file_grouping_key,
    get_sidecar_grouping_keys,
    select_main_file,
)
from api.directory_watcher.utils import is_job_cancelled, update_scan_counter
from api.duplicates.perceptual_hash import (
    calculate_hash_from_thumbnail,
    calculate_perceptual_hash,
)
from api.metadata import photo_reader, takeout
from api.metadata.photo_datetime import extract_date_time
from api.models import File, LongRunningJob, Person, Photo, Thumbnail, User
from api.models.file import content_hash, hash_for_owner, hash_owner_part
from api.models.photo import PhotoQuerySet
from api.models.photo_search import PhotoSearch
from api.photos import indexed_mtimes
from api.photos.file_cleanup import delete_thumbnail_files
from api.photos.media_files import (
    calculate_hash,
    detect_file_type,
    get_or_create_file,
    is_metadata,
    is_raw,
    is_valid_media,
    is_video,
    looks_like_media,
)
from api.runtime.features import feature_enabled
from api.stacks.live_photo import (
    extract_embedded_motion_video,
    has_embedded_motion_video,
)
from api.thumbnails import render
from api.thumbnails.render import render_big_thumbnail_to
from api.video import color, transcode_cache

logger = logging.getLogger(__name__)


def _content_changed(stored_hash: str, disk_hash: str) -> bool:
    """Do these two hashes mean "same path, different bytes"?

    Only the content part may be compared: a File has no owner and
    ``calculate_hash`` appends the user id, so the same bytes hash differently
    per user and a second user scanning a path the first one already indexed
    would otherwise look like an endless replacement.
    """
    return content_hash(stored_hash) != content_hash(disk_hash)


def _remove_file(path: str) -> None:
    if path and os.path.exists(path):
        try:
            os.remove(path)
        except OSError:
            logger.error("could not remove stale file %s", path)


# What a byte change costs the photos holding the file.
SAME_PICTURE = "same_picture"  # bookkeeping only
NEW_PICTURE = "new_picture"  # everything derived from the old one goes
UNCOMPARABLE = "uncomparable"  # rebuild what is cheap, keep what was labelled


def _rendered_perceptual_hash(
    path: str,
    local_orientation: int,
    legacy: bool = False,
    height: int | None = None,
) -> str | None:
    """The perceptual hash of ``path`` as ``_process_photo`` would record it.

    ``Photo.perceptual_hash`` is taken from the big thumbnail rather than the
    original, so the candidate has to go through the same resize to be
    comparable: ``height`` is that of the indexed big thumbnail, which
    BIG_THUMBNAIL_HEIGHT may no longer match. ``legacy`` renders it as older
    releases did. Returns None when no comparison is possible.
    """
    if is_video(path):
        return None
    try:
        with tempfile.TemporaryDirectory() as tmp:
            rendered = os.path.join(tmp, "candidate.webp")
            render_big_thumbnail_to(
                path, rendered, local_orientation, legacy, height=height
            )
            return calculate_perceptual_hash(rendered)
    except Exception:
        logger.exception("could not render %s to compare it with the index", path)
        return None


def _picture_verdict(photo: Photo | None, path: str) -> str:
    """Did the picture change with the bytes, stay the same, or can't we tell?

    Rewriting a rating or a face region into the original changes the bytes
    while leaving the picture alone, and so does any other tool that edits the
    metadata in place. Those must not cost the photo its faces and its place in
    the timeline, so the stored perceptual hash decides.

    Videos have no cheap perceptual hash here, a photo that never got one has
    nothing to compare against, and a photo that still carries a LibrePhotos
    rotation in ``local_orientation`` cannot be compared either: whether the
    file's own EXIF carries that rotation too depends on the format and on when
    it was rotated, so rendering it again may apply the rotation twice and the
    two sides would disagree about orientation rather than about the picture.
    Guessing either way is wrong in those cases, so the two halves of the
    decision are split: what is cheap to rebuild is rebuilt, and what a person
    may have corrected by hand is kept.

    A MEDIA_FILE rotate of a format that renders its EXIF orientation moves the
    rotation into the file and resets ``local_orientation`` to 1
    (``api.metadata.photo_writer._fold_rotation_into_file``), so those photos do take the
    comparison.
    """
    if photo is None or not photo.perceptual_hash or photo.local_orientation != 1:
        return UNCOMPARABLE
    stored = photo.perceptual_hash
    indexed = render.big_thumbnail_size(photo.image_hash)
    candidate = _rendered_perceptual_hash(
        path, photo.local_orientation, height=indexed[1] if indexed else None
    )
    if candidate == stored:
        return SAME_PICTURE
    # The photo may have been indexed before thumbnails were rendered the way
    # they are now, and a hash taken from that render flips a few bits.
    legacy = _rendered_perceptual_hash(path, photo.local_orientation, legacy=True)
    if legacy == stored:
        return SAME_PICTURE
    if candidate is None or legacy is None:
        return UNCOMPARABLE
    return NEW_PICTURE


def _keyed_on(photos: PhotoQuerySet, file_hash: str) -> PhotoQuerySet:
    """The photos whose image hash was taken from ``file_hash``'s content.

    Each holds its owner's salt (``hash_for_owner``), so only the content part
    is compared.
    """
    return photos.filter(image_hash__startswith=content_hash(file_hash))


def _photo_to_compare(
    affected: PhotoQuerySet, user: User, old_hash: str
) -> Photo | None:
    """The photo whose perceptual hash answers for this file.

    The scanning user's own row first. A file can be indexed by one user and
    scanned into another's library later, so fall back to any other row that
    actually has a hash to compare against rather than giving up on the
    comparison and re-deriving for everyone.
    """
    keyed = _keyed_on(affected, old_hash)
    scanned = keyed.owned_by(user).first()
    if scanned and scanned.perceptual_hash:
        return scanned
    return (
        keyed.exclude(perceptual_hash__isnull=True).exclude(perceptual_hash="").first()
        or scanned
    )


def _discard_embedded_media(file: File) -> None:
    """Drop the motion videos extracted from a file that is about to change.

    ``_attach_embedded_motion_video`` only runs when a Photo is created, so a
    replaced Live Photo would otherwise keep serving the motion video of the
    picture that is gone and never extract the new one.
    """
    for embedded in list(file.embedded_media.all()):
        file.embedded_media.remove(embedded)
        for photo in Photo.objects.filter(files=embedded):
            photo.files.remove(embedded)
        embedded_path = embedded.path
        embedded.delete()
        transaction.on_commit(partial(_remove_file, embedded_path))


def _discard_faces(photo: Photo) -> None:
    """Delete the face crops of a replaced picture and repair the people they fed.

    The crops are named after the image hash and are served by parsing it back
    out of the file name, so they cannot survive the hash moving. Deleting the
    rows leaves the people counts and covers describing faces that no longer
    exist, so both are recomputed here. The new picture's faces are found by
    the next incremental Scan Faces, which covers photos not scanned (#2199).
    """
    persons = set(
        Person.objects.filter(
            Q(faces__photo=photo)
            | Q(classification_faces__photo=photo)
            | Q(cluster_faces__photo=photo)
            | Q(cover_photo=photo)
        ).distinct()
    )

    photo.faces.all().delete()
    photo.faces_scanned_at = None
    Photo.objects.filter(pk=photo.pk).update(faces_scanned_at=None)

    for person in persons:
        if person.cover_photo_id == photo.pk:
            person.cover_photo = None
            person.cover_face = None
            person.save(update_fields=["cover_photo", "cover_face"])
        if person.cluster_owner_id:
            person._calculate_face_count()
        person._set_default_cover_photo()


def _discard_cheap_derived_content(photo: Photo, old_hash: str) -> None:
    """Drop what the new bytes certainly invalidate and nothing else.

    The cached transcode is named after the image hash and the dominant colour
    was sampled from the picture; both are cheap to rebuild and wrong to keep.
    """
    transcode_cache.discard(old_hash)

    thumbnail = getattr(photo, "thumbnail", None)
    if thumbnail:
        thumbnail.dominant_color = None
        thumbnail.save(update_fields=["dominant_color"])


def _discard_derived_content(photo: Photo, old_hash: str) -> None:
    """Throw away everything that still describes the picture that was replaced.

    The thumbnails are named after the old image hash, so they go with it.
    """
    _discard_cheap_derived_content(photo, old_hash)
    _discard_faces(photo)

    transaction.on_commit(partial(delete_thumbnail_files, old_hash))


def _regenerate_thumbnails(photo: Photo) -> None:
    """Rebuild a photo's thumbnails, and with them its perceptual hash.

    Every photo holding the changed file needs this, not just the scanning
    user's: the File row is shared between users who scan the same directory,
    and the other user's photo would otherwise keep showing the old picture.
    """
    try:
        if photo.video:
            # The stored colour fields describe the bytes that were replaced;
            # the poster frame and the animated thumbnails decide whether to
            # tonemap from them, so the new bytes are asked first.
            color.record(photo)
        thumbnail, _ = Thumbnail.objects.get_or_create(photo=photo)
        render.regenerate_thumbnails(thumbnail)
    except Exception:
        logger.warning(
            "could not regenerate thumbnails for photo %s (%s)",
            photo.pk,
            photo.image_hash,
            exc_info=True,
        )


def reindex_replaced_file(user: User, path: str, hash_value: str) -> Photo | None:
    """Re-point the rows of ``path`` at its new content after an in-place change.

    ``get_or_create_file`` matches on path alone, so a file whose bytes changed under
    the same name keeps its old hash forever. Every derived artefact is keyed
    on ``Photo.image_hash`` - thumbnails are only generated when no file named
    after it exists yet - so the library would keep showing the picture that is
    no longer there.

    Bytes changing and the picture changing are two different things. When the
    perceptual hash says the picture is the same (a metadata write, ours or
    anyone else's), this is pure bookkeeping: the File row moves onto the new
    hash and nothing else is touched. Only a picture that really changed costs
    the photo its derived content. When the two cannot be compared at all, the
    thumbnails and the cached transcode are rebuilt but the faces stay.

    The Photo rows survive with their ids, albums and shares in every case.

    Returns the Photo the changed file is the main file of, if any.
    """
    existing = File.objects.filter(path=path).first()
    if existing is None or not _content_changed(existing.hash, hash_value):
        return None

    if hash_owner_part(existing.hash) != hash_owner_part(hash_value):
        logger.info(
            "%s is indexed under another user's hash, leaving it to their scan", path
        )
        return None

    if File.objects.filter(hash=hash_value).exists():
        logger.error(
            "changed file %s matches an already indexed file, not re-indexing", path
        )
        return None

    old_hash = existing.hash

    # Every photo holding this file, whoever owns it: the File row is shared
    # between users who scan the same directory. A deleted photo keeps its
    # image_hash and its faces with no file attached, so it must not be swept
    # in by the hash alone.
    affected = (
        Photo.objects.filter(
            Q(files=existing)
            | Q(main_file=existing)
            | (Q(image_hash=old_hash) & Q(main_file__isnull=False))
        )
        .exclude(removed=True)
        .distinct()
    )
    photo_ids = set(affected.values_list("pk", flat=True))
    main_photo_ids = set(
        Photo.objects.filter(main_file=existing).values_list("pk", flat=True)
    )

    verdict = _picture_verdict(_photo_to_compare(affected, user, old_hash), path)
    logger.info(
        "content of %s changed (%s), re-keying as %s", path, verdict, hash_value
    )

    main_photo: Photo | None = None
    rebuild_photo_ids: list[UUID] = []
    with transaction.atomic():
        if verdict == NEW_PICTURE:
            _discard_embedded_media(existing)
        new_file = existing.rekey(hash_value, detect_file_type(existing.path))

        # Re-read the rows: ``rekey`` has moved their main_file across, so the
        # instances fetched before it still carry the deleted hash. Each
        # photo's derived files are named after its own image hash, which
        # carries its owner's salt rather than the File's (#1957).
        for photo in Photo.objects.filter(pk__in=photo_ids):
            if photo.pk in main_photo_ids and photo.owner_id == user.id:
                main_photo = photo
            if verdict == SAME_PICTURE or _content_changed(photo.image_hash, old_hash):
                continue
            photo_hash = photo.image_hash
            if verdict == UNCOMPARABLE:
                # The picture may or may not have changed, so the thumbnails
                # are rebuilt in place, under the image hash the face crops
                # are named after, and nothing labelled is thrown away.
                _discard_cheap_derived_content(photo, photo_hash)
                rebuild_photo_ids.append(photo.pk)
                continue
            _discard_derived_content(photo, photo_hash)
            photo.image_hash = hash_for_owner(hash_value, photo.owner_id)
            photo.added_on = timezone.now()
            photo.save()
            rebuild_photo_ids.append(photo.pk)

    for photo in Photo.objects.filter(pk__in=rebuild_photo_ids):
        _regenerate_thumbnails(photo)

    if verdict == NEW_PICTURE and main_photo:
        _attach_embedded_motion_video(user, main_photo, new_file)

    return main_photo


def create_file_record(user: User, path: str) -> File | None:
    """
    Phase 1: Create a File record for a path without creating/grouping Photos.

    This is the first phase of the two-phase scan architecture:
    - Phase 1: Create File records for all discovered files (this function)
    - Phase 2: Group files into Photos by (directory, basename)

    This separation eliminates race conditions where concurrent processing
    of RAW and JPEG files could create separate Photos instead of grouping them.

    Args:
        user: The owner of the file
        path: The file path

    Returns:
        File object if created/found, None if invalid media
    """
    if not is_valid_media(path=path, user=user):
        return None

    hash_value = calculate_hash(user, path)

    # Skip if this is embedded media (already attached to another file)
    if File.embedded_media.through.objects.filter(Q(to_file_id=hash_value)).exists():
        logger.warning("embedded content file found %s", path)
        return None

    reindex_replaced_file(user, path, hash_value)

    # Create the File record (File.create handles race conditions via unique path constraint)
    file = get_or_create_file(path, user, hash_value)
    return file


def _attach_embedded_motion_video(user: User, photo: Photo, file: File) -> File | None:
    """Extract a Google/Samsung Live Photo motion video and attach it as a variant."""
    if not (
        has_embedded_motion_video(file.path)
        and settings.FEATURE_PROCESS_EMBEDDED_MEDIA
        and feature_enabled("VIDEO")
    ):
        return None

    em_path = extract_embedded_motion_video(file.path, file.hash)
    if not em_path:
        return None

    em_file = get_or_create_file(em_path, user)
    file.embedded_media.add(em_file)
    photo.files.add(em_file)
    return em_file


def _adopt_files_into_photo(
    photo: Photo, files: list[File], main_file: File, job_id: UUID | str
) -> None:
    """Attach missing files to an existing Photo and upgrade its main_file."""
    for f in files:
        if not photo.files.filter(hash=f.hash).exists():
            photo.files.add(f)
            logger.info(
                "job %s: Attached file %s to existing Photo %s",
                job_id,
                f.path,
                photo.image_hash,
            )

    if not photo.main_file:
        return

    current_priority = FILE_TYPE_PRIORITY.get(photo.main_file.type, 999)
    if FILE_TYPE_PRIORITY.get(main_file.type, 999) < current_priority:
        photo.main_file = main_file
        photo.save(update_fields=["main_file"])


def group_files_into_photo(
    user: User, files: list[File], job_id: UUID | str
) -> Photo | None:
    """
    Phase 2: Group a list of related files into a single Photo.

    Creates a new Photo with the given files as variants, selecting the
    best file as main_file based on type priority (IMAGE > VIDEO > RAW > METADATA).

    This function should be called with all files that share the same
    (directory, basename) - e.g., IMG_001.jpg, IMG_001.CR2, IMG_001.xmp.

    Args:
        user: The owner of the photo
        files: List of File objects to group (must not be empty)
        job_id: Job ID for logging

    Returns:
        The created Photo, or None if no valid files
    """
    if not files:
        return None

    # Filter out metadata files for main photo creation - they're sidecars
    non_metadata_files = [f for f in files if f.type != File.METADATA_FILE]

    if not non_metadata_files:
        # Only metadata files - no photo to create
        logger.warning("job %s: Only metadata files in group, skipping", job_id)
        return None

    # Select main file based on priority
    main_file = select_main_file(non_metadata_files)
    if not main_file:
        return None

    # Check if a Photo already exists with any of these files. Matching on
    # main_file as well as the files m2m re-adopts photos whose file went
    # missing and reappeared: detach_missing_files detaches a missing file from the
    # m2m but keeps main_file pointing at it, so without that match a
    # reappearing file would spawn a duplicate Photo with the same image_hash.
    # Sidecars are left out of the match: File rows are keyed by content hash,
    # so byte-identical XMPs of two different photos share a single row.
    # When an earlier run left the group as several photos (a RAW uploaded
    # before its JPEG), the one whose main file is the group's wins: adopting
    # into the RAW's photo would make it a second photo of the JPEG, which
    # the repair job no longer touches. The repair job merges the rest.
    matching = Photo.objects.owned_by(user).filter(
        Q(files__in=non_metadata_files) | Q(main_file__in=non_metadata_files)
    )
    # The File may carry the salt of another user who scanned the path first.
    image_hash = hash_for_owner(main_file.hash, user.id)
    existing_photo = (
        matching.filter(main_file=main_file).first()
        or matching.first()
        # The same bytes under another path: a shared File holds the other
        # user's salt, so the user's own copy of it has a File of its own,
        # but it is the same photo to them, as any exact copy is (#1957).
        or Photo.objects.owned_by(user)
        .filter(image_hash=image_hash, removed=False)
        .first()
    )

    if existing_photo:
        _adopt_files_into_photo(existing_photo, files, main_file, job_id)
        return existing_photo

    # Create new Photo
    photo = Photo()
    photo.image_hash = image_hash
    photo.owner = user
    photo.added_on = timezone.now()
    photo.geolocation_json = {}
    photo.video = main_file.type == File.VIDEO
    photo.save()

    # Add all files to the photo
    for f in files:
        photo.files.add(f)

    photo.main_file = main_file
    photo.save()

    if _attach_embedded_motion_video(user, photo, main_file):
        photo.save()

    logger.info(
        "job %s: Created Photo %s with %s file(s)", job_id, photo.image_hash, len(files)
    )
    return photo


def _find_photo_for_sidecar(user: User, path: str) -> Photo | None:
    """The user's Photo holding the media file an XMP sidecar describes.

    Same directory and exactly the same stem, any extension - the scan's
    grouping rule - trying ``IMG_1.jpg.xmp`` as ``IMG_1.jpg.*`` before
    ``IMG_1.*``.
    """
    for key in get_sidecar_grouping_keys(path):
        directory, stem = key
        candidates = (
            Photo.objects.owned_by(user)
            .filter(files__path__istartswith=os.path.join(directory, stem) + ".")
            .order_by("files__path")
            .values_list("pk", "files__path")
        )
        for pk, file_path in candidates:
            if get_file_grouping_key(file_path) == key and not is_metadata(file_path):
                return Photo.objects.get(pk=pk)
    return None


def _attach_metadata_sidecar(user: User, path: str) -> None:
    """Attach an XMP sidecar to the Photo it describes, if one exists."""
    photo = _find_photo_for_sidecar(user, path)

    if not photo:
        logger.warning("no photo to metadata file found %s", path)
        return

    photo.files.add(get_or_create_file(path, user))
    photo.save()


def _attach_file_variant(
    user: User, path: str, photo: Photo, label: str, keep_image: bool = False
) -> Photo:
    """Attach a sibling file to an existing Photo as a variant."""
    if not photo.files.filter(path=path).exists():
        photo.files.add(get_or_create_file(path, user))
        if keep_image:
            photo.video = False
        photo.save()
        logger.info(
            "Attached %s %s to existing Photo %s", label, path, photo.image_hash
        )
    return photo


def _adopt_as_variant(user: User, path: str) -> Photo | None:
    """
    Attach RAW files and Live Photo videos to the image Photo they belong to.

    Returns the adopting Photo, or None when the file stands on its own.
    """
    if is_raw(path):
        photo = find_matching_jpeg_photo(path, user)
        if photo:
            return _attach_file_variant(user, path, photo, "RAW file")

    if is_video(path):
        photo = find_matching_image_for_video(path, user)
        if photo:
            return _attach_file_variant(
                user, path, photo, "Live Photo video", keep_image=True
            )

    return None


def _photo_of_path(user: User, path: str) -> Photo | None:
    """The user's Photo that already holds ``path``, the scan's matching rule.

    Matching on ``main_file`` as well as the files m2m, as
    ``group_files_into_photo`` does, finds a photo whose file went missing and
    came back, and attaches the file to it again. Without it a second call for an indexed path built a second
    Photo on the same File (#2257).
    """
    photo = (
        Photo.objects.owned_by(user)
        .filter(Q(files__path=path) | Q(main_file__path=path))
        .order_by("added_on")
        .first()
    )
    if photo is not None and not photo.files.filter(path=path).exists():
        # Back after it was flagged missing: get_or_create_file clears the
        # flag, and the photo holds the file again.
        photo.files.add(get_or_create_file(path, user))
    return photo


def create_new_image(user: User, path: str) -> Photo | None:
    """
    Creates a new Photo object based on user input and file path.

    This is the legacy single-file creation function, kept for backwards
    compatibility with upload handling. For scan operations, use the
    two-phase approach (create_file_record + group_files_into_photo).

    Args:
        user: The owner of the photo.
        path: The file path of the image.

    Returns:
        The created Photo object if successful, otherwise returns None.

    Note:
        This function implements file variant grouping (PhotoPrism-like):
        - RAW files are attached to existing JPEG Photos as file variants
        - Live Photo videos (.mov) are attached to existing image Photos as file variants
        - A path the user already has a Photo for returns that Photo
        - Other files create new Photo entities
    """
    if not is_valid_media(path=path, user=user):
        return None
    hash_value = calculate_hash(user, path)
    if File.embedded_media.through.objects.filter(Q(to_file_id=hash_value)).exists():
        logger.warning("embedded content file found %s", path)
        return None

    if is_metadata(path):
        _attach_metadata_sidecar(user, path)
        return None

    replaced_photo = reindex_replaced_file(user, path, hash_value)
    if replaced_photo:
        return replaced_photo

    existing_photo = _photo_of_path(user, path) or _adopt_as_variant(user, path)
    if existing_photo:
        return existing_photo

    # === Standard Photo Creation ===
    photo = Photo()
    photo.image_hash = hash_value
    photo.owner = user
    photo.added_on = timezone.now()
    photo.geolocation_json = {}
    photo.video = is_video(path)
    photo.save()
    file = get_or_create_file(path, user)

    _attach_embedded_motion_video(user, photo, file)

    photo.files.add(file)
    photo.main_file = file
    photo.save()
    return photo


def apply_device_timestamp_fallback(
    photo: Photo | None,
    device_created_at: datetime.datetime | None,
) -> Photo | None:
    """Fallback timestamp for EXIF-less uploads (doc 04 §5, issue #614).

    Mobile clients know when a photo was taken even when the file carries no
    EXIF date (screenshots, images stripped by messengers, some formats). The
    upload endpoint forwards the device's ``device_created_at``; if the normal
    EXIF extraction found no date, adopt it as the photo's timestamp.

    ``device_created_at`` is the local wall clock labelled UTC, like every
    stored capture time (``api.views.upload.parse_device_timestamp``). Runs after ``handle_new_image`` so it can see the extraction
    result; feeding the value through ``timestamp`` makes it the photo's date
    and builds the date album, exactly as a manual correction would.
    """
    if photo is None or device_created_at is None:
        return photo
    try:
        photo.refresh_from_db()
    except Photo.DoesNotExist:
        return photo
    # Only fill a gap; never override a date the file actually carried.
    if photo.exif_timestamp is not None:
        return photo
    photo.timestamp = device_created_at
    extract_date_time(photo, commit=True)
    return photo


def _observe_media(paths: list[str]) -> dict[str, indexed_mtimes.Observed]:
    """What is on disk now for the media files among ``paths``, before they are read.

    Taken before the read, so an edit made while the photo is processed
    leaves a record older than the file and the next scan reads it again.
    """
    return {
        path: indexed_mtimes.observe(path) for path in paths if not is_metadata(path)
    }


def _record_read(observed: dict[str, indexed_mtimes.Observed]) -> None:
    """Record ``observed`` as what the scan read of these files (#2296)."""
    for path, seen in observed.items():
        indexed_mtimes.record(path, seen)


def handle_new_image(
    user: User, path: str, job_id: UUID | str, photo: Photo | None = None
) -> None:
    """
    Handles the creation and all the processing of the photo needed for it to be displayed.

    Args:
        user: The owner of the photo.
        path: The file path of the image.
        job_id: The long-running job id, which gets updated when the task runs
        photo: An optional parameter, where you can input a photo instead of creating a new one. Used for uploading.

    Note:
        This function is used when uploading a picture, because rescanning does not perform machine learning tasks.
    """
    error = None
    try:
        if is_job_cancelled(job_id):
            logger.info("job %s was cancelled, skipping %s", job_id, path)
            return
        start = datetime.datetime.now()
        observed = _observe_media([path])
        if photo is None:
            photo = create_new_image(user, path)
            elapsed = (datetime.datetime.now() - start).total_seconds()
            logger.info("job %s: save image: %s, elapsed: %s", job_id, path, elapsed)
        if photo:
            _process_photo(photo, path, job_id, start)
            _record_read(observed)

    except Exception as e:
        error = _describe_failure(path, e)
        try:
            logger.exception(
                "job %s: could not load image %s. reason: %s", job_id, path, str(e)
            )
        except Exception:
            logger.exception("job %s: could not load image %s", job_id, path)
    finally:
        update_scan_counter(job_id, failed=error is not None, error=error)


def _collect_file_records(user: User, file_paths: list[str]) -> list[File]:
    """Create File records for every valid path in a group."""
    files: list[File] = []
    for path in file_paths:
        file = create_file_record(user, path)
        if file:
            files.append(file)
    return files


def _only_copies(file_paths: list[str], files: list[File]) -> bool:
    """True when every file of the group is a row kept at another path.

    ``get_or_create_file`` hands an exact copy the row of the file it copies,
    which keeps its own path, so none of the group's paths is a row's path.
    """
    return not {file.path for file in files} & set(file_paths)


def _describe_failure(path: str, error: Exception) -> str:
    # The path is part of the text because update_scan_counter de-duplicates
    # the errors list by exact string, and one dropped mount reports the same
    # errno for every file it swallowed.
    return f"{path}: {error}"


def _log_file_group_failure(
    job_id: UUID | str, file_paths: list[str], error: Exception
) -> None:
    try:
        logger.exception(
            "job %s: could not process file group %s. reason: %s",
            job_id,
            file_paths,
            str(error),
        )
    except Exception:
        logger.exception("job %s: could not process file group", job_id)


def handle_file_group(
    user: User,
    file_paths: list[str],
    job_id: UUID | str,
    rebuild_thumbnails: bool = False,
) -> None:
    """
    Phase 2 handler: Process a group of related files into a single Photo.

    This is called after Phase 1 has created File records for all paths.
    Files are grouped by (directory, basename) so RAW+JPEG pairs are processed together.

    A Google Takeout JSON among ``file_paths`` (Phase 1 matched it against the
    whole directory, #2270) is read for the photo and is not one of its files.
    No other one is looked for, so the directory is not listed again.

    Args:
        user: The owner of the files
        file_paths: List of file paths that share the same (directory, basename)
        job_id: Job ID for logging and progress tracking
        rebuild_thumbnails: Render the photo's thumbnails again, also the
            ones that exist (a rescan of chosen photos, #2214)
    """
    takeout_names = [
        os.path.basename(path)
        for path in file_paths
        if takeout.is_takeout_candidate(path)
    ]
    media_paths = [
        path for path in file_paths if not takeout.is_takeout_candidate(path)
    ]
    known = {os.path.dirname(path): takeout_names for path in media_paths}
    with takeout.directory_listings(known):
        _handle_media_group(user, media_paths, job_id, rebuild_thumbnails)


def _handle_media_group(
    user: User,
    file_paths: list[str],
    job_id: UUID | str,
    rebuild_thumbnails: bool = False,
) -> None:
    """``handle_file_group`` for the group's media files and XMP sidecars."""
    error = None
    try:
        # Cancelling a scan does not take the groups the cluster has already
        # pulled off the queue back, so each one checks the flag itself and
        # only counts toward the target (#2198).
        if is_job_cancelled(job_id):
            logger.info("job %s was cancelled, skipping a file group", job_id)
            return
        start = datetime.datetime.now()
        observed = _observe_media(file_paths)

        files = _collect_file_records(user, file_paths)
        if not files:
            if not any(looks_like_media(path) for path in file_paths):
                # A RawTherapee .pp3, an Apple .aae: nothing here is a
                # photo, so there is nothing to report as failed.
                logger.info("job %s: ignoring non-media files: %s", job_id, file_paths)
                return
            error = f"No valid files in group: {file_paths}"
            logger.warning("job %s: %s", job_id, error)
            return

        # Group files into a Photo
        photo = group_files_into_photo(user, files, job_id)

        if not photo:
            error = f"Could not create photo for files: {file_paths}"
            logger.warning("job %s: %s", job_id, error)
            return

        elapsed = (datetime.datetime.now() - start).total_seconds()
        logger.info(
            "job %s: created photo with %s files, elapsed: %s",
            job_id,
            len(files),
            elapsed,
        )

        if _only_copies(file_paths, files) and photo.metadata_read_at is not None:
            # Exact copies of a photo already read: nothing about it changed (#2417).
            logger.info(
                "job %s: only copies of photo %s, not re-processing",
                job_id,
                photo.image_hash,
            )
            return

        # Process the photo (thumbnails, EXIF, etc.) using main_file
        if photo.main_file:
            _process_photo(
                photo, photo.main_file.path, job_id, start, rebuild_thumbnails
            )
            _record_read(observed)

    except Exception as e:
        _log_file_group_failure(job_id, file_paths, e)
        error = _describe_failure(", ".join(file_paths), e)
    finally:
        update_scan_counter(job_id, failed=error is not None, error=error)


def _probe_videos_unfinished(user: User) -> bool:
    """Whether a Probe Videos job of ``user``'s is running, or was killed."""
    return LongRunningJob.objects.filter(
        started_by=user, job_type=LongRunningJob.JOB_PROBE_VIDEOS, finished=False
    ).exists()


def _rebuild_made_before_probe(
    photo: Photo,
    thumbnail: Thumbnail,
    fields: list[str],
    job_id: UUID | str,
    path: str,
) -> None:
    """Rebuild a video's thumbnails made before it was probed, then save the probe.

    ``fields`` are the probed values set on ``photo`` but not saved yet. Saved
    last, as Probe Videos does (``processing_jobs._repair_probed_video``): a
    worker killed half-way leaves the video unprobed, so that job tries it
    again and puts its set-aside thumbnails back first.
    """
    # The row get_or_create found would load its photo afresh, without them.
    thumbnail.photo = photo
    transcode_cache.discard(photo.image_hash)
    try:
        render.regenerate_thumbnails(thumbnail, keep_old_on_failure=True)
    except Exception:
        # The old thumbnails are back in place; the rest still runs.
        logger.warning(
            "job %s: could not rebuild the thumbnails of %s",
            job_id,
            path,
            exc_info=True,
        )
    photo.save(update_fields=fields)


def _set_metadata_read_at(photo: Photo, value: datetime.datetime | None) -> None:
    photo.metadata_read_at = value
    Photo.objects.filter(pk=photo.pk).update(metadata_read_at=value)


def _read_metadata(
    photo: Photo, path: str, job_id: UUID | str, start: datetime.datetime
) -> None:
    """Read the file's EXIF and date into the photo; raises ``MetadataReadError``."""
    photo_reader.extract_exif_data(photo, commit=True)
    elapsed = (datetime.datetime.now() - start).total_seconds()
    logger.debug("job %s: extract exif data: %s, elapsed: %s", job_id, path, elapsed)

    # Categorise the photo (screenshot/document) from the freshly extracted
    # metadata. A manual correction ("user") is never overwritten by a rescan.
    # The value is persisted by the full ``photo.save()`` inside the
    # ``extract_date_time`` call immediately below.
    if photo.category_source != "user":
        from api.classification.screenshots import classify

        photo.is_screenshot = classify(photo)

    extract_date_time(photo, True)
    elapsed = (datetime.datetime.now() - start).total_seconds()
    logger.debug("job %s: extract date time: %s, elapsed: %s", job_id, path, elapsed)


def _render_thumbnails(photo: Photo, thumbnail: Thumbnail, rebuild: bool) -> None:
    """Render the photo's missing thumbnails, or with ``rebuild`` all of them.

    A rebuild keeps the old thumbnails when rendering fails, and drops a
    video's cached playable copy, so a rescan of chosen photos (#2214) fixes
    a wrong thumbnail or copy whose file did not change.
    """
    if not rebuild:
        render.generate_thumbnail(thumbnail)
        return
    thumbnail.photo = photo
    if photo.video:
        transcode_cache.discard(photo.image_hash)
    render.regenerate_thumbnails(thumbnail, keep_old_on_failure=True)


def _process_photo(
    photo: Photo,
    path: str,
    job_id: UUID | str,
    start: datetime.datetime,
    rebuild_thumbnails: bool = False,
) -> None:
    """
    Process a photo: generate thumbnails, extract EXIF, calculate hashes, etc.

    This is the common processing logic shared between handle_new_image and handle_file_group.

    Args:
        photo: The Photo object to process
        path: The main file path (for logging)
        job_id: Job ID for logging
        start: Start time for elapsed time calculation
        rebuild_thumbnails: Render every thumbnail again, not only the missing ones
    """
    logger.info("job %s: handling image %s", job_id, path)

    # Create or get thumbnail instance
    thumbnail, created = Thumbnail.objects.get_or_create(photo=photo)

    # Before the thumbnails, which read it: the poster frame and both animated
    # thumbnails need to know whether to tonemap. Every time, not only when the
    # fields are empty -- a rescanned video may be a new file under the old path.
    rebuild_fields = None
    if photo.video:
        # A video indexed before it was probed may have washed-out or
        # unplayable thumbnails and cached copy. Probe Videos repairs those
        # only for videos still unprobed, which this is about to settle --
        # on a full rescan, for every one of them -- so it is done here.
        made_before_probe = photo.video_color_transfer is None and not created
        if made_before_probe and _probe_videos_unfinished(photo.owner):
            # That job has this video on its list, and two rebuilds of one
            # video at once take each other's set-aside thumbnails. Left
            # unprobed for it, or for the one this scan queues.
            fields = None
        else:
            fields = color.apply_probe(photo)
        if fields and made_before_probe and color.converted_wrongly_before(photo):
            rebuild_fields = fields
        elif fields:
            photo.save(update_fields=fields)
        elapsed = (datetime.datetime.now() - start).total_seconds()
        logger.debug("job %s: probe video: %s, elapsed: %s", job_id, path, elapsed)

    if rebuild_fields:
        _rebuild_made_before_probe(photo, thumbnail, rebuild_fields, job_id, path)
    else:
        _render_thumbnails(photo, thumbnail, rebuild_thumbnails and not created)
    elapsed = (datetime.datetime.now() - start).total_seconds()
    logger.debug("job %s: generate thumbnails: %s, elapsed: %s", job_id, path, elapsed)

    render.calculate_aspect_ratio(thumbnail)
    elapsed = (datetime.datetime.now() - start).total_seconds()
    logger.debug(
        "job %s: calculate aspect ratio: %s, elapsed: %s", job_id, path, elapsed
    )

    # Calculate perceptual hash for duplicate detection
    if thumbnail.thumbnail_big and os.path.exists(thumbnail.thumbnail_big.path):
        phash = calculate_hash_from_thumbnail(thumbnail.thumbnail_big.path)
        if phash:
            photo.perceptual_hash = phash
            photo.save(update_fields=["perceptual_hash"])
            elapsed = (datetime.datetime.now() - start).total_seconds()
            logger.debug(
                "job %s: calculate perceptual hash: %s, elapsed: %s",
                job_id,
                path,
                elapsed,
            )

    try:
        _read_metadata(photo, path, job_id, start)
    except Exception:
        # Read again by the next incremental scan, although the file is known
        # and unchanged by then (#2271).
        _set_metadata_read_at(photo, None)
        raise
    _set_metadata_read_at(photo, timezone.now())

    render.calculate_dominant_color(thumbnail)
    elapsed = (datetime.datetime.now() - start).total_seconds()
    logger.debug("job %s: get dominant color: %s, elapsed: %s", job_id, path, elapsed)

    search_instance, created = PhotoSearch.objects.get_or_create(photo=photo)
    search_instance.recreate_search_captions()
    search_instance.save()
    elapsed = (datetime.datetime.now() - start).total_seconds()
    logger.debug(
        "job %s: search caption recreated: %s, elapsed: %s", job_id, path, elapsed
    )
