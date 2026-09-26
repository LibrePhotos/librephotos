import os
import random
import shutil
import tempfile
import unittest
from unittest.mock import MagicMock, patch

import pyvips
from django.test import TestCase, override_settings
from PIL import Image

from api.directory_watcher.file_handlers import (
    create_file_record,
    group_files_into_photo,
)
from api import binaries
from api.metadata.tags import Tags
from api.metadata.writer import read_orientation, write_metadata
from api.models import File, Person, Photo, Thumbnail, User
from api.models.file import calculate_hash, content_hash
from api.perceptual_hash import calculate_hash_from_thumbnail
from api.tests.utils import create_test_face, create_test_person, create_test_user

THUMBNAIL_DIRS = ("thumbnails_big", "square_thumbnails", "square_thumbnails_small")


def _write_image(path, seed, size=(256, 256), format="PNG"):
    """Write a picture whose perceptual hash depends on ``seed``.

    Blocks of colour rather than a flat fill: pHash reads the low frequencies
    of the image, and every flat image hashes the same whatever its colour.
    """
    rng = random.Random(seed)
    blocks = Image.new("RGB", (8, 8))
    blocks.putdata(
        [
            (rng.randrange(256), rng.randrange(256), rng.randrange(256))
            for _ in range(8 * 8)
        ]
    )
    blocks.resize(size, Image.NEAREST).save(path, format=format)


class ReplacedFileTestCase(TestCase):
    """Shared fixture: a scan directory and a media root that are torn down."""

    def setUp(self):
        self.user = create_test_user()
        self.tmpdir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmpdir, True)
        self.media_root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.media_root, True)
        for directory in THUMBNAIL_DIRS:
            os.makedirs(os.path.join(self.media_root, directory), exist_ok=True)
        media_override = override_settings(MEDIA_ROOT=self.media_root)
        media_override.enable()
        self.addCleanup(media_override.disable)
        self.path = os.path.join(self.tmpdir, "IMG_0001.png")

    def _scan(self, path=None, user=None):
        """Run the two scan phases over a single path, flushing on-commit work."""
        with self.captureOnCommitCallbacks(execute=True):
            file = create_file_record(user or self.user, path or self.path)
            self.assertIsNotNone(file)
            return group_files_into_photo(user or self.user, [file], job_id="test-job")

    def _index(self, path=None, user=None):
        """Scan, then derive what ``_process_photo`` derives from the picture.

        The perceptual hash in particular: it is what tells a rewritten file
        from a replaced one, so a fixture without it would send every test
        down the replacement path.
        """
        photo = self._scan(path, user)
        self._derive(photo)
        return photo

    def _derive(self, photo):
        thumbnail, _ = Thumbnail.objects.get_or_create(photo=photo)
        thumbnail._generate_thumbnail()
        thumbnail._calculate_aspect_ratio()
        photo.perceptual_hash = calculate_hash_from_thumbnail(
            thumbnail.thumbnail_big.path
        )
        photo.save(save_metadata=False, update_fields=["perceptual_hash"])

    def _thumbnail_path(self, photo_hash, directory="thumbnails_big"):
        return os.path.join(self.media_root, directory, photo_hash + ".webp")


class ReplacedFileRescanTest(ReplacedFileTestCase):
    """A file replaced in place (same path, different picture) must be
    re-indexed with the new content instead of keeping the stale hash."""

    def test_replaced_file_is_reindexed_with_new_content(self):
        _write_image(self.path, 1)
        old_hash = calculate_hash(self.user, self.path)
        photo = self._index()
        self.assertEqual(old_hash, photo.image_hash)

        # The user replaces the file on disk, keeping the same name.
        _write_image(self.path, 2)
        new_hash = calculate_hash(self.user, self.path)
        self.assertNotEqual(old_hash, new_hash)

        rescanned = self._scan()

        self.assertEqual(1, Photo.objects.filter(owner=self.user).count())
        self.assertEqual(1, File.objects.filter(path=self.path).count())
        self.assertEqual(new_hash, File.objects.get(path=self.path).hash)
        self.assertEqual(new_hash, rescanned.image_hash)
        self.assertEqual(new_hash, rescanned.main_file.hash)
        self.assertFalse(File.objects.filter(hash=old_hash).exists())
        self.assertEqual(photo.pk, rescanned.pk)

    def test_thumbnails_are_rebuilt_from_the_new_content(self):
        _write_image(self.path, 1)
        photo = self._index()
        old_hash = photo.image_hash
        self.assertTrue(os.path.exists(self._thumbnail_path(old_hash)))

        _write_image(self.path, 2)
        rescanned = self._scan()

        self.assertFalse(os.path.exists(self._thumbnail_path(old_hash)))
        new_thumbnail_path = self._thumbnail_path(rescanned.image_hash)
        self.assertTrue(os.path.exists(new_thumbnail_path))
        # The rebuilt thumbnail shows the picture that is on disk now.
        self.assertEqual(
            calculate_hash_from_thumbnail(self.path),
            calculate_hash_from_thumbnail(new_thumbnail_path),
        )

    def test_derived_content_of_the_old_picture_is_discarded(self):
        _write_image(self.path, 1)
        photo = self._index()
        old_hash = photo.image_hash
        old_added_on = photo.added_on
        photo.thumbnail.dominant_color = "[1,2,3]"
        photo.thumbnail.save()
        create_test_face(photo=photo)

        _write_image(self.path, 2)
        with patch("api.transcode_cache.discard") as discard:
            rescanned = self._scan()

        discard.assert_called_once_with(old_hash)
        self.assertEqual(0, rescanned.faces.count())
        self.assertIsNone(rescanned.thumbnail.dominant_color)
        # The tag, geolocation and face jobs select on added_on, so the photo
        # has to look new again for them to re-derive anything.
        self.assertGreater(rescanned.added_on, old_added_on)

    def test_unchanged_file_keeps_its_record(self):
        _write_image(self.path, 1)
        photo = self._index()
        file_hash = photo.main_file.hash

        rescanned = self._scan()

        self.assertEqual(photo.pk, rescanned.pk)
        self.assertEqual(file_hash, rescanned.main_file.hash)
        self.assertEqual(1, File.objects.filter(path=self.path).count())

    def test_replacement_with_already_indexed_content_is_left_alone(self):
        _write_image(self.path, 1)
        photo = self._index()
        old_hash = photo.main_file.hash

        other_path = os.path.join(self.tmpdir, "IMG_0002.png")
        _write_image(other_path, 2)
        self._index(other_path)

        # The first file is replaced by a copy of the second one.
        _write_image(self.path, 2)
        self._scan()

        self.assertEqual(old_hash, File.objects.get(path=self.path).hash)
        self.assertEqual(2, Photo.objects.filter(owner=self.user).count())


class ReplacedFacesTest(ReplacedFileTestCase):
    """Face crops are named after the image hash, so they cannot survive a
    replacement. The people they fed have to be repaired with them."""

    def test_people_are_repaired_when_their_faces_are_discarded(self):
        _write_image(self.path, 1)
        photo = self._index()
        keeper_path = os.path.join(self.tmpdir, "IMG_0002.png")
        _write_image(keeper_path, 3)
        keeper = self._index(keeper_path)

        person = create_test_person(cluster_owner=self.user, face_count=2)
        doomed_face = create_test_face(photo=photo, person=person)
        create_test_face(photo=keeper, person=person)
        person.cover_photo = photo
        person.cover_face = doomed_face
        person.save()

        _write_image(self.path, 2)
        rescanned = self._scan()

        self.assertEqual(0, rescanned.faces.count())
        person.refresh_from_db()
        self.assertEqual(1, person.face_count)
        self.assertEqual(keeper.pk, person.cover_photo_id)
        self.assertNotEqual(doomed_face.pk, person.cover_face_id)
        self.assertFalse(Person.objects.filter(pk=person.pk, cover_face=None).exists())


class SharedFileAcrossUsersTest(ReplacedFileTestCase):
    """File rows and thumbnail files are shared between users who scan the
    same directory, so a replacement has to carry every photo holding the
    file across, not just the scanning user's."""

    def test_second_user_scanning_the_same_file_changes_nothing(self):
        _write_image(self.path, 1)
        photo = self._index()
        first_hash = photo.main_file.hash
        first_added_on = photo.added_on

        other_user = create_test_user()
        other_hash = calculate_hash(other_user, self.path)
        self.assertNotEqual(first_hash, other_hash)
        self.assertEqual(content_hash(first_hash), content_hash(other_hash))

        self._scan(user=other_user)

        self.assertEqual(first_hash, File.objects.get(path=self.path).hash)
        photo.refresh_from_db()
        self.assertEqual(first_hash, photo.image_hash)
        self.assertEqual(first_added_on, photo.added_on)

    def test_file_indexed_by_another_user_is_left_to_their_scan(self):
        _write_image(self.path, 1)
        photo = self._index()
        first_hash = photo.main_file.hash

        other_user = create_test_user()
        _write_image(self.path, 2)
        with self.captureOnCommitCallbacks(execute=True):
            create_file_record(other_user, self.path)

        self.assertEqual(first_hash, File.objects.get(path=self.path).hash)
        photo.refresh_from_db()
        self.assertEqual(first_hash, photo.image_hash)

    def test_the_other_users_photo_still_renders_after_a_replacement(self):
        _write_image(self.path, 1)
        photo = self._index()
        old_hash = photo.image_hash

        other_user = create_test_user()
        other_photo = self._scan(user=other_user)
        self._derive(other_photo)
        self.assertEqual(old_hash, other_photo.image_hash)
        self.assertNotEqual(photo.pk, other_photo.pk)

        # The owner of the directory replaces the picture and rescans.
        _write_image(self.path, 2)
        rescanned = self._scan()

        other_photo.refresh_from_db()
        self.assertEqual(rescanned.image_hash, other_photo.image_hash)
        self.assertTrue(os.path.exists(self._thumbnail_path(other_photo.image_hash)))
        for directory in THUMBNAIL_DIRS:
            self.assertTrue(
                os.path.exists(self._thumbnail_path(other_photo.image_hash, directory)),
                f"{directory} thumbnail missing for the other user's photo",
            )
        self.assertFalse(os.path.exists(self._thumbnail_path(old_hash)))


def _append_a_byte(path, *args, **kwargs):
    """Stand in for exiftool: change the file's bytes without changing the picture."""
    with open(path, "ab") as f:
        f.write(b"\x00")


class MetadataWriteIsNotAReplacementTest(ReplacedFileTestCase):
    """With save_metadata_to_disk=MEDIA_FILE, LibrePhotos rewrites the original
    on every rating or face-tag change. The bytes change but the picture does
    not, so the next scan must re-key the File and nothing else."""

    def setUp(self):
        super().setUp()
        self.user.save_metadata_to_disk = User.SaveMetadata.MEDIA_FILE
        self.user.save()

    def _rate_photo(self, photo, write_metadata_mock):
        """Rate a photo the way the API does, from a row loaded from the DB.

        Photo.save() only writes the tags it sees as modified, which it works
        out from the values the instance was loaded with, so a photo that was
        built in memory would silently write nothing.
        """
        loaded = Photo.objects.get(pk=photo.pk)
        with patch("api.models.photo.write_metadata", write_metadata_mock):
            loaded.rating = 4
            loaded.save()
        return loaded

    def test_rescan_after_our_own_write_only_rekeys_the_file(self):
        _write_image(self.path, 1)
        photo = self._index()
        image_hash = photo.image_hash
        added_on = Photo.objects.get(pk=photo.pk).added_on
        create_test_face(photo=photo)

        mock = MagicMock(side_effect=_append_a_byte)
        self._rate_photo(photo, mock)
        self.assertTrue(mock.called)

        rescanned = self._scan()

        self.assertEqual(photo.pk, rescanned.pk)
        # The File is re-keyed so the next scan sees nothing to do ...
        self.assertEqual(calculate_hash(self.user, self.path), rescanned.main_file.hash)
        # ... and nothing derived from the picture is thrown away.
        self.assertEqual(image_hash, rescanned.image_hash)
        self.assertEqual(added_on, rescanned.added_on)
        self.assertEqual(1, rescanned.faces.count())
        self.assertTrue(os.path.exists(self._thumbnail_path(image_hash)))

    def test_a_second_rescan_has_nothing_left_to_do(self):
        _write_image(self.path, 1)
        photo = self._index()
        self._rate_photo(photo, MagicMock(side_effect=_append_a_byte))
        self._scan()
        file_hash = File.objects.get(path=self.path).hash

        rescanned = self._scan()

        self.assertEqual(file_hash, rescanned.main_file.hash)
        self.assertEqual(photo.pk, rescanned.pk)

    def test_sidecar_writes_never_touch_the_media_file(self):
        self.user.save_metadata_to_disk = User.SaveMetadata.SIDECAR_FILE
        self.user.save()
        _write_image(self.path, 1)
        photo = self._index()
        file_hash = photo.main_file.hash

        mock = MagicMock()
        self._rate_photo(photo, mock)

        self.assertTrue(mock.called)
        rescanned = self._scan()
        self.assertEqual(file_hash, rescanned.main_file.hash)


def _exiftool_available():
    return shutil.which(binaries.exiftool()) is not None


@unittest.skipUnless(_exiftool_available(), "exiftool binary not available")
class RotationIsNotAReplacementTest(ReplacedFileTestCase):
    """Rotating a photo rewrites the original under MEDIA_FILE. The file then
    shows the picture the thumbnails already show, so the next scan must not
    read it as a replacement.

    These run the real exiftool: what matters is whether the decoder honours
    the tag exiftool writes, and a stand-in cannot answer that (#2068).
    """

    def setUp(self):
        super().setUp()
        self.user.save_metadata_to_disk = User.SaveMetadata.MEDIA_FILE
        self.user.save()

    def _rotate(self, photo):
        """Rotate a quarter turn clockwise, as the lightbox's button does.

        The frontend sends -90 for it: ``Photo.rotate`` counts its angle
        counter-clockwise as rendered (``_apply_local_orientation``).
        """
        loaded = Photo.objects.get(pk=photo.pk)
        loaded.rotate(-90)
        return loaded

    def _big_thumbnail_is_portrait(self, photo):
        # Through Pillow, which closes the file: on Windows a file libvips has
        # opened stays open, and the next rotate could not replace it.
        with Image.open(self._thumbnail_path(photo.image_hash)) as image:
            return image.height > image.width

    def _rebuild(self, photo):
        """Throw the thumbnails away and render them again from the file."""
        photo = Photo.objects.get(pk=photo.pk)
        photo.thumbnail._regenerate_thumbnails()
        return photo

    def test_rotating_a_photo_does_not_cost_it_its_faces(self):
        _write_image(self.path, 1)
        photo = self._index()
        image_hash = photo.image_hash
        added_on = Photo.objects.get(pk=photo.pk).added_on
        create_test_face(photo=photo)
        hash_before = photo.main_file.hash

        self._rotate(photo)
        self.assertNotEqual(hash_before, calculate_hash(self.user, self.path))

        rescanned = self._scan()

        self.assertEqual(photo.pk, rescanned.pk)
        self.assertEqual(1, rescanned.faces.count())
        self.assertEqual(image_hash, rescanned.image_hash)
        self.assertEqual(added_on, rescanned.added_on)
        self.assertEqual(calculate_hash(self.user, self.path), rescanned.main_file.hash)

    def test_the_rotation_moves_into_the_file_and_is_applied_once(self):
        """#2050: the rotation lands in the file's own EXIF and
        ``local_orientation`` goes back to 1, so a rebuild applies it once."""
        self.path = os.path.join(self.tmpdir, "IMG_0001.jpg")
        _write_image(self.path, 1, size=(256, 128), format="JPEG")
        photo = self._index()

        self._rotate(photo)

        self.assertEqual(6, read_orientation(self.path))
        rotated = Photo.objects.get(pk=photo.pk)
        self.assertEqual(1, rotated.local_orientation)
        self.assertTrue(self._big_thumbnail_is_portrait(rotated))
        rebuilt = self._rebuild(rotated)
        self.assertTrue(self._big_thumbnail_is_portrait(rebuilt))
        self.assertEqual(
            rotated.perceptual_hash, Photo.objects.get(pk=photo.pk).perceptual_hash
        )

    def test_a_second_rotate_starts_from_the_first(self):
        """The second rotate renders the file the first one just rewrote, in
        the same process: libvips must not serve its cached decode of the
        file as it was before the write."""
        self.path = os.path.join(self.tmpdir, "IMG_0001.jpg")
        _write_image(self.path, 1, size=(256, 128), format="JPEG")
        photo = self._index()
        create_test_face(photo=photo)

        self._rotate(photo)
        self._rotate(photo)

        self.assertEqual(3, read_orientation(self.path))
        rotated = Photo.objects.get(pk=photo.pk)
        self.assertEqual(1, rotated.local_orientation)
        self.assertFalse(self._big_thumbnail_is_portrait(rotated))
        rescanned = self._scan()
        self.assertEqual(1, rescanned.faces.count())
        self.assertEqual(rotated.perceptual_hash, rescanned.perceptual_hash)

    def test_the_rescan_keeps_cheap_derived_content_for_a_rotation(self):
        """#2050: rendering the rotated file again reproduces the hash the
        thumbnails were built from. The verdict is SAME_PICTURE rather than
        UNCOMPARABLE, so nothing derived is thrown away and rebuilt.
        """
        _write_image(self.path, 1, size=(256, 128))
        photo = self._index()
        photo.thumbnail.dominant_color = "[1,2,3]"
        photo.thumbnail.save()

        self._rotate(photo)
        rescanned = self._scan()

        self.assertEqual("[1,2,3]", rescanned.thumbnail.dominant_color)
        self.assertTrue(os.path.exists(self._thumbnail_path(rescanned.image_hash)))
        self.assertTrue(self._big_thumbnail_is_portrait(rescanned))

    def test_a_photo_shot_in_portrait_is_rotated_from_its_own_orientation(self):
        """The written value starts from the file's EXIF, not from
        ``PhotoMetadata`` (which the scan never fills in): EXIF 6 plus a
        clockwise quarter turn is 3."""
        self.path = os.path.join(self.tmpdir, "IMG_0001.jpg")
        _write_image(self.path, 1, size=(256, 128), format="JPEG")
        write_metadata(self.path, {Tags.ORIENTATION: 6}, use_sidecar=False)
        photo = self._index()
        self.assertTrue(self._big_thumbnail_is_portrait(photo))
        create_test_face(photo=photo)

        self._rotate(photo)

        self.assertEqual(3, read_orientation(self.path))
        rescanned = self._scan()
        self.assertEqual(1, rescanned.local_orientation)
        self.assertEqual(1, rescanned.faces.count())
        self.assertFalse(self._big_thumbnail_is_portrait(self._rebuild(rescanned)))

    def test_a_heic_rotation_stays_in_the_database(self):
        """libheif ignores the EXIF orientation exiftool writes into a HEIC, so
        the rotation must stay in ``local_orientation``: resetting it loses the
        rotation, and the rescan would render the file unrotated, miss the
        stored hash and throw the photo's faces away as a replacement."""
        self.path = os.path.join(self.tmpdir, "IMG_0001.heic")
        _write_image(self.path, 1, size=(256, 128), format="HEIF")
        photo = self._index()
        image_hash = photo.image_hash
        create_test_face(photo=photo)

        self._rotate(photo)

        self.assertEqual(8, Photo.objects.get(pk=photo.pk).local_orientation)
        rescanned = self._scan()
        self.assertEqual(photo.pk, rescanned.pk)
        self.assertEqual(image_hash, rescanned.image_hash)
        self.assertEqual(1, rescanned.faces.count())
        self.assertEqual(8, rescanned.local_orientation)
        self.assertTrue(self._big_thumbnail_is_portrait(self._rebuild(rescanned)))

    def test_a_write_that_does_not_land_keeps_the_rotation_in_the_database(self):
        """exiftool reports a failed write without raising. Bytes that changed
        without the tag changing must not reset ``local_orientation``."""
        _write_image(self.path, 1, size=(256, 128))
        photo = self._index()
        create_test_face(photo=photo)

        loaded = Photo.objects.get(pk=photo.pk)
        with patch("api.models.photo.write_metadata", side_effect=_append_a_byte):
            loaded.rotate(-90)

        self.assertEqual(1, read_orientation(self.path))
        self.assertEqual(8, Photo.objects.get(pk=photo.pk).local_orientation)
        rescanned = self._scan()
        self.assertEqual(1, rescanned.faces.count())
        self.assertTrue(self._big_thumbnail_is_portrait(self._rebuild(rescanned)))

    def test_a_photo_rotated_before_the_fold_keeps_its_faces(self):
        """Rotated by an older release under MEDIA_FILE: the file's EXIF and
        ``local_orientation`` both carry the rotation, so rendering the file
        applies it twice. The next metadata write must not read as a new
        picture."""
        self.path = os.path.join(self.tmpdir, "IMG_0001.jpg")
        _write_image(self.path, 1, size=(256, 128), format="JPEG")
        photo = self._index()
        create_test_face(photo=photo)
        photo = Photo.objects.get(pk=photo.pk)
        photo.local_orientation = 8
        photo.save(save_metadata=False, update_fields=["local_orientation"])
        photo.thumbnail._regenerate_thumbnails()
        write_metadata(self.path, {Tags.ORIENTATION: 6}, use_sidecar=False)

        rescanned = self._scan()

        self.assertEqual(photo.pk, rescanned.pk)
        self.assertEqual(1, rescanned.faces.count())
        self.assertEqual(8, rescanned.local_orientation)


class RemovedPhotoIsNotSweptInTest(ReplacedFileTestCase):
    """manual_delete leaves a photo with its image_hash and its faces but no
    file. A replacement of a live photo with the same hash must not reach it."""

    def test_a_removed_photo_keeps_its_faces(self):
        _write_image(self.path, 1)
        photo = self._index()
        old_hash = photo.image_hash

        removed = Photo(
            image_hash=old_hash,
            owner=self.user,
            added_on=photo.added_on,
            removed=True,
            main_file=None,
        )
        removed.save()
        create_test_face(photo=removed)

        _write_image(self.path, 2)
        rescanned = self._scan()

        self.assertNotEqual(old_hash, rescanned.image_hash)
        removed.refresh_from_db()
        self.assertEqual(old_hash, removed.image_hash)
        self.assertEqual(1, removed.faces.count())


class UncomparableContentTest(ReplacedFileTestCase):
    """A video has no perceptual hash to compare against here. Rebuilding its
    thumbnails is cheap and safe; throwing away labelled faces is not."""

    def test_a_video_keeps_its_faces_when_its_bytes_change(self):
        _write_image(self.path, 1)
        photo = self._index()
        image_hash = photo.image_hash
        added_on = Photo.objects.get(pk=photo.pk).added_on
        person = create_test_person(cluster_owner=self.user)
        create_test_face(photo=photo, person=person)
        photo.thumbnail.dominant_color = "[1,2,3]"
        photo.thumbnail.save()

        _write_image(self.path, 2)
        with (
            patch("api.directory_watcher.file_handlers.is_video", return_value=True),
            patch("api.transcode_cache.discard") as discard,
        ):
            rescanned = self._scan()

        # Nothing a person may have corrected is thrown away ...
        self.assertEqual(1, rescanned.faces.count())
        self.assertEqual(image_hash, rescanned.image_hash)
        self.assertEqual(added_on, rescanned.added_on)
        # ... while what the new bytes certainly invalidate is rebuilt.
        discard.assert_called_once_with(image_hash)
        self.assertIsNone(rescanned.thumbnail.dominant_color)
        self.assertEqual(calculate_hash(self.user, self.path), rescanned.main_file.hash)
        self.assertEqual(
            calculate_hash_from_thumbnail(self.path),
            calculate_hash_from_thumbnail(self._thumbnail_path(image_hash)),
        )


class PictureVerdictAcrossRenderVersionsTest(ReplacedFileTestCase):
    """A photo indexed by an older release carries the hash of that release's
    render. Its bytes changing must not read as a new picture only because the
    thumbnails are rendered differently now (embedded RAW previews, WebP
    effort 2), or the photo would lose its faces to a metadata write."""

    def _verdict(self, current, legacy):
        from api.directory_watcher import file_handlers

        photo = MagicMock(perceptual_hash="stored", local_orientation=1)
        renders = []

        def render(path, local_orientation, legacy=False):
            renders.append(legacy)
            return legacy_hash if legacy else current

        legacy_hash = legacy
        with patch.object(
            file_handlers, "_rendered_perceptual_hash", side_effect=render
        ):
            return file_handlers._picture_verdict(photo, self.path), renders

    def test_current_render_matching_needs_no_legacy_render(self):
        from api.directory_watcher.file_handlers import SAME_PICTURE

        self.assertEqual(self._verdict("stored", "other"), (SAME_PICTURE, [False]))

    def test_legacy_render_matching_is_the_same_picture(self):
        from api.directory_watcher.file_handlers import SAME_PICTURE

        self.assertEqual(
            self._verdict("changed", "stored"), (SAME_PICTURE, [False, True])
        )

    def test_neither_render_matching_is_a_new_picture(self):
        from api.directory_watcher.file_handlers import NEW_PICTURE

        self.assertEqual(self._verdict("a", "b")[0], NEW_PICTURE)

    def test_a_render_that_failed_cannot_decide(self):
        # e.g. the RAW service is down for the legacy render
        from api.directory_watcher.file_handlers import UNCOMPARABLE

        self.assertEqual(self._verdict("changed", None)[0], UNCOMPARABLE)
        self.assertEqual(self._verdict(None, "changed")[0], UNCOMPARABLE)

    def test_legacy_render_of_a_png_is_libwebps_default_effort(self):
        from api.directory_watcher.file_handlers import _rendered_perceptual_hash
        from api.perceptual_hash import calculate_perceptual_hash

        _write_image(self.path, 7, size=(1600, 1200))
        legacy_file = os.path.join(self.tmpdir, "legacy.webp")
        image = pyvips.Image.thumbnail(self.path, 10000, height=1080, size="down")
        image.write_to_file(legacy_file, Q=95)

        self.assertEqual(
            _rendered_perceptual_hash(self.path, 1, legacy=True),
            calculate_perceptual_hash(legacy_file),
        )
