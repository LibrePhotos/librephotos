"""The Nextcloud scan counts like a scan of chosen files and runs its follow-ups (#2734).

It set its progress target only after the first photo, while
``handle_new_image`` already counted that photo against a target of 0 and
finished the job; and it never queued the scan's follow-ups (tags, places,
search embeddings, faces), so imported photos waited for a local scan. The
WebDAV client is mocked: no server is contacted.
"""

import shutil
import tempfile
import uuid
from unittest import mock

import pyvips
from django.test import TestCase, override_settings
from owncloud import FileInfo

from api.directory_watcher import file_handlers
from api.models import LongRunningJob
from api.tests.utils import create_test_user, patch_nextcloud_dns
from nextcloud import directory_watcher


def _remote_file(path: str) -> FileInfo:
    return FileInfo(path, "file", {"{DAV:}getcontenttype": "image/png"})


class NextcloudScanFollowupsTest(TestCase):
    def setUp(self):
        dns = patch_nextcloud_dns()
        dns.start()
        self.addCleanup(dns.stop)
        self.data_root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.data_root, ignore_errors=True)
        settings_override = override_settings(DATA_ROOT=self.data_root)
        settings_override.enable()
        self.addCleanup(settings_override.disable)
        self.user = create_test_user(
            nextcloud_server_address="https://cloud.example.com",
            nextcloud_username="alice",
            nextcloud_app_password="app-password",
            nextcloud_scan_directory="/Photos",
        )
        self.listing = [
            _remote_file("/Photos/a.png"),
            _remote_file("/Photos/b.png"),
            _remote_file("/Photos/c.png"),
        ]
        self.nc = mock.MagicMock()
        self.nc.list.side_effect = lambda path: list(self.listing)
        self.nc.get_file.side_effect = self._write_image
        self._patch("nextcloud.server_address.GuardedClient", return_value=self.nc)
        self._patch("api.directory_watcher.file_handlers._process_photo")
        self.followups = self._patch(
            "api.directory_watcher.scan_jobs._queue_followup_jobs"
        )
        # The job as each photo found it, read just before it was handled.
        self.seen: list[tuple[int, int, bool]] = []
        self._patch(
            "nextcloud.directory_watcher.handle_new_image",
            side_effect=self._handle_new_image,
        )

    def _patch(self, target, **kwargs):
        patcher = mock.patch(target, **kwargs)
        self.addCleanup(patcher.stop)
        return patcher.start()

    @staticmethod
    def _write_image(remote_path, local_path):
        width = sum(map(ord, remote_path)) % 64 + 8
        with open(local_path, "wb") as f:
            f.write(pyvips.Image.black(width, 8).write_to_buffer(".png"))
        return True

    def _handle_new_image(self, user, path, job_id):
        job = LongRunningJob.objects.get(job_id=str(job_id))
        self.seen.append((job.progress_current, job.progress_target, job.finished))
        file_handlers.handle_new_image(user, path, job_id)

    def _scan(self) -> LongRunningJob:
        job_id = uuid.uuid4()
        result = directory_watcher.scan_photos(self.user, job_id)
        job = LongRunningJob.objects.get(job_id=str(job_id))
        self.assertTrue(result["status"], job.result)
        return job

    def test_progress_counts_up_to_the_file_count_before_finishing(self):
        job = self._scan()

        self.assertEqual([(0, 3, False), (1, 3, False), (2, 3, False)], self.seen)
        self.assertEqual((3, 3), (job.progress_current, job.progress_target))
        self.assertTrue(job.finished)
        self.assertFalse(job.failed)

    def test_the_finished_scan_queues_the_follow_ups_once(self):
        self._scan()

        self.followups.assert_called_once_with(self.user, False, False)

    def test_a_scan_with_nothing_new_finishes_and_queues_the_follow_ups(self):
        self._scan()
        self.followups.reset_mock()
        self.seen.clear()

        job = self._scan()

        self.assertEqual([], self.seen)
        self.assertTrue(job.finished)
        self.assertEqual((0, 0), (job.progress_current, job.progress_target))
        self.followups.assert_called_once_with(self.user, False, False)

    def test_the_import_is_never_the_local_scan_baseline(self):
        job = self._scan()

        self.assertNotIn(LongRunningJob.LIBRARY_SCAN, job.result)
        self.assertIsNone(
            LongRunningJob.baseline_for(self.user, LongRunningJob.JOB_SCAN_PHOTOS)
        )

    def test_a_cancelled_scan_queues_no_follow_ups(self):
        def cancel_then_handle(user, path, job_id):
            LongRunningJob.objects.get(job_id=str(job_id)).cancel()
            self._handle_new_image(user, path, job_id)

        with mock.patch(
            "nextcloud.directory_watcher.handle_new_image",
            side_effect=cancel_then_handle,
        ):
            job_id = uuid.uuid4()
            directory_watcher.scan_photos(self.user, job_id)

        job = LongRunningJob.objects.get(job_id=str(job_id))
        self.assertTrue(job.cancelled)
        self.followups.assert_not_called()
