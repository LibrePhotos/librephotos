"""Characterization tests for api.all_tasks.zip_photos_task.

These pin the CURRENT observable behavior of the download-zip background task
before it is refactored.  They deliberately assert what the code does today,
including a couple of quirks that are called out in the comments.

The task only duck-types the photo/file objects it walks (``main_file``,
``files.all()``, ``stacks.filter(...)``, ``embedded_media``), so the tests use
lightweight fakes plus real files on disk instead of building deep ORM graphs.
The LongRunningJob is a real DB row because the task loads it by job_id.
"""

import os
import shutil
import tempfile
import zipfile

from django.test import TestCase, override_settings
from unittest.mock import MagicMock, patch

from api.all_tasks import zip_photos_task
from api.models.long_running_job import LongRunningJob
from api.tests.utils import create_test_user


class FakeRelated:
    """Stands in for a related manager (``files``, ``embedded_media``)."""

    def __init__(self, items=None, raises=None):
        self._items = list(items or [])
        self._raises = raises

    def all(self):
        if self._raises:
            raise self._raises
        return list(self._items)

    def exists(self):
        if self._raises:
            raise self._raises
        return bool(self._items)


class FakeFile:
    """Stands in for api.models.file.File."""

    def __init__(self, path, embedded_media=None, embedded_raises=None):
        self.path = path
        self.embedded_media = FakeRelated(embedded_media, raises=embedded_raises)


class FakeStack:
    def __init__(self, photos):
        self.photos = FakeRelated(photos)


class FakeStacks:
    """Stands in for ``photo.stacks`` (only ``.filter()`` is used)."""

    def __init__(self, stacks=None, raises=None):
        self._stacks = list(stacks or [])
        self._raises = raises

    def filter(self, **kwargs):
        if self._raises:
            raise self._raises
        return self

    def prefetch_related(self, *args, **kwargs):
        return list(self._stacks)

    def __iter__(self):
        return iter(self._stacks)


class FakePhoto:
    def __init__(self, main_file=None, files=None, stacks=None):
        self.main_file = main_file
        self.files = FakeRelated(files)
        self.stacks = stacks if stacks is not None else FakeStacks()


class ZipPhotosTaskTestBase(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.media_root = tempfile.mkdtemp(prefix="lp-crap-u0-media-")
        self.source_dir = tempfile.mkdtemp(prefix="lp-crap-u0-src-")
        self.addCleanup(shutil.rmtree, self.media_root, ignore_errors=True)
        self.addCleanup(shutil.rmtree, self.source_dir, ignore_errors=True)

        # django-q scheduling must not hit the broker/DB scheduler.
        schedule_patcher = patch("api.all_tasks.schedule")
        self.mock_schedule = schedule_patcher.start()
        self.addCleanup(schedule_patcher.stop)

        logger_patcher = patch("api.all_tasks.util.logger")
        self.mock_logger = logger_patcher.start()
        self.addCleanup(logger_patcher.stop)

    def make_job(self):
        return LongRunningJob.create_job(
            user=self.user, job_type=LongRunningJob.JOB_DOWNLOAD_PHOTOS
        )

    def write_source(self, relative_path, content=b"data"):
        full_path = os.path.join(self.source_dir, relative_path)
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        with open(full_path, "wb") as handle:
            handle.write(content)
        return full_path

    def run_task(self, photos, filename="download.zip", job=None):
        job = job or self.make_job()
        with override_settings(MEDIA_ROOT=self.media_root):
            result = zip_photos_task(
                job_id=job.job_id, user=self.user, photos=photos, filename=filename
            )
        job.refresh_from_db()
        return result, job

    def zip_names(self, zip_path):
        with zipfile.ZipFile(zip_path) as zf:
            return sorted(zf.namelist())


class ZipPhotosTaskHappyPathTest(ZipPhotosTaskTestBase):
    def test_writes_zip_and_returns_output_path(self):
        photo = FakePhoto(main_file=FakeFile(self.write_source("a.jpg", b"aaa")))

        result, job = self.run_task([photo], filename="out.zip")

        expected = os.path.join(self.media_root, "zip", "out.zip")
        self.assertEqual(result, expected)
        self.assertTrue(os.path.exists(expected))
        self.assertEqual(self.zip_names(expected), ["a.jpg"])
        with zipfile.ZipFile(expected) as zf:
            self.assertEqual(zf.read("a.jpg"), b"aaa")

    def test_creates_zip_output_directory_when_missing(self):
        self.assertFalse(os.path.exists(os.path.join(self.media_root, "zip")))
        photo = FakePhoto(main_file=FakeFile(self.write_source("a.jpg")))

        self.run_task([photo])

        self.assertTrue(os.path.isdir(os.path.join(self.media_root, "zip")))

    def test_job_is_started_completed_and_progress_tracked(self):
        photos = [
            FakePhoto(main_file=FakeFile(self.write_source("a.jpg"))),
            FakePhoto(main_file=FakeFile(self.write_source("b.jpg"))),
        ]

        _, job = self.run_task(photos)

        self.assertIsNotNone(job.started_at)
        self.assertTrue(job.finished)
        self.assertFalse(job.failed)
        self.assertEqual(job.progress_current, 2)
        self.assertEqual(job.progress_target, 2)

    def test_schedules_deletion_one_day_later(self):
        photo = FakePhoto(main_file=FakeFile(self.write_source("a.jpg")))

        self.run_task([photo], filename="later.zip")

        self.assertEqual(self.mock_schedule.call_count, 1)
        args, kwargs = self.mock_schedule.call_args
        self.assertEqual(args[0], "api.all_tasks.delete_zip_file")
        self.assertEqual(args[1], "later.zip")
        self.assertIn("next_run", kwargs)

    def test_main_file_and_files_are_both_included(self):
        main = FakeFile(self.write_source("main.jpg"))
        sidecar = FakeFile(self.write_source("main.jpg.xmp"))
        photo = FakePhoto(main_file=main, files=[sidecar])

        result, _ = self.run_task([photo])

        self.assertEqual(self.zip_names(result), ["main.jpg", "main.jpg.xmp"])

    def test_photo_without_main_file_uses_files_only(self):
        photo = FakePhoto(main_file=None, files=[FakeFile(self.write_source("f.jpg"))])

        result, _ = self.run_task([photo])

        self.assertEqual(self.zip_names(result), ["f.jpg"])

    def test_empty_photo_list_writes_empty_zero_byte_file(self):
        result, job = self.run_task([], filename="empty.zip")

        self.assertTrue(os.path.exists(result))
        # Nothing was ever written into the in-memory buffer, so the output is
        # a zero-byte file that is NOT a valid zip archive.
        self.assertEqual(os.path.getsize(result), 0)
        self.assertFalse(zipfile.is_zipfile(result))
        self.assertTrue(job.finished)
        self.assertEqual(job.progress_target, 0)


class ZipPhotosTaskDeduplicationTest(ZipPhotosTaskTestBase):
    def test_same_path_added_only_once(self):
        shared = FakeFile(self.write_source("shared.jpg"))
        photo_a = FakePhoto(main_file=shared)
        photo_b = FakePhoto(main_file=shared)

        result, _ = self.run_task([photo_a, photo_b])

        self.assertEqual(self.zip_names(result), ["shared.jpg"])

    def test_main_file_also_present_in_files_is_added_once(self):
        f = FakeFile(self.write_source("dup.jpg"))
        photo = FakePhoto(main_file=f, files=[f])

        result, _ = self.run_task([photo])

        self.assertEqual(self.zip_names(result), ["dup.jpg"])

    def test_same_basename_different_directories_gets_counter_suffix(self):
        a = FakeFile(self.write_source(os.path.join("one", "img.jpg"), b"one"))
        b = FakeFile(self.write_source(os.path.join("two", "img.jpg"), b"two"))

        result, _ = self.run_task([FakePhoto(main_file=a), FakePhoto(main_file=b)])

        self.assertEqual(self.zip_names(result), ["img.jpg", "img_1.jpg"])
        with zipfile.ZipFile(result) as zf:
            self.assertEqual(zf.read("img.jpg"), b"one")
            self.assertEqual(zf.read("img_1.jpg"), b"two")

    def test_three_colliding_basenames_increment_counter(self):
        files = [
            FakeFile(self.write_source(os.path.join(d, "img.jpg")))
            for d in ("one", "two", "three")
        ]

        result, _ = self.run_task([FakePhoto(main_file=f) for f in files])

        self.assertEqual(self.zip_names(result), ["img.jpg", "img_1.jpg", "img_2.jpg"])


class ZipPhotosTaskSkipTest(ZipPhotosTaskTestBase):
    def test_missing_file_on_disk_is_skipped_with_warning(self):
        present = FakeFile(self.write_source("present.jpg"))
        missing = FakeFile(os.path.join(self.source_dir, "gone.jpg"))

        result, job = self.run_task([FakePhoto(main_file=present, files=[missing])])

        self.assertEqual(self.zip_names(result), ["present.jpg"])
        self.assertTrue(self.mock_logger.warning.called)
        self.assertIn("File not found", self.mock_logger.warning.call_args[0][0])
        # The job still completes successfully.
        self.assertTrue(job.finished)
        self.assertFalse(job.failed)

    def test_file_with_empty_path_is_skipped(self):
        photo = FakePhoto(
            main_file=FakeFile(""),
            files=[FakeFile(self.write_source("ok.jpg"))],
        )

        result, _ = self.run_task([photo])

        self.assertEqual(self.zip_names(result), ["ok.jpg"])
        self.assertFalse(self.mock_logger.warning.called)

    def test_none_entry_in_files_is_skipped(self):
        photo = FakePhoto(
            main_file=None, files=[None, FakeFile(self.write_source("ok.jpg"))]
        )

        result, _ = self.run_task([photo])

        self.assertEqual(self.zip_names(result), ["ok.jpg"])


class ZipPhotosTaskEmbeddedMediaTest(ZipPhotosTaskTestBase):
    def test_embedded_media_of_main_file_is_included(self):
        video = FakeFile(self.write_source("live.mov"))
        main = FakeFile(self.write_source("live.jpg"), embedded_media=[video])

        result, _ = self.run_task([FakePhoto(main_file=main)])

        self.assertEqual(self.zip_names(result), ["live.jpg", "live.mov"])

    def test_embedded_media_error_skips_that_file_but_keeps_others(self):
        # The ``except: continue`` inside the embedded-media loop only skips
        # collecting variants; the offending file itself is still zipped later.
        boom = FakeFile(
            self.write_source("boom.jpg"), embedded_raises=RuntimeError("db down")
        )
        ok = FakeFile(self.write_source("ok.jpg"))

        result, job = self.run_task([FakePhoto(main_file=boom, files=[ok])])

        self.assertEqual(self.zip_names(result), ["boom.jpg", "ok.jpg"])
        self.assertTrue(job.finished)
        self.assertFalse(job.failed)


class ZipPhotosTaskStacksTest(ZipPhotosTaskTestBase):
    def test_variant_stack_members_are_included(self):
        raw = FakeFile(self.write_source("shot.dng"))
        stack_photo = FakePhoto(main_file=raw)
        jpeg = FakeFile(self.write_source("shot.jpg"))
        photo = FakePhoto(main_file=jpeg, stacks=FakeStacks([FakeStack([stack_photo])]))

        result, _ = self.run_task([photo])

        self.assertEqual(self.zip_names(result), ["shot.dng", "shot.jpg"])

    def test_stack_filter_is_restricted_to_variant_stack_types(self):
        stacks = FakeStacks()
        stacks.filter = MagicMock(return_value=stacks)
        photo = FakePhoto(main_file=FakeFile(self.write_source("a.jpg")), stacks=stacks)

        self.run_task([photo])

        stacks.filter.assert_called_once_with(stack_type__in=["raw_jpeg", "live_photo"])

    def test_stack_lookup_failure_is_swallowed(self):
        photo = FakePhoto(
            main_file=FakeFile(self.write_source("a.jpg")),
            stacks=FakeStacks(raises=RuntimeError("no stacks table")),
        )

        result, job = self.run_task([photo])

        self.assertEqual(self.zip_names(result), ["a.jpg"])
        self.assertTrue(job.finished)
        self.assertFalse(job.failed)


class ZipPhotosTaskErrorHandlingTest(ZipPhotosTaskTestBase):
    def test_unexpected_error_is_logged_and_job_still_completes(self):
        photo = FakePhoto(main_file=FakeFile(self.write_source("a.jpg")))
        job = self.make_job()

        with patch("api.all_tasks.zipfile.ZipFile", side_effect=OSError("nope")):
            result, job = self.run_task([photo], filename="broken.zip", job=job)

        # No zip is written, but the task still returns the path it would have
        # written, marks the job complete (NOT failed) and schedules cleanup.
        self.assertEqual(result, os.path.join(self.media_root, "zip", "broken.zip"))
        self.assertFalse(os.path.exists(result))
        self.assertTrue(self.mock_logger.error.called)
        self.assertIn(
            "Error while converting files to zip",
            self.mock_logger.error.call_args[0][0],
        )
        self.assertTrue(job.finished)
        self.assertFalse(job.failed)
        self.assertEqual(self.mock_schedule.call_count, 1)

    def test_missing_job_id_raises_before_any_work(self):
        with override_settings(MEDIA_ROOT=self.media_root):
            with self.assertRaises(LongRunningJob.DoesNotExist):
                zip_photos_task(
                    job_id="does-not-exist",
                    user=self.user,
                    photos=[],
                    filename="x.zip",
                )
        self.assertFalse(self.mock_schedule.called)

    def test_photos_must_support_len(self):
        # ``count = len(photos)`` runs after lrj.start(), so a generator blows
        # up with the job already marked as started but never completed.
        job = self.make_job()
        with override_settings(MEDIA_ROOT=self.media_root):
            with self.assertRaises(TypeError):
                zip_photos_task(
                    job_id=job.job_id,
                    user=self.user,
                    photos=(p for p in []),
                    filename="x.zip",
                )
        job.refresh_from_db()
        self.assertIsNotNone(job.started_at)
        self.assertFalse(job.finished)
