import os
import tempfile

from django.conf import settings
from django.test import TestCase
from PIL import Image

from api.directory_watcher.file_handlers import (
    create_file_record,
    group_files_into_photo,
)
from api.models import File, Photo, Thumbnail
from api.models.file import calculate_hash
from api.tests.utils import create_test_user


def _write_image(path, color):
    Image.new("RGB", (32, 32), color).save(path, format="PNG")


class ReplacedFileRescanTest(TestCase):
    """A file replaced in place (same path, different content) must be
    re-indexed with the new content instead of keeping the stale hash."""

    def setUp(self):
        self.user = create_test_user()
        self.tmpdir = tempfile.mkdtemp()
        self.path = os.path.join(self.tmpdir, "IMG_0001.png")

    def _scan(self):
        file = create_file_record(self.user, self.path)
        self.assertIsNotNone(file)
        return group_files_into_photo(self.user, [file], job_id="test-job")

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

    def test_thumbnails_are_rebuilt_from_the_new_content(self):
        for directory in (
            "thumbnails_big",
            "square_thumbnails",
            "square_thumbnails_small",
        ):
            os.makedirs(os.path.join(settings.MEDIA_ROOT, directory), exist_ok=True)

        _write_image(self.path, (255, 0, 0))
        photo = self._scan()
        old_hash = photo.image_hash
        thumbnail = Thumbnail.objects.create(photo=photo)
        thumbnail._generate_thumbnail()
        old_thumbnail_path = os.path.join(
            settings.MEDIA_ROOT, "thumbnails_big", old_hash + ".webp"
        )
        self.assertTrue(os.path.exists(old_thumbnail_path))

        _write_image(self.path, (0, 0, 255))
        rescanned = self._scan()
        thumbnail.refresh_from_db()
        thumbnail.photo = rescanned
        thumbnail._generate_thumbnail()

        new_thumbnail_path = os.path.join(
            settings.MEDIA_ROOT, "thumbnails_big", rescanned.image_hash + ".webp"
        )
        self.assertFalse(os.path.exists(old_thumbnail_path))
        self.assertTrue(os.path.exists(new_thumbnail_path))
        with Image.open(new_thumbnail_path) as image:
            red, green, blue = image.convert("RGB").getpixel((0, 0))
        self.assertGreater(blue, red)

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
        other_photo = create_file_record(self.user, other_path)
        group_files_into_photo(self.user, [other_photo], job_id="test-job")

        # The first file is replaced by a copy of the second one.
        _write_image(self.path, (0, 0, 255))
        self._scan()

        self.assertEqual(old_hash, File.objects.get(path=self.path).hash)
        self.assertEqual(2, Photo.objects.filter(owner=self.user).count())
