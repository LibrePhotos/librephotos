"""What an HDR source has to go through before a browser can show it (#455).

A phone that records in HDR hands over samples on a PQ or HLG transfer curve.
Every conversion in this codebase ends in libx264, and libx264 given those
samples writes them out as-is: the curve survives, the tags that said what the
curve was do not, and the browser reads ten thousand nits of range as if it were
a hundred. That is the washed-out picture in the report.

Covered here: that the tonemap chain is added for exactly the two HDR transfer
curves and no others, that it survives an ffmpeg without zscale, that a source
that cannot be probed is converted the way it always was, and that all four
conversion sites ask.
"""

import re
import shutil
import subprocess
import unittest
from unittest import mock

from django.test import SimpleTestCase

from api import ffmpeg_budget, transcode_cache, video_color
from api.views import media

# The whole point of the exercise, in the order the filters have to run.
TONEMAP = (
    "zscale=t=linear:npl=100,"
    "format=gbrpf32le,"
    "zscale=p=bt709,"
    "tonemap=mobius:desat=0,"
    "zscale=t=bt709:m=bt709:r=tv,"
    "format=yuv420p"
)


def _ffprobe_saying(transfer):
    """An ffprobe that reports ``transfer``, in the shape the real one uses."""
    payload = '{"streams": [{"color_transfer": "%s"}]}' % transfer
    return mock.Mock(return_value=mock.Mock(stdout=payload))


def _filter_arg(command):
    """The -filter:v value, or None when the command carries no filter."""
    if "-filter:v" not in command:
        return None
    return command[command.index("-filter:v") + 1]


class TransferProbeTest(SimpleTestCase):
    def setUp(self):
        self.which = mock.patch.object(
            video_color.shutil, "which", return_value="/usr/bin/ffprobe"
        )
        self.which.start()
        self.addCleanup(self.which.stop)

    def test_reads_the_transfer_curve_out_of_ffprobe(self):
        with mock.patch.object(
            video_color.subprocess, "run", _ffprobe_saying("smpte2084")
        ):
            self.assertEqual(
                video_color.transfer_characteristics("/v.mov"), "smpte2084"
            )

    def test_asks_only_about_the_first_video_stream(self):
        """A file's audio and subtitle streams have no colour to report."""
        run = _ffprobe_saying("bt709")
        with mock.patch.object(video_color.subprocess, "run", run):
            video_color.transfer_characteristics("/v.mov")
        argv = run.call_args[0][0]
        self.assertTrue(argv[0].endswith(("ffprobe", "ffprobe.EXE", "ffprobe.exe")))
        self.assertIn("-select_streams", argv)
        self.assertEqual(argv[argv.index("-select_streams") + 1], "v:0")
        self.assertEqual(argv[-1], "/v.mov")

    def test_pq_and_hlg_are_the_hdr_ones(self):
        for transfer in ("smpte2084", "arib-std-b67"):
            with mock.patch.object(
                video_color.subprocess, "run", _ffprobe_saying(transfer)
            ):
                self.assertTrue(video_color.is_hdr("/v.mov"), transfer)

    def test_ordinary_sdr_video_is_not_hdr(self):
        for transfer in ("bt709", "smpte170m", "iec61966-2-1", "unknown", ""):
            with mock.patch.object(
                video_color.subprocess, "run", _ffprobe_saying(transfer)
            ):
                self.assertFalse(video_color.is_hdr("/v.mov"), transfer)

    def test_a_file_that_does_not_say_is_treated_as_sdr(self):
        """ffprobe omits the key entirely rather than reporting an empty one."""
        with mock.patch.object(
            video_color.subprocess,
            "run",
            mock.Mock(return_value=mock.Mock(stdout='{"streams": [{}]}')),
        ):
            self.assertEqual(video_color.transfer_characteristics("/v.mov"), "")

    def test_unreadable_file_does_not_take_the_conversion_down(self):
        """Whatever ffprobe does, the video still has to convert."""
        for stdout in ("", "not json at all", '{"streams": []}'):
            with mock.patch.object(
                video_color.subprocess,
                "run",
                mock.Mock(return_value=mock.Mock(stdout=stdout)),
            ):
                self.assertEqual(video_color.transfer_characteristics("/v.mov"), "")

    def test_ffprobe_blowing_up_is_read_as_sdr(self):
        with mock.patch.object(
            video_color.subprocess, "run", side_effect=OSError("boom")
        ):
            self.assertFalse(video_color.is_hdr("/v.mov"))

    def test_a_host_without_ffprobe_converts_the_way_it_always_did(self):
        with mock.patch.object(video_color.shutil, "which", return_value=None):
            with mock.patch.object(video_color.subprocess, "run") as run:
                self.assertFalse(video_color.is_hdr("/v.mov"))
            run.assert_not_called()


class VideoFilterTest(SimpleTestCase):
    def setUp(self):
        ffmpeg_budget.reset_probe_cache()
        self.addCleanup(ffmpeg_budget.reset_probe_cache)

    def _filter(self, transfer, scale=None, filters=" ... zscale  V->V  resize\n"):
        with mock.patch.object(video_color, "is_hdr", return_value=transfer):
            with mock.patch.object(ffmpeg_budget, "_run", return_value=filters):
                return video_color.video_filter("/v.mov", scale)

    def test_hdr_gets_the_scale_first_and_the_tonemap_after(self):
        """Scaling first means the float pipeline runs on fewer pixels."""
        self.assertEqual(self._filter(True, "scale=-2:720"), "scale=-2:720," + TONEMAP)

    def test_sdr_is_left_exactly_as_it_was(self):
        self.assertEqual(self._filter(False, "scale=-2:720"), "scale=-2:720")

    def test_sdr_with_nothing_to_do_asks_for_no_filter_at_all(self):
        """ffmpeg rejects an empty -filter:v, so the caller must omit it."""
        self.assertIsNone(self._filter(False))

    def test_hdr_still_tonemaps_when_there_is_no_resizing(self):
        self.assertEqual(self._filter(True), TONEMAP)

    def test_an_ffmpeg_without_zscale_still_produces_a_playable_video(self):
        """No libzimg means no tonemapping, but 8-bit beats an unplayable High 10."""
        result = self._filter(
            True, "scale=-2:720", filters=" ... scale  V->V  resize\n"
        )
        self.assertEqual(result, "scale=-2:720,format=yuv420p")
        self.assertNotIn("zscale", result)

    def test_the_tonemap_chain_ends_in_eight_bit(self):
        """libx264 handed 10-bit samples writes High 10, which no browser decodes."""
        self.assertTrue(self._filter(True).endswith("format=yuv420p"))


class SupportsFilterTest(SimpleTestCase):
    def setUp(self):
        ffmpeg_budget.reset_probe_cache()
        self.addCleanup(ffmpeg_budget.reset_probe_cache)

    LISTING = (
        "Filters:\n"
        "  T.. atrim             A->A       Pick one continuous section.\n"
        " ..C scale              V->V       Scale the input video size.\n"
        " ..C zscale             V->V       Apply resizing and colorspace.\n"
        " .S. tonemap            V->V       Conversion between dynamic ranges.\n"
    )

    def test_finds_a_filter_the_build_has(self):
        with mock.patch.object(ffmpeg_budget, "_run", return_value=self.LISTING):
            self.assertTrue(ffmpeg_budget.supports_filter("zscale"))
            self.assertTrue(ffmpeg_budget.supports_filter("tonemap"))

    def test_does_not_invent_one_it_does_not(self):
        with mock.patch.object(ffmpeg_budget, "_run", return_value=self.LISTING):
            self.assertFalse(ffmpeg_budget.supports_filter("libplacebo"))
            self.assertFalse(ffmpeg_budget.supports_filter("tonemap_opencl"))

    def test_does_not_match_a_filter_by_prefix(self):
        """ "scale" must not answer for "zscale", nor the other way round."""
        listing = " ..C scale   V->V   Scale the input video size.\n"
        with mock.patch.object(ffmpeg_budget, "_run", return_value=listing):
            self.assertFalse(ffmpeg_budget.supports_filter("zscale"))

    def test_asks_ffmpeg_once_however_often_it_is_asked(self):
        run = mock.Mock(return_value=self.LISTING)
        with mock.patch.object(ffmpeg_budget, "_run", run):
            ffmpeg_budget.supports_filter("zscale")
            ffmpeg_budget.supports_filter("tonemap")
        self.assertEqual(run.call_count, 1)

    def test_a_host_without_ffmpeg_claims_no_filters(self):
        with mock.patch.object(ffmpeg_budget.shutil, "which", return_value=None):
            self.assertFalse(ffmpeg_budget.supports_filter("zscale"))


class ConversionSitesTest(SimpleTestCase):
    """Every path that hands a video to libx264 has to ask about its colour."""

    def setUp(self):
        ffmpeg_budget.reset_probe_cache()
        self.addCleanup(ffmpeg_budget.reset_probe_cache)

    def _hdr(self, hdr=True):
        return mock.patch.object(video_color, "is_hdr", return_value=hdr)

    def _zscale(self):
        return mock.patch.object(
            ffmpeg_budget, "_run", return_value=" ..C zscale  V->V  resize\n"
        )

    def test_live_playback_tonemaps_an_hdr_source(self):
        with self._hdr(), self._zscale():
            command = media.build_live_command("/v.mov")
        self.assertEqual(_filter_arg(command), "scale=-2:'min(720,ih)'," + TONEMAP)

    def test_live_playback_leaves_an_sdr_source_alone(self):
        with self._hdr(False), self._zscale():
            command = media.build_live_command("/v.mov")
        self.assertEqual(_filter_arg(command), "scale=-2:'min(720,ih)'")

    def test_the_cached_copy_tonemaps_an_hdr_source(self):
        with self._hdr(), self._zscale():
            command = transcode_cache.build_command("/v.mov", "/out.mp4")
        self.assertEqual(_filter_arg(command), "scale=-2:'min(720,ih)'," + TONEMAP)

    def test_the_cached_copy_leaves_an_sdr_source_alone(self):
        with self._hdr(False), self._zscale():
            command = transcode_cache.build_command("/v.mov", "/out.mp4")
        self.assertEqual(_filter_arg(command), "scale=-2:'min(720,ih)'")

    def test_the_filter_stays_after_the_input(self):
        """Before -i it would be read as a decoder setting and do nothing."""
        with self._hdr(), self._zscale():
            for command in (
                media.build_live_command("/v.mov"),
                transcode_cache.build_command("/v.mov", "/out.mp4"),
            ):
                self.assertGreater(
                    command.index("-filter:v"), command.index("-i"), command
                )

    def test_the_animated_thumbnail_tonemaps_an_hdr_source(self):
        from api import thumbnails

        with self._hdr(), self._zscale():
            with mock.patch.object(thumbnails.subprocess, "run") as popen:
                thumbnails.create_animated_thumbnail("/v.mov", 720, "out", "h", ".mp4")
        self.assertEqual(_filter_arg(popen.call_args[0][0]), "scale=-2:720," + TONEMAP)

    def test_the_poster_frame_tonemaps_an_hdr_source(self):
        from api import thumbnails

        with self._hdr(), self._zscale():
            with mock.patch.object(thumbnails.subprocess, "run") as popen:
                thumbnails.create_thumbnail_for_video("/v.mov", "out", "h", ".webp")
        self.assertEqual(_filter_arg(popen.call_args[0][0]), TONEMAP)

    def test_the_poster_frame_of_an_sdr_video_gains_no_filter(self):
        from api import thumbnails

        with self._hdr(False), self._zscale():
            with mock.patch.object(thumbnails.subprocess, "run") as popen:
                thumbnails.create_thumbnail_for_video("/v.mov", "out", "h", ".webp")
        self.assertIsNone(_filter_arg(popen.call_args[0][0]))


def _real_ffmpeg_with_zscale():
    ffmpeg_budget.reset_probe_cache()
    try:
        return bool(shutil.which("ffmpeg")) and ffmpeg_budget.supports_filter("zscale")
    finally:
        ffmpeg_budget.reset_probe_cache()


@unittest.skipUnless(_real_ffmpeg_with_zscale(), "no ffmpeg with zscale")
class RealTonemapTest(SimpleTestCase):
    """The chain, run by the real ffmpeg on a picture graded like phone HDR.

    A test pattern is taken to linear light and put back on the PQ curve with
    its white at ``white_nits`` -- 1000 is ordinary for a phone's HDR video, and
    100 is SDR reference white. The tonemapped result is then compared with the
    pattern itself: SDR cannot reproduce a 1000-nit picture, but it can keep it
    recognisable. The filter's default ``desat`` did not: at 1000 nits it faded
    98% of the frame to flat white.
    """

    PATTERN = "testsrc2=size=320x180:rate=1"

    def _stats(self, vf):
        run = subprocess.run(
            [
                shutil.which("ffmpeg"),
                "-nostdin",
                "-f",
                "lavfi",
                "-i",
                self.PATTERN,
                "-frames:v",
                "1",
                "-vf",
                f"{vf},signalstats,metadata=print",
                "-f",
                "null",
                "-",
            ],
            capture_output=True,
            text=True,
            check=True,
        )
        values = dict(
            re.findall(r"lavfi\.signalstats\.(YAVG|SATAVG)=([0-9.]+)", run.stderr)
        )
        return float(values["YAVG"]), float(values["SATAVG"])

    def _graded(self, white_nits):
        return (
            "format=yuv420p,"
            "setparams=color_trc=bt709:color_primaries=bt709:colorspace=bt709:range=tv,"
            "zscale=t=linear:npl=100,format=gbrpf32le,"
            f"zscale=p=bt2020:t=smpte2084:m=bt2020nc:npl={white_nits},"
            "format=yuv420p10le"
        )

    def _assert_recognisable(self, white_nits):
        reference_y, reference_sat = self._stats("format=yuv420p")
        y, sat = self._stats(f"{self._graded(white_nits)},{video_color._TONEMAP}")
        self.assertGreater(sat, reference_sat * 0.7, "the colour is gone")
        self.assertLess(y, 200, "the picture has faded to white")
        self.assertGreater(y, reference_y * 0.8, "the picture has gone dark")

    def test_a_bright_hdr_picture_keeps_its_colours(self):
        self._assert_recognisable(1000)

    def test_an_sdr_level_picture_keeps_its_colours(self):
        self._assert_recognisable(100)
