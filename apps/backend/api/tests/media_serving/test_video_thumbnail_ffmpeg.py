"""Video thumbnails fail loudly when ffmpeg does.

``Popen(...).wait()`` had no timeout and ignored the exit code: a video ffmpeg
could not decode left no thumbnail and no error, and one it hung on parked the
worker forever. ffmpeg now runs with a timeout and its exit status checked,
the failure carries the end of its stderr, and a half-written file is removed
so the next pass does not take it for a finished thumbnail.
"""

import os
import tempfile
from unittest import mock

from django.test import SimpleTestCase, override_settings

from api.runtime import binaries
from api.thumbnails import render


def _failed_run(*args, **kwargs):
    raise binaries.ToolFailedError(
        "ffmpeg", 1, "...\n[mov] moov atom not found\nInvalid data found"
    )


def _hung_run(*args, **kwargs):
    raise binaries.ToolFailedError("ffmpeg", None, "frame=  12", kwargs["timeout"])


class VideoThumbnailFfmpegTest(SimpleTestCase):
    def setUp(self):
        self.media = tempfile.TemporaryDirectory()
        self.addCleanup(self.media.cleanup)
        os.makedirs(os.path.join(self.media.name, "out"))
        settings = override_settings(MEDIA_ROOT=self.media.name)
        settings.enable()
        self.addCleanup(settings.disable)
        tonemap = mock.patch.object(render.color, "video_filter", return_value=None)
        tonemap.start()
        self.addCleanup(tonemap.stop)
        self.output = os.path.join(self.media.name, "out", "h.webp")

    def test_ffmpeg_runs_with_a_timeout_and_its_status_checked(self):
        with mock.patch.object(render.binaries, "run_tool") as run:
            render.create_thumbnail_for_video("/v.mov", "out", "h", ".webp")

        name, command = run.call_args.args
        self.assertEqual(name, "ffmpeg")
        self.assertEqual(command[-1], self.output)
        self.assertIn("-y", command)
        self.assertEqual(run.call_args.kwargs["timeout"], render.FFMPEG_TIMEOUT)
        # run_tool checks the exit status unless told not to.
        self.assertNotIn("check", run.call_args.kwargs)

    def test_a_failed_run_raises_with_the_end_of_stderr(self):
        with (
            mock.patch.object(render.binaries, "run_tool", side_effect=_failed_run),
            self.assertLogs("api.thumbnails.render", "ERROR") as logs,
        ):
            with self.assertRaises(render.VideoThumbnailError) as raised:
                render.create_thumbnail_for_video("/v.mov", "out", "h", ".webp")

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
                render.binaries, "run_tool", side_effect=hang_after_writing
            ),
            self.assertLogs("api.thumbnails.render", "ERROR"),
        ):
            with self.assertRaisesRegex(render.VideoThumbnailError, "300 s"):
                render.create_thumbnail_for_video("/v.mov", "out", "h", ".webp")

        self.assertFalse(os.path.exists(self.output))

    def test_the_animated_thumbnail_fails_the_same_way(self):
        with (
            mock.patch.object(render.binaries, "run_tool", side_effect=_failed_run),
            self.assertLogs("api.thumbnails.render", "ERROR"),
        ):
            with self.assertRaises(render.VideoThumbnailError):
                render.create_animated_thumbnail("/v.mov", 250, "out", "h")
