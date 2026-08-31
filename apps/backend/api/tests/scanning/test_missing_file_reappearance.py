import os

from django.test import TestCase

from api.directory_watcher.file_handlers import group_files_into_photo
from api.models import File, Photo
from api.tests.utils import create_test_photo, create_test_user


class FileCreateMissingFlagTest(TestCase):
    """File.create must clear the missing flag when a previously missing
    file is found on disk again (e.g. a network share or removable drive
    that was unmounted during a scan)."""

    def setUp(self):
        self.user = create_test_user()

    def test_clears_missing_flag_when_file_is_back_on_disk(self):
        photo = create_test_photo(owner=self.user)
        file = photo.main_file
        file.missing = True
        file.save()

        result = File.create(file.path, self.user)

        self.assertEqual(file.hash, result.hash)
        self.assertFalse(result.missing)
        file.refresh_from_db()
        self.assertFalse(file.missing)

    def test_keeps_missing_flag_when_file_is_still_gone(self):
        photo = create_test_photo(owner=self.user)
        file = photo.main_file
        file.missing = True
        file.save()
        os.remove(file.path)

        result = File.create(file.path, self.user)

        self.assertEqual(file.hash, result.hash)
        self.assertTrue(result.missing)


class MissingFileReappearanceTest(TestCase):
    """A file that goes missing and later reappears at the same path must be
    re-attached to its original Photo by the scan, not spawn a duplicate
    Photo with the same image_hash."""

    def setUp(self):
        self.user = create_test_user()

    def test_reappearing_file_is_readopted_by_original_photo(self):
        photo = create_test_photo(owner=self.user)
        file = photo.main_file
        photo.files.add(file)
        path = file.path
        with open(path, "rb") as f:
            content = f.read()

        # The file disappears (unmounted share, removed drive) and a
        # "scan missing photos" run flags it.
        os.remove(path)
        photo._check_files()
        file.refresh_from_db()
        self.assertTrue(file.missing)
        self.assertEqual(0, photo.files.count())
        photo.refresh_from_db()
        self.assertEqual(file, photo.main_file)

        # The file comes back at the same path and a scan picks it up again.
        with open(path, "wb") as f:
            f.write(content)
        photo_count_before = Photo.objects.count()

        refound_file = File.create(path, self.user)
        result_photo = group_files_into_photo(
            self.user, [refound_file], job_id="test-job"
        )

        self.assertEqual(photo.pk, result_photo.pk)
        self.assertEqual(photo_count_before, Photo.objects.count())
        self.assertTrue(photo.files.filter(hash=file.hash).exists())
        file.refresh_from_db()
        self.assertFalse(file.missing)
