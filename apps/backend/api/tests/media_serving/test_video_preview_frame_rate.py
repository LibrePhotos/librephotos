import os
import shutil
import subprocess
import tempfile
import unittest

from django.test import SimpleTestCase, override_settings

from api.thumbnails import render


def _real_ffmpeg() -> bool:
    return bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))


@unittest.skipUnless(_real_ffmpeg(), "no ffmpeg")
@override_settings(VIDEO_PREVIEW_SECONDS=1)
class VideoPreviewFrameRateTest(SimpleTestCase):
    def setUp(self) -> None:
        self.media = tempfile.TemporaryDirectory()
        self.addCleanup(self.media.cleanup)
        os.makedirs(os.path.join(self.media.name, "square_thumbnails"))
        settings = override_settings(MEDIA_ROOT=self.media.name)
        settings.enable()
        self.addCleanup(settings.disable)

    def _clip(self, rate: int) -> str:
        path = os.path.join(self.media.name, f"clip{rate}.mp4")
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
                f"testsrc2=size=320x180:rate={rate}:duration=1.5",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                path,
            ],
            check=True,
        )
        return path

    def _frames(self, path: str) -> tuple[str, int]:
        ffprobe = shutil.which("ffprobe")
        assert ffprobe is not None
        output = subprocess.run(
            [
                ffprobe,
                "-v",
                "error",
                "-count_frames",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=avg_frame_rate,nb_read_frames",
                "-of",
                "csv=p=0",
                path,
            ],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
        rate, frames = output.split(",")
        return rate, int(frames)

    def _preview(self, rate: int) -> tuple[str, int]:
        render.create_animated_thumbnail(
            self._clip(rate), 90, "square_thumbnails", "h", transfer="bt709"
        )
        return self._frames(os.path.join(self.media.name, "square_thumbnails", "h.mp4"))

    def test_a_slow_motion_clip_is_previewed_at_30_frames_a_second(self) -> None:
        self.assertEqual(self._preview(240), ("30/1", 30))

    def test_a_clip_below_30_frames_a_second_keeps_its_frames(self) -> None:
        self.assertEqual(self._preview(24), ("24/1", 24))
