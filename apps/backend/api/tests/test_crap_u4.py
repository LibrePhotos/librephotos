"""
Characterization tests for api/directory_watcher/file_handlers.py.

Pins the *current* behavior of:
  - ``create_new_image``  (legacy single-file Photo creation, upload path)
  - ``handle_file_group`` (phase-2 handler of the two-phase scan)

These tests are deliberately behavioral snapshots taken before a refactor.
They assert what the code does today, not what it arguably should do.
"""

import os
import shutil
import tempfile
from unittest.mock import MagicMock, patch

import pyvips
from django.test import TestCase, override_settings

from api.directory_watcher import file_handlers
from api.directory_watcher.file_handlers import create_new_image, handle_file_group
from api.models import File, LongRunningJob, Photo
from api.models.file import calculate_hash
from api.tests.utils import create_test_user

MODULE = "api.directory_watcher.file_handlers"


def _write_image(path: str, width: int = 8) -> str:
    """Write a real (tiny) image file that pyvips can open."""
    pyvips.Image.black(width, 8).write_to_file(path)
    return path


def _write_bytes(path: str, payload: bytes) -> str:
    with open(path, "wb") as fh:
        fh.write(payload)
    return path


class FileHandlerTestBase(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.tmpdir = tempfile.mkdtemp(prefix="lp-crap-u4-")
        self.addCleanup(shutil.rmtree, self.tmpdir, True)
        # Embedded-motion-video detection reads the file with mmap; keep it
        # deterministic and off unless a test explicitly turns it on.
        patcher = patch(f"{MODULE}.has_embedded_motion_video", return_value=False)
        self.mock_has_embedded = patcher.start()
        self.addCleanup(patcher.stop)

    def p(self, name: str) -> str:
        return os.path.join(self.tmpdir, name)


class CreateNewImageTests(FileHandlerTestBase):
    # --- guard clauses -------------------------------------------------

    def test_invalid_media_returns_none_and_creates_nothing(self):
        path = self.p("not-an-image.txt")
        _write_bytes(path, b"hello")

        self.assertIsNone(create_new_image(self.user, path))
        self.assertEqual(0, Photo.objects.count())
        self.assertFalse(File.objects.filter(path=path).exists())

    def test_embedded_media_file_is_skipped(self):
        parent_path = _write_image(self.p("parent.png"), width=8)
        child_path = _write_image(self.p("child.png"), width=9)
        parent = File.create(parent_path, self.user)
        child = File.create(child_path, self.user)
        parent.embedded_media.add(child)

        with patch(f"{MODULE}.util.logger") as logger:
            self.assertIsNone(create_new_image(self.user, child_path))

        self.assertEqual(0, Photo.objects.count())
        logger.warning.assert_called_once()
        self.assertIn("embedded content file found", logger.warning.call_args[0][0])

    # --- metadata (XMP sidecar) branch ----------------------------------

    def test_metadata_file_attaches_to_matching_photo_and_returns_none(self):
        image_path = _write_image(self.p("IMG_100.png"), width=10)
        photo = create_new_image(self.user, image_path)
        self.assertIsNotNone(photo)

        xmp_path = _write_bytes(self.p("IMG_100.xmp"), b"<x:xmpmeta/>")
        result = create_new_image(self.user, xmp_path)

        # The sidecar is attached but the function reports None (no new Photo).
        self.assertIsNone(result)
        photo.refresh_from_db()
        self.assertTrue(photo.files.filter(path=xmp_path).exists())
        self.assertEqual(1, Photo.objects.count())

    def test_metadata_file_without_matching_photo_creates_no_file(self):
        xmp_path = _write_bytes(self.p("orphan.xmp"), b"<x:xmpmeta/>")

        with patch(f"{MODULE}.util.logger") as logger:
            self.assertIsNone(create_new_image(self.user, xmp_path))

        self.assertEqual(0, Photo.objects.count())
        self.assertFalse(File.objects.filter(path=xmp_path).exists())
        logger.warning.assert_called_once()
        self.assertIn("no photo to metadata file found", logger.warning.call_args[0][0])

    # --- RAW branch ------------------------------------------------------

    def test_raw_attaches_to_existing_jpeg_photo(self):
        jpeg_path = _write_image(self.p("IMG_200.jpg"), width=11)
        photo = create_new_image(self.user, jpeg_path)
        raw_path = _write_bytes(self.p("IMG_200.CR2"), b"raw-bytes-200")

        result = create_new_image(self.user, raw_path)

        self.assertEqual(photo.pk, result.pk)
        self.assertEqual(1, Photo.objects.count())
        self.assertTrue(result.files.filter(path=raw_path).exists())
        # main_file stays the JPEG - the RAW is only a variant.
        self.assertEqual(jpeg_path, result.main_file.path)
        self.assertEqual(File.RAW_FILE, File.objects.get(path=raw_path).type)

    def test_raw_already_attached_is_not_added_twice(self):
        jpeg_path = _write_image(self.p("IMG_201.jpg"), width=12)
        photo = create_new_image(self.user, jpeg_path)
        raw_path = _write_bytes(self.p("IMG_201.CR2"), b"raw-bytes-201")
        create_new_image(self.user, raw_path)
        count_before = photo.files.count()

        result = create_new_image(self.user, raw_path)

        self.assertEqual(photo.pk, result.pk)
        self.assertEqual(count_before, result.files.count())

    def test_raw_without_matching_jpeg_creates_its_own_photo(self):
        raw_path = _write_bytes(self.p("LONE.CR2"), b"raw-bytes-lone")

        photo = create_new_image(self.user, raw_path)

        self.assertIsNotNone(photo)
        self.assertEqual(calculate_hash(self.user, raw_path), photo.image_hash)
        self.assertEqual(raw_path, photo.main_file.path)
        self.assertFalse(photo.video)

    # --- video / Live Photo branch ---------------------------------------

    def _patch_is_video_by_extension(self):
        def fake_is_video(path):
            return str(path).lower().endswith(".mov")

        p1 = patch("api.models.file.is_video", side_effect=fake_is_video)
        p2 = patch(f"{MODULE}.is_video", side_effect=fake_is_video)
        p1.start()
        p2.start()
        self.addCleanup(p1.stop)
        self.addCleanup(p2.stop)

    @override_settings(FEATURE_VIDEO=True)
    def test_live_photo_video_attaches_to_matching_image_photo(self):
        image_path = _write_image(self.p("IMG_300.jpg"), width=13)
        photo = create_new_image(self.user, image_path)
        photo.video = True  # prove the handler forces this back to False
        photo.save()

        self._patch_is_video_by_extension()
        mov_path = _write_bytes(self.p("IMG_300.mov"), b"mov-bytes-300")

        result = create_new_image(self.user, mov_path)

        self.assertEqual(photo.pk, result.pk)
        self.assertEqual(1, Photo.objects.count())
        self.assertTrue(result.files.filter(path=mov_path).exists())
        self.assertFalse(result.video)
        self.assertEqual(image_path, result.main_file.path)

    @override_settings(FEATURE_VIDEO=True)
    def test_live_photo_video_already_attached_is_not_added_twice(self):
        image_path = _write_image(self.p("IMG_301.jpg"), width=14)
        photo = create_new_image(self.user, image_path)
        self._patch_is_video_by_extension()
        mov_path = _write_bytes(self.p("IMG_301.mov"), b"mov-bytes-301")
        create_new_image(self.user, mov_path)
        count_before = photo.files.count()

        result = create_new_image(self.user, mov_path)

        self.assertEqual(photo.pk, result.pk)
        self.assertEqual(count_before, result.files.count())

    @override_settings(FEATURE_VIDEO=True)
    def test_standalone_video_creates_photo_with_video_flag(self):
        self._patch_is_video_by_extension()
        mov_path = _write_bytes(self.p("CLIP.mov"), b"mov-bytes-standalone")

        photo = create_new_image(self.user, mov_path)

        self.assertIsNotNone(photo)
        self.assertTrue(photo.video)
        self.assertEqual(mov_path, photo.main_file.path)

    @override_settings(FEATURE_VIDEO=False)
    def test_video_is_rejected_when_video_feature_disabled(self):
        self._patch_is_video_by_extension()
        mov_path = _write_bytes(self.p("DISABLED.mov"), b"mov-bytes-disabled")

        self.assertIsNone(create_new_image(self.user, mov_path))
        self.assertEqual(0, Photo.objects.count())

    # --- standard creation ------------------------------------------------

    def test_standard_image_creates_photo_with_hash_and_main_file(self):
        path = _write_image(self.p("plain.png"), width=15)

        photo = create_new_image(self.user, path)

        self.assertIsNotNone(photo)
        self.assertEqual(calculate_hash(self.user, path), photo.image_hash)
        self.assertEqual(self.user, photo.owner)
        self.assertEqual({}, photo.geolocation_json)
        self.assertFalse(photo.video)
        self.assertIsNotNone(photo.added_on)
        self.assertEqual(path, photo.main_file.path)
        self.assertEqual([path], [f.path for f in photo.files.all()])
        self.assertEqual(File.IMAGE, photo.main_file.type)

    def test_rescanning_same_path_reuses_file_but_creates_second_photo(self):
        """Current behavior (documented, arguably a bug): calling
        create_new_image twice for the same standalone image reuses the File
        (unique path) but builds a *second* Photo, and the File's m2m /
        main_file are re-pointed at the newer Photo."""
        path = _write_image(self.p("dup.png"), width=16)

        first = create_new_image(self.user, path)
        second = create_new_image(self.user, path)

        self.assertNotEqual(first.pk, second.pk)
        self.assertEqual(2, Photo.objects.count())
        self.assertEqual(1, File.objects.filter(path=path).count())
        self.assertEqual(first.image_hash, second.image_hash)

    @override_settings(FEATURE_PROCESS_EMBEDDED_MEDIA=True, FEATURE_VIDEO=True)
    def test_embedded_motion_video_is_extracted_and_linked(self):
        path = _write_image(self.p("motion.png"), width=17)
        em_path = _write_bytes(self.p("motion_embedded.mp4"), b"embedded-video")
        self.mock_has_embedded.return_value = True

        with patch(f"{MODULE}.extract_embedded_motion_video", return_value=em_path):
            photo = create_new_image(self.user, path)

        paths = sorted(f.path for f in photo.files.all())
        self.assertEqual(sorted([path, em_path]), paths)
        self.assertEqual(path, photo.main_file.path)
        self.assertTrue(photo.main_file.embedded_media.filter(path=em_path).exists())

    @override_settings(FEATURE_PROCESS_EMBEDDED_MEDIA=True, FEATURE_VIDEO=True)
    def test_embedded_motion_video_extraction_failure_is_tolerated(self):
        path = _write_image(self.p("motion2.png"), width=18)
        self.mock_has_embedded.return_value = True

        with patch(f"{MODULE}.extract_embedded_motion_video", return_value=None):
            photo = create_new_image(self.user, path)

        self.assertEqual([path], [f.path for f in photo.files.all()])
        self.assertEqual(0, photo.main_file.embedded_media.count())

    @override_settings(FEATURE_PROCESS_EMBEDDED_MEDIA=False, FEATURE_VIDEO=True)
    def test_embedded_motion_video_skipped_when_feature_disabled(self):
        path = _write_image(self.p("motion3.png"), width=19)
        self.mock_has_embedded.return_value = True

        with patch(f"{MODULE}.extract_embedded_motion_video") as extract:
            photo = create_new_image(self.user, path)

        extract.assert_not_called()
        self.assertEqual([path], [f.path for f in photo.files.all()])


class HandleFileGroupTests(FileHandlerTestBase):
    def setUp(self):
        super().setUp()
        self.job_id = "u4-job"
        patcher = patch(f"{MODULE}._process_photo")
        self.mock_process = patcher.start()
        self.addCleanup(patcher.stop)

    def _make_job(self, target=2):
        return LongRunningJob.objects.create(
            started_by=self.user,
            job_id=self.job_id,
            job_type=LongRunningJob.JOB_SCAN_PHOTOS,
            progress_current=0,
            progress_target=target,
        )

    def test_groups_jpeg_and_raw_into_single_photo_and_processes_main_file(self):
        jpeg_path = _write_image(self.p("G_1.jpg"), width=20)
        raw_path = _write_bytes(self.p("G_1.CR2"), b"raw-bytes-g1")

        handle_file_group(self.user, [raw_path, jpeg_path], self.job_id)

        self.assertEqual(1, Photo.objects.count())
        photo = Photo.objects.first()
        self.assertEqual(jpeg_path, photo.main_file.path)
        self.assertEqual(
            sorted([jpeg_path, raw_path]), sorted(f.path for f in photo.files.all())
        )
        self.mock_process.assert_called_once()
        args = self.mock_process.call_args[0]
        self.assertEqual(photo.pk, args[0].pk)
        self.assertEqual(jpeg_path, args[1])
        self.assertEqual(self.job_id, args[2])

    def test_single_image_group_creates_photo(self):
        path = _write_image(self.p("G_2.png"), width=21)

        handle_file_group(self.user, [path], self.job_id)

        self.assertEqual(1, Photo.objects.count())
        self.assertEqual(path, Photo.objects.first().main_file.path)
        self.mock_process.assert_called_once()

    def test_no_valid_files_logs_warning_and_skips_processing(self):
        bad_path = _write_bytes(self.p("garbage.txt"), b"nope")

        with patch(f"{MODULE}.util.logger") as logger:
            handle_file_group(self.user, [bad_path], self.job_id)

        self.assertEqual(0, Photo.objects.count())
        self.mock_process.assert_not_called()
        self.assertIn("No valid files in group", logger.warning.call_args[0][0])

    def test_metadata_only_group_creates_no_photo(self):
        xmp_path = _write_bytes(self.p("only.xmp"), b"<x:xmpmeta/>")

        with patch(f"{MODULE}.util.logger") as logger:
            handle_file_group(self.user, [xmp_path], self.job_id)

        self.assertEqual(0, Photo.objects.count())
        self.mock_process.assert_not_called()
        warnings = [c[0][0] for c in logger.warning.call_args_list]
        self.assertTrue(any("Could not create photo for files" in w for w in warnings))
        # The File record for the sidecar IS created even though no Photo is.
        self.assertTrue(File.objects.filter(path=xmp_path).exists())

    def test_photo_without_main_file_is_not_processed(self):
        path = _write_image(self.p("G_3.png"), width=22)
        fake_photo = MagicMock()
        fake_photo.main_file = None

        with patch(f"{MODULE}.group_files_into_photo", return_value=fake_photo):
            handle_file_group(self.user, [path], self.job_id)

        self.mock_process.assert_not_called()

    def test_exception_is_swallowed_and_logged(self):
        path = _write_image(self.p("G_4.png"), width=23)

        with (
            patch(f"{MODULE}.group_files_into_photo", side_effect=RuntimeError("boom")),
            patch(f"{MODULE}.util.logger") as logger,
        ):
            handle_file_group(self.user, [path], self.job_id)  # must not raise

        logger.exception.assert_called_once()
        self.assertIn("could not process file group", logger.exception.call_args[0][0])
        self.assertIn("boom", logger.exception.call_args[0][0])

    def test_scan_counter_is_incremented_on_success(self):
        job = self._make_job(target=2)
        path = _write_image(self.p("G_5.png"), width=24)

        handle_file_group(self.user, [path], self.job_id)

        job.refresh_from_db()
        self.assertEqual(1, job.progress_current)
        self.assertFalse(job.finished)

    def test_scan_counter_is_incremented_even_when_processing_raises(self):
        job = self._make_job(target=2)
        path = _write_image(self.p("G_6.png"), width=25)
        self.mock_process.side_effect = RuntimeError("boom")

        handle_file_group(self.user, [path], self.job_id)

        job.refresh_from_db()
        self.assertEqual(1, job.progress_current)
        # The failure is only logged - update_scan_counter is called without
        # failed/error, so the job is NOT marked as failed.
        self.assertFalse(job.failed)

    def test_scan_counter_is_incremented_when_group_has_no_valid_files(self):
        job = self._make_job(target=2)
        bad_path = _write_bytes(self.p("garbage2.txt"), b"nope")

        handle_file_group(self.user, [bad_path], self.job_id)

        job.refresh_from_db()
        self.assertEqual(1, job.progress_current)

    def test_empty_path_list_is_a_no_op_but_still_counts(self):
        job = self._make_job(target=1)

        handle_file_group(self.user, [], self.job_id)

        self.assertEqual(0, Photo.objects.count())
        self.mock_process.assert_not_called()
        job.refresh_from_db()
        self.assertEqual(1, job.progress_current)

    def test_rerunning_group_reuses_existing_photo(self):
        jpeg_path = _write_image(self.p("G_7.jpg"), width=26)
        raw_path = _write_bytes(self.p("G_7.CR2"), b"raw-bytes-g7")

        handle_file_group(self.user, [jpeg_path], self.job_id)
        handle_file_group(self.user, [jpeg_path, raw_path], self.job_id)

        self.assertEqual(1, Photo.objects.count())
        photo = Photo.objects.first()
        self.assertEqual(
            sorted([jpeg_path, raw_path]), sorted(f.path for f in photo.files.all())
        )
        self.assertEqual(jpeg_path, photo.main_file.path)

    def test_main_file_is_upgraded_when_higher_priority_file_appears(self):
        raw_path = _write_bytes(self.p("G_8.CR2"), b"raw-bytes-g8")
        jpeg_path = _write_image(self.p("G_8.jpg"), width=27)

        handle_file_group(self.user, [raw_path], self.job_id)
        photo = Photo.objects.get()
        self.assertEqual(raw_path, photo.main_file.path)

        handle_file_group(self.user, [raw_path, jpeg_path], self.job_id)

        self.assertEqual(1, Photo.objects.count())
        photo.refresh_from_db()
        self.assertEqual(jpeg_path, photo.main_file.path)


class ModuleContractTests(TestCase):
    """Sanity checks a refactor must keep true."""

    def test_public_names_exist(self):
        for name in (
            "create_file_record",
            "group_files_into_photo",
            "create_new_image",
            "handle_new_image",
            "handle_file_group",
        ):
            self.assertTrue(hasattr(file_handlers, name), name)
