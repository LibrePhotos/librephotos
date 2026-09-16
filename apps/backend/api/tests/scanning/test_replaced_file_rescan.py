import os
import shutil
import tempfile
from unittest.mock import MagicMock, patch

from django.test import TestCase, override_settings
from PIL import Image

from api.directory_watcher.file_handlers import (
    create_file_record,
    group_files_into_photo,
)
from api.models import File, Photo, Thumbnail, User
from api.models.file import calculate_hash, content_hash
from api.tests.utils import create_test_face, create_test_user

THUMBNAIL_DIRS = ("thumbnails_big", "square_thumbnails", "square_thumbnails_small")


def _write_image(path, color):
    Image.new("RGB", (32, 32), color).save(path, format="PNG")


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

    def _scan(self, path=None):
        """Run the two scan phases over a single path, flushing on-commit work."""
        with self.captureOnCommitCallbacks(execute=True):
            file = create_file_record(self.user, path or self.path)
            self.assertIsNotNone(file)
            return group_files_into_photo(self.user, [file], job_id="test-job")

    def _thumbnail_path(self, photo_hash, directory="thumbnails_big"):
        return os.path.join(self.media_root, directory, photo_hash + ".webp")


class ReplacedFileRescanTest(ReplacedFileTestCase):
    """A file replaced in place (same path, different content) must be
    re-indexed with the new content instead of keeping the stale hash."""

    def test_replaced_file_is_reindexed_with_new_content(self):
        _write_image(self.path, (255, 0, 0))
        old_hash = calculate_hash(self.user, self.path)
        photo = self._scan()
        self.assertEqual(old_hash, photo.image_hash)

        # The user replaces the file on disk, keeping the same name.
        _write_image(self.path, (0, 0, 255))
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
        _write_image(self.path, (255, 0, 0))
        photo = self._scan()
        old_hash = photo.image_hash
        thumbnail = Thumbnail.objects.create(photo=photo, dominant_color="[255,0,0]")
        thumbnail._generate_thumbnail()
        self.assertTrue(os.path.exists(self._thumbnail_path(old_hash)))

        _write_image(self.path, (0, 0, 255))
        rescanned = self._scan()
        thumbnail.refresh_from_db()
        thumbnail.photo = rescanned
        thumbnail._generate_thumbnail()

        self.assertFalse(os.path.exists(self._thumbnail_path(old_hash)))
        new_thumbnail_path = self._thumbnail_path(rescanned.image_hash)
        self.assertTrue(os.path.exists(new_thumbnail_path))
        with Image.open(new_thumbnail_path) as image:
            red, _green, blue = image.convert("RGB").getpixel((0, 0))
        self.assertGreater(blue, red)

    def test_derived_content_of_the_old_picture_is_discarded(self):
        _write_image(self.path, (255, 0, 0))
        photo = self._scan()
        old_hash = photo.image_hash
        old_added_on = photo.added_on
        Thumbnail.objects.create(photo=photo, dominant_color="[255,0,0]")
        create_test_face(photo=photo)

        _write_image(self.path, (0, 0, 255))
        with patch("api.transcode_cache.discard") as discard:
            rescanned = self._scan()

        discard.assert_called_once_with(old_hash)
        self.assertEqual(0, rescanned.faces.count())
        self.assertIsNone(rescanned.thumbnail.dominant_color)
        # The tag, geolocation and face jobs select on added_on, so the photo
        # has to look new again for them to re-derive anything.
        self.assertGreater(rescanned.added_on, old_added_on)

    def test_unchanged_file_keeps_its_record(self):
        _write_image(self.path, (255, 0, 0))
        photo = self._scan()
        file_hash = photo.main_file.hash

        rescanned = self._scan()

        self.assertEqual(photo.pk, rescanned.pk)
        self.assertEqual(file_hash, rescanned.main_file.hash)
        self.assertEqual(1, File.objects.filter(path=self.path).count())

    def test_replacement_with_already_indexed_content_is_left_alone(self):
        _write_image(self.path, (255, 0, 0))
        photo = self._scan()
        old_hash = photo.main_file.hash

        other_path = os.path.join(self.tmpdir, "IMG_0002.png")
        _write_image(other_path, (0, 0, 255))
        self._scan(other_path)

        # The first file is replaced by a copy of the second one.
        _write_image(self.path, (0, 0, 255))
        self._scan()

        self.assertEqual(old_hash, File.objects.get(path=self.path).hash)
        self.assertEqual(2, Photo.objects.filter(owner=self.user).count())


class ReplacedLivePhotoTest(ReplacedFileTestCase):
    """The motion video extracted from a Live Photo is named after the old
    file hash and is only ever extracted when the Photo is created, so a
    replacement has to drop it."""

    def test_stale_motion_video_is_dropped(self):
        _write_image(self.path, (255, 0, 0))
        photo = self._scan()
        motion_path = os.path.join(self.media_root, "embedded_media", "old_motion.mp4")
        os.makedirs(os.path.dirname(motion_path), exist_ok=True)
        with open(motion_path, "wb") as f:
            f.write(b"not really a video")
        motion = File.create(motion_path, self.user)
        photo.main_file.embedded_media.add(motion)
        photo.files.add(motion)

        _write_image(self.path, (0, 0, 255))
        rescanned = self._scan()

        self.assertFalse(File.objects.filter(hash=motion.hash).exists())
        self.assertFalse(os.path.exists(motion_path))
        self.assertEqual(0, rescanned.main_file.embedded_media.count())
        self.assertEqual(
            [self.path], list(rescanned.files.values_list("path", flat=True))
        )


def _append_a_byte(path, *args, **kwargs):
    """Stand in for exiftool: change the file's bytes without changing the picture."""
    with open(path, "ab") as f:
        f.write(b"\x00")


class MetadataWriteBackIsNotAReplacementTest(ReplacedFileTestCase):
    """With save_metadata_to_disk=MEDIA_FILE, LibrePhotos rewrites the original
    on every rating or face-tag change. That must not read back as the user
    having replaced the picture."""

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

    def test_writing_metadata_refreshes_the_stored_hash(self):
        _write_image(self.path, (255, 0, 0))
        photo = self._scan()
        image_hash = photo.image_hash
        hash_before = photo.main_file.hash

        mock = MagicMock(side_effect=_append_a_byte)
        self._rate_photo(photo, mock)

        self.assertTrue(mock.called)
        photo.refresh_from_db()
        self.assertNotEqual(hash_before, photo.main_file.hash)
        self.assertEqual(calculate_hash(self.user, self.path), photo.main_file.hash)
        self.assertEqual(image_hash, photo.image_hash)
        self.assertEqual(self.path, photo.main_file.path)

    def test_next_scan_does_not_treat_our_own_write_as_a_replacement(self):
        _write_image(self.path, (255, 0, 0))
        photo = self._scan()
        image_hash = photo.image_hash
        Thumbnail.objects.create(photo=photo)._generate_thumbnail()
        added_on = Photo.objects.get(pk=photo.pk).added_on

        self._rate_photo(photo, MagicMock(side_effect=_append_a_byte))

        rescanned = self._scan()

        self.assertEqual(photo.pk, rescanned.pk)
        self.assertEqual(image_hash, rescanned.image_hash)
        self.assertEqual(added_on, rescanned.added_on)
        self.assertTrue(os.path.exists(self._thumbnail_path(image_hash)))

    def test_sidecar_writes_leave_the_hash_alone(self):
        self.user.save_metadata_to_disk = User.SaveMetadata.SIDECAR_FILE
        self.user.save()
        _write_image(self.path, (255, 0, 0))
        photo = self._scan()
        file_hash = photo.main_file.hash

        mock = MagicMock()
        with patch.object(Photo, "_refresh_main_file_hash") as refresh:
            self._rate_photo(photo, mock)

        self.assertTrue(mock.called)
        # A sidecar write does not touch the media file, so there is nothing to
        # re-hash and no reason to read the whole file back.
        refresh.assert_not_called()
        photo.refresh_from_db()
        self.assertEqual(file_hash, photo.main_file.hash)


class ReplacedFileOwnerScopeTest(ReplacedFileTestCase):
    """The hash carries the owner id, so identical bytes hash differently per
    user. A second user scanning a shared path must not look like a
    replacement and must not touch the first user's rows."""

    def test_second_user_scanning_the_same_file_is_not_a_replacement(self):
        _write_image(self.path, (255, 0, 0))
        photo = self._scan()
        first_hash = photo.main_file.hash
        first_added_on = photo.added_on

        other_user = create_test_user()
        other_hash = calculate_hash(other_user, self.path)
        self.assertNotEqual(first_hash, other_hash)
        self.assertEqual(content_hash(first_hash), content_hash(other_hash))

        with self.captureOnCommitCallbacks(execute=True):
            create_file_record(other_user, self.path)

        self.assertEqual(first_hash, File.objects.get(path=self.path).hash)
        photo.refresh_from_db()
        self.assertEqual(first_hash, photo.image_hash)
        self.assertEqual(first_added_on, photo.added_on)

    def test_file_indexed_by_another_user_is_not_reindexed(self):
        _write_image(self.path, (255, 0, 0))
        photo = self._scan()
        first_hash = photo.main_file.hash

        other_user = create_test_user()
        _write_image(self.path, (0, 0, 255))
        with self.captureOnCommitCallbacks(execute=True):
            create_file_record(other_user, self.path)

        self.assertEqual(first_hash, File.objects.get(path=self.path).hash)
        photo.refresh_from_db()
        self.assertEqual(first_hash, photo.image_hash)
