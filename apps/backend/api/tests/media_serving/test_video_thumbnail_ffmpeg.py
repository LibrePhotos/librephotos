"""Video thumbnails fail loudly when ffmpeg does.

``Popen(...).wait()`` had no timeout and ignored the exit code: a video ffmpeg
could not decode left no thumbnail and no error, and one it hung on parked the
worker forever. ffmpeg now runs with a timeout and its exit status checked,
the failure carries the end of its stderr, and a half-written file is removed
so the next pass does not take it for a finished thumbnail.
"""

import os
import subprocess
import tempfile
from unittest import mock

from django.test import SimpleTestCase, override_settings

from api import thumbnails


def _failed_run(*args, **kwargs):
    raise subprocess.CalledProcessError(
        1, args[0], stderr=b"...\n[mov] moov atom not found\nInvalid data found"
    )


def _hung_run(*args, **kwargs):
    raise subprocess.TimeoutExpired(args[0], kwargs["timeout"], stderr=b"frame=  12")


class VideoThumbnailFfmpegTest(SimpleTestCase):
    def setUp(self):
        self.media = tempfile.TemporaryDirectory()
        self.addCleanup(self.media.cleanup)
        os.makedirs(os.path.join(self.media.name, "out"))
        settings = override_settings(MEDIA_ROOT=self.media.name)
        settings.enable()
        self.addCleanup(settings.disable)
        tonemap = mock.patch.object(
            thumbnails.video_color, "video_filter", return_value=None
        )
        tonemap.start()
        self.addCleanup(tonemap.stop)
        self.output = os.path.join(self.media.name, "out", "h.webp")

    def test_ffmpeg_runs_with_a_timeout_and_its_status_checked(self):
        with mock.patch.object(thumbnails.subprocess, "run") as run:
            thumbnails.create_thumbnail_for_video("/v.mov", "out", "h", ".webp")

        command = run.call_args.args[0]
        self.assertEqual(command[0], thumbnails.binaries.ffmpeg())
        self.assertEqual(command[-1], self.output)
        self.assertIn("-y", command)
        self.assertEqual(run.call_args.kwargs["timeout"], thumbnails.FFMPEG_TIMEOUT)
        self.assertIs(run.call_args.kwargs["check"], True)
        self.assertIs(run.call_args.kwargs["capture_output"], True)
        self.assertIs(run.call_args.kwargs["stdin"], subprocess.DEVNULL)

    def test_a_failed_run_raises_with_the_end_of_stderr(self):
        with (
            mock.patch.object(thumbnails.subprocess, "run", side_effect=_failed_run),
            self.assertLogs("ownphotos", "ERROR") as logs,
        ):
            with self.assertRaises(thumbnails.VideoThumbnailError) as raised:
                thumbnails.create_thumbnail_for_video("/v.mov", "out", "h", ".webp")

        self.assertIn("status 1", str(raised.exception))
        self.assertIn("Invalid data found", str(raised.exception))
        self.assertIn("Invalid data found", "".join(logs.output))

    def test_a_hung_run_raises_and_leaves_no_partial_file(self):
        def hang_after_writing(*args, **kwargs):
            with open(self.output, "wb") as partial:
                partial.write(b"half")
            _hung_run(*args, **kwargs)

        with (
            mock.patch.object(
                thumbnails.subprocess, "run", side_effect=hang_after_writing
            ),
            self.assertLogs("ownphotos", "ERROR"),
        ):
            with self.assertRaisesRegex(thumbnails.VideoThumbnailError, "300 s"):
                thumbnails.create_thumbnail_for_video("/v.mov", "out", "h", ".webp")

        self.assertFalse(os.path.exists(self.output))

    def test_the_animated_thumbnail_fails_the_same_way(self):
        with (
            mock.patch.object(thumbnails.subprocess, "run", side_effect=_failed_run),
            self.assertLogs("ownphotos", "ERROR"),
        ):
            with self.assertRaises(thumbnails.VideoThumbnailError):
                thumbnails.create_animated_thumbnail("/v.mov", 250, "out", "h", ".mp4")
