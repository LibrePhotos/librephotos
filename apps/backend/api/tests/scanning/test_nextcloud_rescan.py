"""A repeat Nextcloud scan leaves one Photo per file (#2257).

``scan_photos`` handed every listed file to ``handle_new_image`` on every run,
and ``create_new_image`` had no "already indexed" check for a known path, so
each scan added one more Photo row per file (same owner, same ``File``) and
processed all of them again. The WebDAV client is mocked: no server is contacted.
"""

import os
import shutil
import tempfile
import uuid
from unittest import mock

import pyvips
from django.test import TestCase, override_settings
from owncloud import FileInfo

from api.models import LongRunningJob, Photo
from api.tests.utils import create_test_user, patch_nextcloud_dns
from nextcloud import directory_watcher


def _remote_file(path: str, content_type: str = "image/png") -> FileInfo:
    return FileInfo(path, "file", {"{DAV:}getcontenttype": content_type})


class NextcloudRescanTest(TestCase):
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
        self.listing = [_remote_file("/Photos/a.png"), _remote_file("/Photos/b.png")]
        self.nc = mock.MagicMock()
        self.nc.list.side_effect = lambda path: list(self.listing)
        self.nc.get_file.side_effect = self._write_image
        self._patch("nextcloud.server_address.GuardedClient", return_value=self.nc)
        self._patch("nextcloud.directory_watcher.build_image_similarity_index")
        # Thumbnails, EXIF and the rest are not what this is about; counting
        # the calls tells which files a scan processed.
        self.process = self._patch("api.directory_watcher.file_handlers._process_photo")

    def _patch(self, target, **kwargs):
        patcher = mock.patch(target, **kwargs)
        self.addCleanup(patcher.stop)
        return patcher.start()

    @staticmethod
    def _write_image(remote_path, local_path):
        # A distinct size per file name, so the files hash differently.
        width = sum(map(ord, remote_path)) % 64 + 8
        with open(local_path, "wb") as f:
            f.write(pyvips.Image.black(width, 8).write_to_buffer(".png"))
        return True

    def _scan(self):
        job_id = uuid.uuid4()
        result = directory_watcher.scan_photos(self.user, job_id)
        job = LongRunningJob.objects.get(job_id=str(job_id))
        self.assertTrue(result["status"], job.result)
        return job

    def _processed(self):
        return sorted(os.path.basename(c.args[1]) for c in self.process.call_args_list)

    def test_repeat_scans_leave_one_photo_per_file(self):
        self._scan()
        self._scan()
        self._scan()

        photos = Photo.objects.owned_by(self.user)
        self.assertEqual(2, photos.count())
        self.assertEqual(
            ["a.png", "b.png"],
            sorted(os.path.basename(p.main_file.path) for p in photos),
        )

    def test_repeat_scan_does_not_process_indexed_files_again(self):
        self._scan()
        self.assertEqual(["a.png", "b.png"], self._processed())
        self.process.reset_mock()

        self._scan()

        self.assertEqual([], self._processed())

    def test_a_file_new_on_the_server_is_imported_by_the_next_scan(self):
        self._scan()
        self.process.reset_mock()
        self.listing.append(_remote_file("/Photos/c.png"))

        self._scan()

        self.assertEqual(["c.png"], self._processed())
        self.assertEqual(3, Photo.objects.owned_by(self.user).count())
