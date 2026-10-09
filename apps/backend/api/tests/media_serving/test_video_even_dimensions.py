"""Every libx264 conversion is handed an even width and height.

Since every conversion is forced to 4:2:0 for the browser's sake, libx264
refuses a picture with an odd side: half a chroma row does not exist. The
thumbnails always scaled to an even height, but the live and the cached
conversion keep a source under 720 lines at its own height, and a 4:2:2 or
4:4:4 source -- the very ones the forced pixel format was for -- can have an
odd one. Those conversions failed outright.
"""

import os
import shutil
import subprocess
import tempfile
import unittest
from unittest import mock

from django.test import SimpleTestCase, override_settings

from api import ffmpeg_budget, thumbnails, transcode_cache, video_color
from api.views import media


def _filter(command):
    # The whole argument: an SDR source gets the resize and nothing else.
    return command[command.index("-filter:v") + 1]


class EvenDimensionsCommandTest(SimpleTestCase):
    def setUp(self):
        ffmpeg_budget.reset_probe_cache()
        self.addCleanup(ffmpeg_budget.reset_probe_cache)

    def test_the_live_conversion_rounds_its_height_down_to_even(self):
        command = media.build_live_command("/v.mov", transfer="")
        self.assertEqual(_filter(command), "scale=-2:'trunc(min(720,ih)/2)*2'")
        self.assertEqual(command[command.index("-pix_fmt") + 1], "yuv420p")

    def test_the_cached_conversion_rounds_its_height_down_to_even(self):
        command = transcode_cache.build_command("/v.mov", "/out.mp4", transfer="")
        self.assertEqual(_filter(command), "scale=-2:'trunc(min(720,ih)/2)*2'")
        self.assertEqual(command[command.index("-pix_fmt") + 1], "yuv420p")

    def test_the_animated_thumbnails_were_already_even(self):
        for height in (500, 250):
            with mock.patch.object(thumbnails, "_run_ffmpeg") as run:
                thumbnails.create_animated_thumbnail(
                    "/v.mov", height, "out", "h", ".mp4", transfer=""
                )
            self.assertEqual(_filter(run.call_args.args[0]), f"scale=-2:{height}")


def _real_ffmpeg():
    return bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))


@unittest.skipUnless(_real_ffmpeg(), "no ffmpeg")
# Not niced: on Windows the only ``nice`` on PATH is Git's MSYS one, which
# re-parses its arguments and strips the quotes out of the scale expression.
@override_settings(TRANSCODE_CACHE_NICE=0)
class RealOddSizedSourceTest(SimpleTestCase):
    """A 4:2:2 and a 4:4:4 clip 241 lines high, through the real ffmpeg."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        ffmpeg_budget.reset_probe_cache()
        self.addCleanup(ffmpeg_budget.reset_probe_cache)

    def _source(self, pixel_format):
        # A colour source, not testsrc2: that one rounds its size to even.
        path = os.path.join(self.tmp.name, f"{pixel_format}.mkv")
        subprocess.run(
            [
                shutil.which("ffmpeg"),
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                "color=c=red:size=320x241:rate=5",
                "-t",
                "0.4",
                "-vf",
                f"format={pixel_format}",
                "-c:v",
                "ffv1",
                path,
            ],
            check=True,
            capture_output=True,
        )
        return path

    def _size(self, path):
        output = subprocess.run(
            [
                shutil.which("ffprobe"),
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=width,height,pix_fmt",
                "-of",
                "csv=p=0",
                path,
            ],
            capture_output=True,
            text=True,
            check=True,
        ).stdout
        return output.strip()

    def test_the_source_really_is_odd(self):
        self.assertEqual(self._size(self._source("yuv422p")), "320,241,yuv422p")

    def test_the_cached_copy_of_odd_sized_422_and_444_clips_encodes(self):
        for pixel_format in ("yuv422p", "yuv444p"):
            source = self._source(pixel_format)
            destination = os.path.join(self.tmp.name, f"{pixel_format}.mp4")
            command = transcode_cache.build_command(source, destination, transfer="")
            run = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(run.returncode, 0, run.stderr)
            self.assertEqual(self._size(destination), "318,240,yuv420p")

    def test_the_live_conversion_of_an_odd_sized_422_clip_encodes(self):
        source = self._source("yuv422p")
        command = media.build_live_command(source, transfer="")
        run = subprocess.run(command, capture_output=True)
        self.assertEqual(run.returncode, 0, run.stderr[-500:])
        self.assertGreater(len(run.stdout), 0)

    def test_the_old_scale_is_what_failed(self):
        """Pins the cause: without the rounding, libx264 refuses the picture."""
        source = self._source("yuv422p")
        destination = os.path.join(self.tmp.name, "old.mp4")
        with mock.patch.object(video_color, "PLAYBACK_SCALE", "scale=-2:'min(720,ih)'"):
            command = transcode_cache.build_command(source, destination, transfer="")
        run = subprocess.run(command, capture_output=True, text=True)
        self.assertNotEqual(run.returncode, 0)
        self.assertIn("not divisible by 2", run.stderr)
