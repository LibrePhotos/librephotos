"""A video whose edit list leaves no frame to show still gets its big thumbnail.

An iPhone clip (HEVC, a -90 degree display matrix, the video starting at
0.9086 s) failed with ffmpeg exit 244: "No filtered frames for output
stream", then libwebp_anim's "WebPAnimEncoderAssemble() failed" and "Cannot
allocate memory". Nothing ran out of memory: the MOV's edit list starts the
video past every frame it has, ffmpeg decoded none, and the animation encoder
fails when it is flushed with no frame. The still is now written by the still
encoder, and when no frame comes out the edit list is ignored, which shows
the frames the file holds. A run that still writes nothing is an error and
leaves no empty file behind, where the next pass would take it for a
thumbnail.
"""

import os
import shutil
import struct
import subprocess
import tempfile
import unittest
from unittest import mock

from django.test import SimpleTestCase, override_settings
from PIL import Image

from api.thumbnails import render

TRACK_TIMESCALE = 15360
NO_FRAME_STDERR = (
    b"[out#0/webp] Output file is empty, nothing was encoded"
    b"(check -ss / -t / -frames parameters if used)"
)


def _real_ffmpeg() -> bool:
    return bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))


def _edit_lists(data: bytearray) -> list[int]:
    """Where each ``elst`` box of a MOV starts (its size field)."""
    found = []
    start = data.find(b"elst")
    while start != -1:
        found.append(start - 4)
        start = data.find(b"elst", start + 4)
    return found


def _start_edits_past_the_end(path: str, media_time: int) -> None:
    """Point every edit that shows media at ``media_time``, past the last frame."""
    with open(path, "rb") as handle:
        data = bytearray(handle.read())
    for box in _edit_lists(data):
        version = data[box + 8]
        (count,) = struct.unpack(">I", data[box + 12 : box + 16])
        entry = box + 16
        width = 20 if version == 1 else 12
        for _ in range(count):
            time_at = entry + (8 if version == 1 else 4)
            time_format = ">q" if version == 1 else ">i"
            size = 8 if version == 1 else 4
            (time,) = struct.unpack(time_format, data[time_at : time_at + size])
            if time >= 0:
                data[time_at : time_at + size] = struct.pack(time_format, media_time)
            entry += width
    with open(path, "wb") as handle:
        handle.write(data)


@unittest.skipUnless(_real_ffmpeg(), "no ffmpeg")
class VideoThumbnailWithoutFramesTest(SimpleTestCase):
    def setUp(self) -> None:
        self.media = tempfile.TemporaryDirectory()
        self.addCleanup(self.media.cleanup)
        os.makedirs(os.path.join(self.media.name, "thumbnails_big"))
        settings = override_settings(MEDIA_ROOT=self.media.name)
        settings.enable()
        self.addCleanup(settings.disable)
        self.output = os.path.join(self.media.name, "thumbnails_big", "h.webp")

    def _clip(self) -> str:
        """Three 400 x 300 frames from 0.9086 s, shown turned -90 degrees."""
        plain = os.path.join(self.media.name, "plain.mov")
        clip = os.path.join(self.media.name, "live.mov")
        ffmpeg = shutil.which("ffmpeg")
        assert ffmpeg is not None
        quiet = [ffmpeg, "-hide_banner", "-loglevel", "error", "-y"]
        subprocess.run(
            [
                *quiet,
                "-itsoffset",
                "0.9086",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=400x300:rate=30:duration=0.1",
                "-c:v",
                "libx264",
                "-bf",
                "0",
                "-video_track_timescale",
                str(TRACK_TIMESCALE),
                plain,
            ],
            check=True,
        )
        subprocess.run(
            [*quiet, "-display_rotation", "-90", "-i", plain, "-c", "copy", clip],
            check=True,
        )
        _start_edits_past_the_end(clip, 5 * TRACK_TIMESCALE)
        return clip

    def test_the_big_thumbnail_shows_a_frame_the_edit_list_skips(self) -> None:
        clip = self._clip()

        render.create_thumbnail_for_video(clip, "thumbnails_big", "h", ".webp")

        with Image.open(self.output) as thumbnail:
            self.assertEqual(thumbnail.size, (300, 400))

    def test_a_run_that_decodes_no_frame_fails_and_leaves_no_file(self) -> None:
        def no_frame(
            name: str, args: list[str], **kwargs: object
        ) -> subprocess.CompletedProcess[bytes]:
            open(args[-1], "wb").close()
            return subprocess.CompletedProcess(args, 0, b"", NO_FRAME_STDERR)

        with (
            mock.patch.object(render.color, "video_filter", return_value=None),
            mock.patch.object(render.binaries, "run_tool", side_effect=no_frame) as run,
            self.assertRaisesRegex(render.VideoThumbnailError, "no frame"),
        ):
            render.create_thumbnail_for_video("/v.mov", "thumbnails_big", "h", ".webp")

        self.assertEqual(run.call_count, 2)
        self.assertEqual(run.call_args.args[1][:2], ["-ignore_editlist", "1"])
        self.assertFalse(os.path.exists(self.output))
