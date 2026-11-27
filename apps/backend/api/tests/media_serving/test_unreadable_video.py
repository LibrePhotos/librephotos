import os
import shutil
import subprocess
import tempfile
import unittest
import uuid
from collections.abc import Sequence
from unittest import mock

from django.test import SimpleTestCase, TestCase, override_settings

from api.directory_watcher.file_handlers import handle_file_group
from api.jobs import upload_import
from api.models import LongRunningJob
from api.runtime import binaries
from api.tests.utils import create_test_job, create_test_photo, create_test_user
from api.thumbnails import render

WINDOWS_INVALID_DATA = 3199971767
POSIX_INVALID_DATA = 183


def _real_ffmpeg() -> bool:
    return bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))


def _exits(returncode: int) -> mock.Mock:
    def run(
        name: str, args: Sequence[str], **kwargs: float
    ) -> subprocess.CompletedProcess[bytes]:
        raise binaries.ToolFailedError("ffmpeg", returncode, "Invalid data found")

    return mock.Mock(side_effect=run)


class _MediaRoot:
    def media_root(self, case: unittest.TestCase) -> str:
        folder = tempfile.TemporaryDirectory()
        case.addCleanup(folder.cleanup)
        for directory in ("thumbnails_big", "square_thumbnails"):
            os.makedirs(os.path.join(folder.name, directory))
        settings = override_settings(MEDIA_ROOT=folder.name)
        settings.enable()
        case.addCleanup(settings.disable)
        return folder.name


class UnreadableVideoExitTest(SimpleTestCase):
    def setUp(self) -> None:
        _MediaRoot().media_root(self)
        no_filter = mock.patch.object(render.color, "video_filter", return_value=None)
        no_filter.start()
        self.addCleanup(no_filter.stop)

    def _thumbnail(self, returncode: int) -> None:
        with mock.patch.object(render.binaries, "run_tool", _exits(returncode)):
            render.create_thumbnail_for_video("/v.mp4", "thumbnails_big", "h", ".webp")

    def test_ffmpegs_invalid_data_exit_is_an_unreadable_video(self) -> None:
        for returncode in (WINDOWS_INVALID_DATA, POSIX_INVALID_DATA):
            with (
                self.subTest(returncode=returncode),
                self.assertRaises(render.UnreadableVideoError),
            ):
                self._thumbnail(returncode)

    def test_another_failure_is_not(self) -> None:
        with self.assertRaises(render.VideoThumbnailError) as raised:
            self._thumbnail(1)

        self.assertNotIsInstance(raised.exception, render.UnreadableVideoError)


@unittest.skipUnless(_real_ffmpeg(), "no ffmpeg")
class UnreadableVideoScanTest(TestCase):
    def setUp(self) -> None:
        self.media = _MediaRoot().media_root(self)
        self.user = create_test_user()
        self.job_id = str(uuid.uuid4())
        self.job = create_test_job(
            started_by=self.user,
            job_id=self.job_id,
            job_type=LongRunningJob.JOB_SCAN_PHOTOS,
            progress_current=0,
            progress_target=2,
        )
        self.video = os.path.join(self.media, "cut_short.mp4")
        self._write_cut_short_video()

    def _write_cut_short_video(self) -> None:
        whole = os.path.join(self.media, "whole.mp4")
        ffmpeg = shutil.which("ffmpeg")
        assert ffmpeg is not None
        subprocess.run(
            [
                ffmpeg,
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=320x180:rate=30:duration=1",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                whole,
            ],
            check=True,
        )
        with open(whole, "rb") as source, open(self.video, "wb") as cut:
            cut.write(source.read(4000))

    def test_ffmpeg_finds_no_video_in_the_file(self) -> None:
        with self.assertRaises(render.UnreadableVideoError):
            render.create_thumbnail_for_video(
                self.video, "thumbnails_big", "h", ".webp", transfer=""
            )

    def test_the_scan_counts_it_failed_with_a_warning(self) -> None:
        with self.assertLogs("api", "WARNING") as logs:
            handle_file_group(self.user, [self.video], self.job_id)

        self.assertEqual({record.levelname for record in logs.records}, {"WARNING"})

        self.job.refresh_from_db()
        self.assertEqual(self.job.progress_current, 1)
        self.assertEqual((self.job.result or {}).get("error_count"), 1)


class UnreadableUploadTest(TestCase):
    def test_the_upload_records_the_failed_step_with_a_warning(self) -> None:
        photo = create_test_photo(owner=create_test_user(), video=True)
        upload = upload_import.UploadedPhoto(photo, "/u/clip.mp4", str(uuid.uuid4()))
        unreadable = mock.Mock(side_effect=render.UnreadableVideoError("moov"))

        with (
            mock.patch.object(upload_import, "UPLOAD_STEPS", (("media", unreadable),)),
            self.assertLogs("api", "WARNING") as logs,
        ):
            outcome = upload_import.run_upload_steps(upload)

        self.assertEqual([record.levelname for record in logs.records], ["WARNING"])

        self.assertEqual((outcome.failed_stage, outcome.error), ("media", "moov"))
