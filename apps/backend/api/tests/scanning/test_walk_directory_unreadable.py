"""One unreadable subdirectory must not fail the whole library scan (#2194).

``walk_directory`` listed every directory with an unguarded ``os.scandir``, so
a single folder the backend cannot read (a root-owned ``lost+found``, a NAS
recycle bin, a share subfolder with other permissions) raised out of the walk
and failed the scan job before any file was queued.

The walk now skips such a directory and reports it; the scan job lists it in
``result["errors"]`` and, because the files under it were not seen, does not
run the missing-file check. An unreadable scan root still fails the scan: that
means the library itself is unavailable.

``os.scandir`` is patched instead of using ``chmod``, so the tests run on
Windows and as root in CI.
"""

import os
import shutil
import tempfile
import uuid
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from unittest.mock import patch

from django.test import TestCase, override_settings

from api.directory_watcher import scan_jobs, utils
from api.directory_watcher.scan_jobs import scan_photos
from api.directory_watcher.utils import update_scan_counter, walk_directory
from api.models import LongRunningJob
from api.tests.scanning.test_scan_photos_orchestration import (
    ChainRecorder,
    TaskRecorder,
)
from api.tests.utils import create_test_user

_real_scandir = os.scandir


def _same_path(a: str, b: str) -> bool:
    return os.path.normcase(os.path.abspath(a)) == os.path.normcase(os.path.abspath(b))


@contextmanager
def _unreadable(directory: str, *, while_iterating: bool = False) -> Iterator[None]:
    """Make ``os.scandir`` fail for ``directory`` the way a 0700 folder does.

    ``while_iterating`` raises after the listing has started instead of when it
    is opened, as a share that drops mid-listing does.
    """

    def failing_entries(path: str) -> Iterator[os.DirEntry[str]]:
        raise PermissionError(13, "Permission denied", path)
        yield  # pragma: no cover - makes this a generator

    class FailingIterator:
        def __init__(self, path: str) -> None:
            self.entries = failing_entries(path)

        def __iter__(self) -> Iterator[os.DirEntry[str]]:
            return self.entries

        def __enter__(self) -> FailingIterator:
            return self

        def __exit__(self, *exc: object) -> None:
            return None

    def fake_scandir(path: str) -> object:
        if _same_path(path, directory):
            if while_iterating:
                return FailingIterator(path)
            raise PermissionError(13, "Permission denied", path)
        return _real_scandir(path)

    with patch.object(utils.os, "scandir", side_effect=fake_scandir):
        yield


def _write(path: str) -> str:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(b"jpeg")
    return path


class WalkSkipsUnreadableDirectoryTest(TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="walk-unreadable-")
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)
        self.top = _write(os.path.join(self.root, "top.jpg"))
        self.kept = _write(os.path.join(self.root, "album", "kept.jpg"))
        self.nested = _write(os.path.join(self.root, "album", "deeper", "n.jpg"))
        self.private = os.path.join(self.root, "private")
        _write(os.path.join(self.private, "hidden-from-us.jpg"))

    def test_other_directories_are_still_walked(self):
        found: list[str] = []
        with _unreadable(self.private):
            skipped = walk_directory(self.root, found)

        self.assertCountEqual(found, [self.top, self.kept, self.nested])
        self.assertEqual([entry.path for entry in skipped], [self.private])
        self.assertIn("Permission denied", skipped[0].error)

    def test_error_while_listing_skips_the_directory_too(self):
        found: list[str] = []
        with _unreadable(self.private, while_iterating=True):
            skipped = walk_directory(self.root, found)

        self.assertCountEqual(found, [self.top, self.kept, self.nested])
        self.assertEqual([entry.path for entry in skipped], [self.private])

    def test_nested_unreadable_directory_keeps_its_siblings(self):
        deeper = os.path.join(self.root, "album", "deeper")
        found: list[str] = []
        with _unreadable(deeper):
            skipped = walk_directory(self.root, found)

        self.assertIn(self.kept, found)
        self.assertNotIn(self.nested, found)
        self.assertEqual([entry.path for entry in skipped], [deeper])

    def test_readable_tree_reports_nothing_skipped(self):
        found: list[str] = []
        self.assertEqual(walk_directory(self.root, found), [])

    def test_unreadable_scan_root_still_raises(self):
        """An unreadable root means the library is unavailable: no silent scan."""
        found: list[str] = []
        with _unreadable(self.root), self.assertRaises(PermissionError):
            walk_directory(self.root, found)


class ScanWithUnreadableDirectoryTest(TestCase):
    def setUp(self):
        self.media_root = tempfile.mkdtemp(prefix="scan-unreadable-")
        self.addCleanup(shutil.rmtree, self.media_root, ignore_errors=True)
        self.scan_dir = os.path.join(self.media_root, "photos")
        self.photo = _write(os.path.join(self.scan_dir, "ok", "a.jpg"))
        self.private = os.path.join(self.scan_dir, "private")
        _write(os.path.join(self.private, "b.jpg"))
        self.user = create_test_user()
        self.user.scan_directory = self.scan_dir
        self.user.save(update_fields=["scan_directory"])
        self.job_id = str(uuid.uuid4())

    def run_scan(self, unreadable: str, after: Callable[[], None] | None = None):
        tasks = TaskRecorder([])
        with (
            override_settings(
                MEDIA_ROOT=self.media_root,
                FEATURE_REVERSE_GEOCODING=False,
                FEATURE_FACE_DETECTION=False,
            ),
            patch("api.jobs.queue.AsyncTask", tasks),
            patch("api.jobs.queue.Chain", ChainRecorder),
            self.captureOnCommitCallbacks(execute=True),
            patch.object(scan_jobs, "photo_scanner"),
            patch.object(scan_jobs, "backfill_missing_aspect_ratios"),
            patch.object(scan_jobs.db.connections, "close_all"),
            _unreadable(unreadable),
        ):
            scan_photos(self.user, False, self.job_id)
            if after is not None:
                after()
        return tasks

    def job(self) -> LongRunningJob:
        return LongRunningJob.objects.get(job_id=self.job_id)

    def finish_work(self) -> None:
        job = self.job()
        for _ in range(job.progress_target - job.progress_current):
            update_scan_counter(job.job_id)

    def test_scan_finishes_and_reports_the_skipped_directory(self):
        tasks = self.run_scan(self.private, after=self.finish_work)

        queued = [call[1][1] for call in tasks.find(scan_jobs.handle_file_group)]
        self.assertEqual(queued, [[self.photo]])
        job = self.job()
        self.assertTrue(job.finished)
        self.assertFalse(job.failed)
        self.assertEqual(job.result["status"], "partial_failure")
        self.assertEqual(len(job.result["errors"]), 1)
        self.assertIn(self.private, job.result["errors"][0])
        self.assertIn("skipped", job.result["errors"][0])

    def test_missing_file_check_is_not_queued(self):
        """Files under the skipped folder were not seen, so none is missing."""
        tasks = self.run_scan(self.private, after=self.finish_work)

        self.assertEqual(tasks.find(scan_jobs.scan_missing_photos), [])
        # The other follow-ups still run.
        self.assertEqual(len(tasks.find(scan_jobs.repair_ungrouped_file_variants)), 1)

    def test_scan_is_not_a_baseline_for_the_next_incremental_scan(self):
        """A change under the skipped folder must be found by the next scan."""
        self.run_scan(self.private, after=self.finish_work)

        self.assertNotIn(LongRunningJob.LIBRARY_SCAN, self.job().result)
        self.assertIsNone(
            LongRunningJob.baseline_for(self.user, LongRunningJob.JOB_SCAN_PHOTOS)
        )

    def test_skipped_directory_does_not_make_an_empty_scan_fail(self):
        """No file left to scan: the job still finishes, it is not failed."""
        shutil.rmtree(os.path.join(self.scan_dir, "ok"))
        self.run_scan(self.private)

        job = self.job()
        self.assertTrue(job.finished)
        self.assertFalse(job.failed)
        self.assertEqual(job.result["status"], "partial_failure")

    def test_unreadable_scan_root_fails_the_job(self):
        tasks = self.run_scan(self.scan_dir)

        job = self.job()
        self.assertTrue(job.failed)
        self.assertIn("Permission denied", job.result["error"])
        self.assertEqual(tasks.calls, [])


class SkippedDirectoriesStayOutOfTheThresholdTest(TestCase):
    def test_file_errors_alone_decide_whether_the_job_failed(self):
        """Many skipped folders plus one bad file is still a partial failure."""
        job_id = str(uuid.uuid4())
        user = create_test_user()
        LongRunningJob.claim(user, LongRunningJob.JOB_SCAN_PHOTOS, job_id)
        LongRunningJob.objects.filter(job_id=job_id).update(progress_target=100)
        skipped = [
            utils.SkippedDirectory(f"/photos/locked-{n}", "Permission denied")
            for n in range(20)
        ]

        utils.record_skipped_directories(job_id, skipped)
        update_scan_counter(job_id, failed=True, error="/photos/a.jpg: broken")

        job = LongRunningJob.objects.get(job_id=job_id)
        self.assertFalse(job.failed)
        self.assertEqual(job.result["status"], "partial_failure")
        self.assertEqual(job.result["error_count"], 21)
        self.assertEqual(len(job.result["errors"]), 21)
