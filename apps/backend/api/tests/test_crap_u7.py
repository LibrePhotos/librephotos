"""Characterization tests for directory_watcher.repair_jobs (unit 7).

Pins the CURRENT behaviour of ``repair_ungrouped_file_variants`` before it is
refactored. Every assertion below describes what the code does today, quirks
included (they are called out in comments).

No ML models, no network, no exiftool: the only real I/O is a handful of tiny
files written into a per-test temporary directory so ``File.create`` can hash
them.
"""

import os
import shutil
import tempfile
import uuid
from unittest.mock import MagicMock, patch

from django.test import TestCase

from api.directory_watcher import repair_jobs
from api.directory_watcher.repair_jobs import repair_ungrouped_file_variants
from api.models import File, LongRunningJob, Photo
from api.tests.utils import create_test_photo, create_test_user


def _job(job_id):
    return LongRunningJob.objects.get(job_id=str(job_id))


class RepairUngroupedFileVariantsTest(TestCase):
    """Pin current behaviour of ``repair_ungrouped_file_variants``."""

    def setUp(self):
        self.user = create_test_user()
        self.other_user = create_test_user()
        self.job_id = uuid.uuid4()
        self.tmpdir = tempfile.mkdtemp(prefix="lp-u7-")
        self._counter = 0

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    # ---- helpers ----------------------------------------------------

    def _make_file(self, name, user=None):
        """Write a tiny unique file and register it as a File row."""
        self._counter += 1
        path = os.path.join(self.tmpdir, name)
        with open(path, "wb") as fh:
            fh.write(b"payload-%d-%s" % (self._counter, name.encode()))
        return File.create(path, user or self.user)

    def _make_photo(self, main_file, owner=None, extra_files=(), video=False):
        photo = create_test_photo(owner=owner or self.user, video=video)
        photo.main_file = main_file
        photo.save()
        photo.files.add(main_file)
        for extra in extra_files:
            photo.files.add(extra)
        return photo

    # ---- file type sanity (the fixtures the branches depend on) -----

    def test_fixture_file_types(self):
        self.assertEqual(self._make_file("a.CR2").type, File.RAW_FILE)
        self.assertEqual(self._make_file("a.jpg").type, File.IMAGE)
        self.assertEqual(self._make_file("a.xmp").type, File.METADATA_FILE)

    # ---- happy path: merge RAW-only photo into the JPEG photo -------

    def test_merges_raw_only_photo_into_matching_jpeg_photo(self):
        raw = self._make_file("IMG_1.CR2")
        sidecar = self._make_file("IMG_1.xmp")
        jpeg = self._make_file("IMG_1.jpg")

        raw_photo = self._make_photo(raw, extra_files=[sidecar])
        jpeg_photo = self._make_photo(jpeg)

        repair_ungrouped_file_variants(self.user, self.job_id)

        # The RAW-only Photo is gone...
        self.assertFalse(Photo.objects.filter(pk=raw_photo.pk).exists())
        # ...and all of its files now hang off the JPEG Photo.
        jpeg_photo.refresh_from_db()
        self.assertEqual(
            {f.hash for f in jpeg_photo.files.all()},
            {jpeg.hash, raw.hash, sidecar.hash},
        )
        # main_file of the surviving photo is untouched.
        self.assertEqual(jpeg_photo.main_file.hash, jpeg.hash)
        # The File rows survive the plain Photo.delete() (no manual_delete()).
        self.assertTrue(File.objects.filter(hash=raw.hash).exists())
        self.assertTrue(File.objects.filter(hash=sidecar.hash).exists())

        job = _job(self.job_id)
        self.assertEqual(job.job_type, LongRunningJob.JOB_REPAIR_FILE_VARIANTS)
        self.assertTrue(job.finished)
        self.assertFalse(job.failed)
        # progress_target is the RAW-photo count captured before the loop;
        # progress_current is never advanced inside the loop.
        self.assertEqual(job.progress_target, 1)
        self.assertEqual(job.progress_current, 0)
        self.assertIsNotNone(job.started_at)
        self.assertIsNotNone(job.finished_at)

    def test_merge_skips_files_whose_hash_is_already_on_the_jpeg_photo(self):
        raw = self._make_file("IMG_2.CR2")
        jpeg = self._make_file("IMG_2.jpg")

        raw_photo = self._make_photo(raw)
        jpeg_photo = self._make_photo(jpeg)
        # Pre-existing overlap: the RAW file is already attached to the JPEG.
        jpeg_photo.files.add(raw)

        repair_ungrouped_file_variants(self.user, self.job_id)

        self.assertFalse(Photo.objects.filter(pk=raw_photo.pk).exists())
        jpeg_photo.refresh_from_db()
        self.assertEqual(jpeg_photo.files.count(), 2)

    def test_matches_uppercase_jpeg_extension(self):
        raw = self._make_file("IMG_3.CR2")
        jpeg = self._make_file("IMG_3.JPG")

        raw_photo = self._make_photo(raw)
        jpeg_photo = self._make_photo(jpeg)

        repair_ungrouped_file_variants(self.user, self.job_id)

        self.assertFalse(Photo.objects.filter(pk=raw_photo.pk).exists())
        self.assertIn(raw.hash, {f.hash for f in jpeg_photo.files.all()})

    # ---- already-grouped branch: fix main_file priority -------------

    def test_photo_with_image_variant_gets_main_file_and_video_fixed(self):
        raw = self._make_file("IMG_4.CR2")
        jpeg = self._make_file("IMG_4.jpg")

        # RAW is main_file but the JPEG is already a variant of the same Photo.
        photo = self._make_photo(raw, extra_files=[jpeg], video=True)

        repair_ungrouped_file_variants(self.user, self.job_id)

        photo.refresh_from_db()
        self.assertTrue(Photo.objects.filter(pk=photo.pk).exists())
        self.assertEqual(photo.main_file.hash, jpeg.hash)
        self.assertFalse(photo.video)
        # No merge happened, both files still attached.
        self.assertEqual({f.hash for f in photo.files.all()}, {raw.hash, jpeg.hash})
        self.assertTrue(_job(self.job_id).finished)

    def test_image_variant_branch_wins_even_when_a_jpeg_photo_exists(self):
        """The has_image branch ``continue``s, so no merge is attempted."""
        raw = self._make_file("IMG_5.CR2")
        inner_jpeg = self._make_file("inner_5.jpg")
        outer_jpeg = self._make_file("IMG_5.jpg")

        raw_photo = self._make_photo(raw, extra_files=[inner_jpeg])
        jpeg_photo = self._make_photo(outer_jpeg)

        repair_ungrouped_file_variants(self.user, self.job_id)

        raw_photo.refresh_from_db()
        self.assertTrue(Photo.objects.filter(pk=raw_photo.pk).exists())
        self.assertEqual(raw_photo.main_file.hash, inner_jpeg.hash)
        jpeg_photo.refresh_from_db()
        self.assertEqual({f.hash for f in jpeg_photo.files.all()}, {outer_jpeg.hash})

    # ---- no-op branches ---------------------------------------------

    def test_raw_photo_without_match_is_left_alone(self):
        raw = self._make_file("LONELY.CR2")
        raw_photo = self._make_photo(raw)

        repair_ungrouped_file_variants(self.user, self.job_id)

        raw_photo.refresh_from_db()
        self.assertEqual(raw_photo.main_file.hash, raw.hash)
        self.assertEqual({f.hash for f in raw_photo.files.all()}, {raw.hash})
        job = _job(self.job_id)
        self.assertTrue(job.finished)
        self.assertEqual(job.progress_target, 1)

    def test_no_raw_photos_completes_with_zero_target(self):
        self._make_photo(self._make_file("plain.jpg"))

        repair_ungrouped_file_variants(self.user, self.job_id)

        job = _job(self.job_id)
        self.assertTrue(job.finished)
        self.assertFalse(job.failed)
        self.assertEqual(job.progress_target, 0)

    def test_other_users_raw_photos_are_not_touched(self):
        raw = self._make_file("OTHER.CR2", user=self.other_user)
        jpeg = self._make_file("OTHER.jpg", user=self.other_user)
        raw_photo = self._make_photo(raw, owner=self.other_user)
        self._make_photo(jpeg, owner=self.other_user)

        repair_ungrouped_file_variants(self.user, self.job_id)

        self.assertTrue(Photo.objects.filter(pk=raw_photo.pk).exists())
        self.assertEqual(_job(self.job_id).progress_target, 0)

    def test_jpeg_match_that_is_the_same_photo_is_skipped(self):
        """``jpeg_photo.id != raw_photo.id`` guards against self-merge."""
        raw = self._make_file("SELF.CR2")
        raw_photo = self._make_photo(raw)

        with patch.object(
            repair_jobs, "find_matching_jpeg_photo", return_value=raw_photo
        ) as finder:
            repair_ungrouped_file_variants(self.user, self.job_id)

        finder.assert_called_once_with(raw.path, self.user)
        self.assertTrue(Photo.objects.filter(pk=raw_photo.pk).exists())
        self.assertTrue(_job(self.job_id).finished)

    # ---- multiple photos in one run ---------------------------------

    def test_handles_a_mix_of_merge_and_fix_in_one_run(self):
        raw_a = self._make_file("A.CR2")
        jpeg_a = self._make_file("A.jpg")
        raw_b = self._make_file("B.CR2")
        jpeg_b = self._make_file("B.jpg")

        merge_photo = self._make_photo(raw_a)
        target_photo = self._make_photo(jpeg_a)
        fix_photo = self._make_photo(raw_b, extra_files=[jpeg_b])

        repair_ungrouped_file_variants(self.user, self.job_id)

        self.assertFalse(Photo.objects.filter(pk=merge_photo.pk).exists())
        target_photo.refresh_from_db()
        self.assertIn(raw_a.hash, {f.hash for f in target_photo.files.all()})
        fix_photo.refresh_from_db()
        self.assertEqual(fix_photo.main_file.hash, jpeg_b.hash)

        job = _job(self.job_id)
        self.assertEqual(job.progress_target, 2)
        self.assertTrue(job.finished)

    # ---- job bookkeeping --------------------------------------------

    def test_reuses_an_existing_job_row_with_the_same_job_id(self):
        existing = LongRunningJob.objects.create(
            started_by=self.user,
            job_type=LongRunningJob.JOB_REPAIR_FILE_VARIANTS,
            job_id=str(self.job_id),
        )

        repair_ungrouped_file_variants(self.user, self.job_id)

        self.assertEqual(
            LongRunningJob.objects.filter(job_id=str(self.job_id)).count(), 1
        )
        existing.refresh_from_db()
        self.assertIsNotNone(existing.started_at)
        self.assertTrue(existing.finished)

    def test_complete_does_not_write_a_result_payload(self):
        repair_ungrouped_file_variants(self.user, self.job_id)
        self.assertIsNone(_job(self.job_id).result)

    # ---- error branch -----------------------------------------------

    def test_unexpected_error_marks_the_job_failed_and_is_swallowed(self):
        broken = MagicMock()
        broken.objects.filter.side_effect = RuntimeError("boom")

        with patch.object(repair_jobs, "Photo", broken):
            # No exception escapes the job function.
            repair_ungrouped_file_variants(self.user, self.job_id)

        job = _job(self.job_id)
        self.assertTrue(job.failed)
        self.assertTrue(job.finished)
        self.assertEqual(job.result, {"status": "failed", "error": "boom"})

    def test_error_during_the_loop_still_fails_the_job(self):
        raw = self._make_file("ERR.CR2")
        self._make_photo(raw)

        with patch.object(
            repair_jobs,
            "find_matching_jpeg_photo",
            side_effect=ValueError("kaboom"),
        ):
            repair_ungrouped_file_variants(self.user, self.job_id)

        job = _job(self.job_id)
        self.assertTrue(job.failed)
        self.assertFalse(
            LongRunningJob.objects.get(job_id=str(self.job_id)).result is None
        )
        self.assertEqual(job.result["error"], "kaboom")
