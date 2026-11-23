import os
import shutil
import tempfile
import uuid

from django.test import TestCase

from api.albums.auto_albums import delete_missing_photos
from api.dataviz.stats import get_count_stats
from api.directory_watcher.file_handlers import group_files_into_photo
from api.directory_watcher.scan_jobs import scan_missing_photos
from api.models import File, LongRunningJob, Photo
from api.photos.files import detach_missing_files
from api.tests.utils import create_test_file, create_test_photo, create_test_user


def remove_missing(user) -> LongRunningJob:
    job_id = str(uuid.uuid4())
    delete_missing_photos(user, job_id)
    return LongRunningJob.objects.get(job_id=job_id)


class RemoveMissingOneClickTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.folder = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.folder, ignore_errors=True)

    def _file(self, name: str, file_type: int = File.IMAGE) -> File:
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

    def _delete_from_disk_and_scan(self, photo: Photo, file: File) -> bytes:
        with open(file.path, "rb") as handle:
            content = handle.read()
        os.remove(file.path)
        detach_missing_files(photo)
        return content

    def _put_back(self, file: File, content: bytes) -> None:
        with open(file.path, "wb") as handle:
            handle.write(content)

    def test_photo_with_only_a_sidecar_left_goes_on_the_first_run(self):
        jpg = self._file("pair.jpg")
        xmp = self._file("pair.xmp", File.METADATA_FILE)
        photo = self._photo(jpg, xmp)

        self._delete_from_disk_and_scan(photo, jpg)
        remove_missing(self.user)

        self.assertFalse(Photo.objects.filter(pk=photo.pk).exists())

    def test_a_sidecar_shared_with_another_photo_stays(self):
        jpg = self._file("pair.jpg")
        xmp = self._file("pair.xmp", File.METADATA_FILE)
        photo = self._photo(jpg, xmp)
        other = self._photo(self._file("other.jpg"), xmp)

        self._delete_from_disk_and_scan(photo, jpg)
        remove_missing(self.user)

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

        remove_missing(self.user)
        remove_missing(self.user)

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

    def test_the_heic_coming_back_makes_the_live_photo_a_photo_again(self):
        heic = self._file("IMG_4.heic")
        mov = self._file("IMG_4.mov", File.VIDEO)
        photo = self._photo(heic, mov)

        content = self._delete_from_disk_and_scan(photo, heic)
        self._put_back(heic, content)
        adopted = group_files_into_photo(self.user, [heic, mov], uuid.uuid4())

        self.assertEqual(adopted.pk, photo.pk)
        photo.refresh_from_db()
        self.assertEqual(photo.main_file, heic)
        self.assertFalse(photo.video)

    def test_a_photo_with_its_one_file_gone_still_goes_on_the_first_run(self):
        jpg = self._file("single.jpg")
        photo = self._photo(jpg)

        self._delete_from_disk_and_scan(photo, jpg)
        remove_missing(self.user)

        self.assertFalse(Photo.objects.filter(pk=photo.pk).exists())

    def test_a_photo_that_lost_only_its_sidecar_is_untouched(self):
        jpg = self._file("keep.jpg")
        xmp = self._file("keep.xmp", File.METADATA_FILE)
        photo = self._photo(jpg, xmp)

        self._delete_from_disk_and_scan(photo, xmp)
        job = remove_missing(self.user)

        self.assertTrue(job.finished)
        self.assertFalse(job.failed)
        photo.refresh_from_db()
        self.assertEqual(photo.main_file, jpg)
        self.assertEqual(list(photo.files.all()), [jpg])
        self.assertFalse(File.objects.filter(pk=xmp.pk).exists())

    def test_the_jpeg_coming_back_takes_over_from_the_raw_again(self):
        jpg = self._file("IMG_3.jpg")
        raw = self._file("IMG_3.cr2", File.RAW_FILE)
        photo = self._photo(jpg, raw)

        content = self._delete_from_disk_and_scan(photo, jpg)
        self._put_back(jpg, content)
        adopted = group_files_into_photo(self.user, [jpg, raw], uuid.uuid4())

        self.assertEqual(adopted.pk, photo.pk)
        photo.refresh_from_db()
        self.assertEqual(photo.main_file, jpg)
        self.assertFalse(photo.video)


class RemoveMissingAfterOlderScanTest(TestCase):
    def setUp(self):
        self.user = create_test_user()

    def _photo(self, *others: File, user=None) -> tuple[Photo, File]:
        owner = user or self.user
        gone = create_test_file(None, owner, missing=True)
        photo = create_test_photo(owner=owner, main_file=gone)
        photo.files.add(*others)
        return photo, gone

    def _sidecar_only(self, user=None) -> Photo:
        owner = user or self.user
        xmp = create_test_file(None, owner, file_type=File.METADATA_FILE)
        return self._photo(xmp, user=owner)[0]

    def _with_raw(self, user=None) -> Photo:
        owner = user or self.user
        raw = create_test_file(None, owner, file_type=File.RAW_FILE)
        return self._photo(raw, user=owner)[0]

    def test_only_a_sidecar_left_goes_on_the_first_run(self):
        photo = self._sidecar_only()

        remove_missing(self.user)

        self.assertFalse(Photo.objects.filter(pk=photo.pk).exists())

    def test_a_raw_left_stands_in_and_the_photo_stays(self):
        raw = create_test_file(None, self.user, file_type=File.RAW_FILE)
        photo, gone = self._photo(raw)

        remove_missing(self.user)
        remove_missing(self.user)

        photo.refresh_from_db()
        self.assertEqual(photo.main_file, raw)
        self.assertFalse(File.objects.filter(pk=gone.pk).exists())

    def test_the_missing_count_matches_what_the_run_removes(self):
        sidecar_only = [self._sidecar_only() for _ in range(2)]
        with_raw = self._with_raw()
        kept = create_test_photo(owner=self.user)
        kept.files.add(kept.main_file)
        no_main_file = create_test_photo(owner=self.user)
        Photo.objects.filter(pk=no_main_file.pk).update(main_file=None)

        counted = get_count_stats(self.user)["num_missing_photos"]
        before = Photo.objects.owned_by(self.user).count()
        job = remove_missing(self.user)
        removed = before - Photo.objects.owned_by(self.user).count()

        self.assertTrue(job.finished)
        self.assertFalse(job.failed)
        self.assertEqual(counted, 3)
        self.assertEqual(removed, counted)
        self.assertFalse(Photo.objects.filter(pk__in=[p.pk for p in sidecar_only]))
        self.assertTrue(Photo.objects.filter(pk=with_raw.pk).exists())
        self.assertEqual(get_count_stats(self.user)["num_missing_photos"], 0)

    def test_another_users_missing_photos_are_not_counted_or_removed(self):
        other = create_test_user()
        mine = self._sidecar_only()
        theirs = self._sidecar_only(user=other)
        their_raw = self._with_raw(user=other)

        self.assertEqual(list(Photo.objects.owned_by(self.user).missing()), [mine])
        self.assertEqual(get_count_stats(self.user)["num_missing_photos"], 1)

        remove_missing(self.user)

        self.assertFalse(Photo.objects.filter(pk=mine.pk).exists())
        self.assertTrue(Photo.objects.filter(pk=theirs.pk).exists())
        their_raw.refresh_from_db()
        self.assertTrue(their_raw.main_file.missing)
        self.assertEqual(get_count_stats(other)["num_missing_photos"], 1)


class ScanAfterOlderScanTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)
        self.user.scan_directory = self.root
        self.user.save(update_fields=["scan_directory"])

    def test_the_scan_lets_a_raw_on_disk_stand_in_for_a_main_file_gone_before(self):
        gone = create_test_file(
            os.path.join(self.root, "IMG_5.jpg"), self.user, missing=True
        )
        raw = create_test_file(os.path.join(self.root, "IMG_5.cr2"), self.user, b"r")
        File.objects.filter(pk=raw.pk).update(type=File.RAW_FILE)
        photo = create_test_photo(owner=self.user, main_file=gone)
        photo.files.add(raw)

        scan_missing_photos(self.user, uuid.uuid4())

        photo.refresh_from_db()
        self.assertEqual(photo.main_file, raw)
        self.assertNotIn(photo, Photo.objects.owned_by(self.user).missing())
