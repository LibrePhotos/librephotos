import os
import subprocess
import tempfile
from collections.abc import Sequence
from unittest import mock

import pyvips
from django.test import TestCase, override_settings

from api.models import Photo
from api.runtime import binaries
from api.runtime.features import forget_site_switches
from api.tests.utils import create_test_photo, create_test_user
from api.thumbnails import render

SQUARE = "square_thumbnails"


def _timed_out(
    name: str, args: Sequence[str], **kwargs: float
) -> subprocess.CompletedProcess[bytes]:
    raise binaries.ToolFailedError("ffmpeg", None, "frame=  443", kwargs["timeout"])


def _failed(
    name: str, args: Sequence[str], **kwargs: float
) -> subprocess.CompletedProcess[bytes]:
    raise binaries.ToolFailedError("ffmpeg", 1, "Conversion failed!")


class VideoPreviewTimeoutTest(TestCase):
    def setUp(self) -> None:
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.media_root = folder.name
        overrider = override_settings(MEDIA_ROOT=self.media_root)
        overrider.enable()
        self.addCleanup(overrider.disable)
        for directory in ("thumbnails_big", SQUARE):
            os.makedirs(os.path.join(self.media_root, directory))
        forget_site_switches()
        self.addCleanup(forget_site_switches)
        self.video = create_test_photo(owner=create_test_user(), video=True)
        args = mock.patch.object(render.color, "h264_video_args", return_value=[])
        args.start()
        self.addCleanup(args.stop)

    def _path(self, directory: str, extension: str) -> str:
        return os.path.join(
            self.media_root, directory, self.video.image_hash + extension
        )

    def _big_thumbnail(self, readable: bool = True) -> None:
        path = self._path("thumbnails_big", ".webp")
        if readable:
            pyvips.Image.black(1200, 900).write_to_file(path)
            return
        with open(path, "wb") as handle:
            handle.write(b"RIFF\x0c\x00\x00\x00WEBPVP8 junk")

    def _render(self, run: object) -> Photo:
        with (
            mock.patch.object(render.binaries, "run_tool", side_effect=run),
            self.captureOnCommitCallbacks(execute=True),
        ):
            render.generate_thumbnail(self.video.thumbnail)
        self.video.thumbnail.refresh_from_db()
        return self.video

    def test_a_preview_that_times_out_leaves_the_video_its_still(self) -> None:
        self._big_thumbnail()

        with (
            self.assertNoLogs("api.thumbnails.render", "ERROR"),
            self.assertLogs("api.thumbnails.render", "WARNING") as logs,
        ):
            video = self._render(_timed_out)

        self.assertEqual(
            video.thumbnail.square_thumbnail.name,
            os.path.join(SQUARE, f"{video.image_hash}.webp"),
        )
        self.assertTrue(video.thumbnail.video_poster)
        self.assertTrue(os.path.exists(self._path(SQUARE, ".webp")))
        self.assertFalse(os.path.exists(self._path(SQUARE, ".mp4")))
        self.assertIn(video.image_hash, logs.output[0])

    def test_without_a_still_a_preview_that_times_out_fails(self) -> None:
        self._big_thumbnail(readable=False)

        with self.assertRaises(render.VideoThumbnailError):
            self._render(_timed_out)

    def test_a_preview_that_fails_otherwise_still_fails(self) -> None:
        self._big_thumbnail()

        with self.assertRaises(render.VideoThumbnailError):
            self._render(_failed)
