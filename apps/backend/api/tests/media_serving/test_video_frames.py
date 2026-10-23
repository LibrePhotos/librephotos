"""Grabbing one frame of a video for the face scan (#2761)."""

import os
import tempfile
import unittest
from unittest import mock

from django.test import SimpleTestCase
from PIL import Image

from api.runtime import binaries
from api.video import frames


def _failed_run(*args: object, **kwargs: object) -> None:
    raise binaries.ToolFailedError("ffmpeg", 1, "moov atom not found")


class FrameArgsTest(SimpleTestCase):
    def test_seeks_before_the_input_and_writes_one_frame(self) -> None:
        with mock.patch.object(frames.color, "video_filter", return_value=None):
            args = frames.frame_args("/v.mov", 12.3456, "/tmp/f.jpg", "bt709")

        self.assertEqual(["-y", "-ss", "12.346", "-i", "/v.mov"], args[:5])
        self.assertIn("-frames:v", args)
        self.assertNotIn("-filter:v", args)
        self.assertEqual("/tmp/f.jpg", args[-1])

    def test_an_hdr_video_is_tonemapped(self) -> None:
        with mock.patch.object(
            frames.color, "video_filter", return_value="tonemap"
        ) as video_filter:
            args = frames.frame_args("/v.mov", 1.0, "/tmp/f.jpg", "smpte2084")

        video_filter.assert_called_once_with("/v.mov", transfer="smpte2084")
        self.assertEqual(["-filter:v", "tonemap", "/tmp/f.jpg"], args[-3:])


class GrabFrameTest(SimpleTestCase):
    def setUp(self) -> None:
        tonemap = mock.patch.object(frames.color, "video_filter", return_value=None)
        tonemap.start()
        self.addCleanup(tonemap.stop)

    def test_ffmpeg_runs_with_a_timeout(self) -> None:
        with (
            tempfile.TemporaryDirectory() as folder,
            mock.patch.object(frames.binaries, "run_tool") as run,
        ):
            output = os.path.join(folder, "f.jpg")
            open(output, "wb").close()
            frames.grab_frame("/v.mov", 2.0, output)

        self.assertEqual("ffmpeg", run.call_args.args[0])
        self.assertEqual(frames.FRAME_TIMEOUT, run.call_args.kwargs["timeout"])

    def test_a_failed_run_is_a_frame_error(self) -> None:
        with (
            mock.patch.object(frames.binaries, "run_tool", side_effect=_failed_run),
            self.assertRaises(frames.FrameError) as raised,
        ):
            frames.grab_frame("/v.mov", 2.0, "/nowhere/f.jpg")

        self.assertIn("moov atom", str(raised.exception))

    def test_no_frame_written_is_a_frame_error(self) -> None:
        """Past the end of the video ffmpeg writes nothing and exits 0."""
        with (
            mock.patch.object(frames.binaries, "run_tool"),
            self.assertRaises(frames.FrameError),
        ):
            frames.grab_frame("/v.mov", 99.0, "/nowhere/f.jpg")


@unittest.skipUnless(binaries.available("ffmpeg"), "no ffmpeg")
class RealFrameTest(unittest.TestCase):
    """A synthetic clip: the frame at a time is the picture shown then."""

    def test_the_frame_at_a_time_is_grabbed_at_the_video_size(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            clip = os.path.join(folder, "clip.mp4")
            # Red for the first second, blue for the second one.
            binaries.run_tool(
                "ffmpeg",
                [
                    "-y",
                    "-loglevel",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                    "color=c=red:size=96x64:duration=1:rate=10",
                    "-f",
                    "lavfi",
                    "-i",
                    "color=c=blue:size=96x64:duration=1:rate=10",
                    "-filter_complex",
                    "[0:v][1:v]concat=n=2:v=1",
                    "-pix_fmt",
                    "yuv420p",
                    clip,
                ],
                timeout=60,
            )
            output = os.path.join(folder, "frame.jpg")
            frames.grab_frame(clip, 1.5, output, transfer="bt709")

            with Image.open(output) as frame:
                self.assertEqual((96, 64), frame.size)
                red, _, blue = frame.convert("RGB").getpixel((48, 32))
            self.assertGreater(blue, 200)
            self.assertLess(red, 60)

            with self.assertRaises(frames.FrameError):
                frames.grab_frame(
                    clip, 30.0, os.path.join(folder, "late.jpg"), transfer="bt709"
                )
