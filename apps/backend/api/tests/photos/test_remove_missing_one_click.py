"""A photo whose main file is gone is removed by one "Remove missing photos", or kept.

The missing-file check unlinked a gone file from the photo but left
``main_file`` pointing at it. A photo that still had a sidecar linked matched
neither ``files=None`` nor ``main_file=None``, so the first run only deleted
the missing file rows, which set ``main_file`` to NULL, and the photo went on
the second run. A photo whose RAW was still on disk went the same way, two
runs later, with its RAW still there.
"""

import os
import shutil
import tempfile
import uuid

from django.test import TestCase

from api.albums.auto_albums import delete_missing_photos
from api.directory_watcher.file_handlers import group_files_into_photo
from api.models import File, Photo
from api.photos.files import detach_missing_files
from api.tests.utils import create_test_file, create_test_photo, create_test_user


class RemoveMissingOneClickTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.folder = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.folder, ignore_errors=True)

    def _file(self, name: str, file_type: int = File.IMAGE) -> File:
        """A file on disk in the test folder, of ``file_type``."""
        file = create_test_file(
            os.path.join(self.folder, name), self.user, uuid.uuid4().bytes
        )
        File.objects.filter(pk=file.pk).update(type=file_type)
        file.type = file_type
        return file

    def _photo(self, main_file: File, *others: File) -> Photo:
        photo = create_test_photo(owner=self.user, main_file=main_file)
        photo.files.add(main_file, *others)
        return photo

    def _delete_from_disk_and_scan(self, photo: Photo, file: File) -> None:
        os.remove(file.path)
        detach_missing_files(photo)

    def _remove_missing(self) -> None:
        delete_missing_photos(self.user, str(uuid.uuid4()))

    def test_photo_with_only_a_sidecar_left_goes_on_the_first_run(self):
        jpg = self._file("pair.jpg")
        xmp = self._file("pair.xmp", File.METADATA_FILE)
        photo = self._photo(jpg, xmp)

        self._delete_from_disk_and_scan(photo, jpg)
        self._remove_missing()

        self.assertFalse(Photo.objects.filter(pk=photo.pk).exists())

    def test_a_sidecar_shared_with_another_photo_stays(self):
        # Sidecars are keyed by content, so identical XMPs share one row.
        jpg = self._file("pair.jpg")
        xmp = self._file("pair.xmp", File.METADATA_FILE)
        photo = self._photo(jpg, xmp)
        other = self._photo(self._file("other.jpg"), xmp)

        self._delete_from_disk_and_scan(photo, jpg)
        self._remove_missing()

        self.assertFalse(Photo.objects.filter(pk=photo.pk).exists())
        self.assertTrue(File.objects.filter(pk=xmp.pk).exists())
        self.assertIn(xmp, Photo.objects.get(pk=other.pk).files.all())

    def test_the_raw_stands_in_and_the_photo_stays(self):
        jpg = self._file("IMG_1.jpg")
        raw = self._file("IMG_1.cr2", File.RAW_FILE)
        xmp = self._file("IMG_1.xmp", File.METADATA_FILE)
        photo = self._photo(jpg, raw, xmp)

        self._delete_from_disk_and_scan(photo, jpg)
        photo.refresh_from_db()
        self.assertEqual(photo.main_file, raw)
        self.assertFalse(photo.video)

        # Twice: the second run is the one that used to remove it.
        self._remove_missing()
        self._remove_missing()

        photo.refresh_from_db()
        self.assertEqual(photo.main_file, raw)
        self.assertFalse(File.objects.filter(pk=jpg.pk).exists())

    def test_a_video_standing_in_makes_the_photo_a_video(self):
        heic = self._file("IMG_2.heic")
        mov = self._file("IMG_2.mov", File.VIDEO)
        photo = self._photo(heic, mov)

        self._delete_from_disk_and_scan(photo, heic)

        photo.refresh_from_db()
        self.assertEqual(photo.main_file, mov)
        self.assertTrue(photo.video)

    def test_a_photo_with_its_one_file_gone_still_goes_on_the_first_run(self):
        jpg = self._file("single.jpg")
        photo = self._photo(jpg)

        self._delete_from_disk_and_scan(photo, jpg)
        self._remove_missing()

        self.assertFalse(Photo.objects.filter(pk=photo.pk).exists())

    def test_a_photo_that_lost_only_its_sidecar_is_untouched(self):
        jpg = self._file("keep.jpg")
        xmp = self._file("keep.xmp", File.METADATA_FILE)
        photo = self._photo(jpg, xmp)

        self._delete_from_disk_and_scan(photo, xmp)
        self._remove_missing()

        photo.refresh_from_db()
        self.assertEqual(photo.main_file, jpg)
        self.assertEqual(list(photo.files.all()), [jpg])

    def test_the_jpeg_coming_back_takes_over_from_the_raw_again(self):
        jpg = self._file("IMG_3.jpg")
        raw = self._file("IMG_3.cr2", File.RAW_FILE)
        photo = self._photo(jpg, raw)
        with open(jpg.path, "rb") as handle:
            content = handle.read()

        self._delete_from_disk_and_scan(photo, jpg)
        with open(jpg.path, "wb") as handle:
            handle.write(content)
        adopted = group_files_into_photo(self.user, [jpg, raw], uuid.uuid4())

        self.assertEqual(adopted.pk, photo.pk)
        photo.refresh_from_db()
        self.assertEqual(photo.main_file, jpg)


class RemoveMissingAfterOlderScanTest(TestCase):
    """Photos a scan from before this fix left pointing at their gone main file."""

    def setUp(self):
        self.user = create_test_user()

    def _photo(self, *others: File) -> tuple[Photo, File]:
        gone = create_test_file(None, self.user, missing=True)
        photo = create_test_photo(owner=self.user, main_file=gone)
        photo.files.add(*others)
        return photo, gone

    def test_only_a_sidecar_left_goes_on_the_first_run(self):
        xmp = create_test_file(None, self.user, file_type=File.METADATA_FILE)
        photo, _ = self._photo(xmp)

        delete_missing_photos(self.user, str(uuid.uuid4()))

        self.assertFalse(Photo.objects.filter(pk=photo.pk).exists())

    def test_a_raw_left_stands_in_and_the_photo_stays(self):
        raw = create_test_file(None, self.user, file_type=File.RAW_FILE)
        photo, gone = self._photo(raw)

        delete_missing_photos(self.user, str(uuid.uuid4()))
        delete_missing_photos(self.user, str(uuid.uuid4()))

        photo.refresh_from_db()
        self.assertEqual(photo.main_file, raw)
        self.assertFalse(File.objects.filter(pk=gone.pk).exists())

    def test_the_missing_count_matches_what_the_run_removes(self):
        xmp = create_test_file(None, self.user, file_type=File.METADATA_FILE)
        raw = create_test_file(None, self.user, file_type=File.RAW_FILE)
        sidecar_only, _ = self._photo(xmp)
        with_raw, _ = self._photo(raw)

        missing = Photo.objects.owned_by(self.user).missing()

        self.assertEqual(list(missing), [sidecar_only])
        self.assertNotIn(with_raw, missing)
