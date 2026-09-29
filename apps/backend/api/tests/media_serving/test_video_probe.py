"""A video's colour and codec, asked once at scan time instead of per conversion (#2045).

Before this, every conversion ran its own ffprobe to learn whether to tonemap:
the poster frame and both animated thumbnails of each new video, and every
play. The scan now probes once and stores the answer, and the conversions read
it. Covered here: what the probe records, including the difference between an
untagged video (answered) and one that could not be read (retried); that a
stored answer spares the conversions their probe; that every libx264 output is
something a browser can decode; that the scan probes before it thumbnails; and
the backfill for videos indexed before the fields existed.
"""

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from unittest import mock

from django.test import SimpleTestCase, TestCase, override_settings

from api import ffmpeg_budget, thumbnails, transcode_cache, video_color
from api.directory_watcher import file_handlers, processing_jobs, scan_jobs
from api.models import LongRunningJob, Photo, Thumbnail
from api.serializers.photos import PhotoSummarySerializer
from api.tests.utils import create_test_photo, create_test_user
from api.views import media

PQ_PROBE = {
    "streams": [
        {"codec_name": "hevc", "pix_fmt": "yuv420p10le", "color_transfer": "smpte2084"}
    ],
    "format": {"format_name": "mov,mp4,m4a,3gp,3g2,mj2"},
}


def _ffprobe(payload, returncode=0, stderr=""):
    """An ffprobe answering ``payload``, in the shape ``subprocess.run`` returns."""
    stdout = payload if isinstance(payload, str) else json.dumps(payload)
    return mock.Mock(
        return_value=mock.Mock(stdout=stdout, returncode=returncode, stderr=stderr)
    )


def _zscale(available=True):
    filters = " ..C zscale  V->V  resize\n" if available else " ... scale\n"
    return mock.patch.object(ffmpeg_budget, "_run", return_value=filters)


def _after(command, flag):
    return command[command.index(flag) + 1]


class ProbeTest(SimpleTestCase):
    def setUp(self):
        which = mock.patch.object(
            video_color.shutil, "which", return_value="/usr/bin/ffprobe"
        )
        which.start()
        self.addCleanup(which.stop)

    def test_records_codec_pixel_format_transfer_and_container(self):
        with mock.patch.object(video_color.subprocess, "run", _ffprobe(PQ_PROBE)):
            values = video_color.probe("/v.mov")
        self.assertEqual(
            values,
            {
                "video_codec": "hevc",
                "video_pixel_format": "yuv420p10le",
                "video_color_transfer": "smpte2084",
                "video_container": "mov,mp4,m4a,3gp,3g2,mj2",
            },
        )

    def test_one_ffprobe_asks_for_all_of_it(self):
        run = _ffprobe(PQ_PROBE)
        with mock.patch.object(video_color.subprocess, "run", run):
            video_color.probe("/v.mov")
        run.assert_called_once()
        argv = run.call_args.args[0]
        self.assertEqual(_after(argv, "-select_streams"), "v:0")
        entries = _after(argv, "-show_entries")
        for entry in ("codec_name", "pix_fmt", "color_transfer", "format_name"):
            self.assertIn(entry, entries)
        self.assertEqual(argv[-1], "/v.mov")

    def test_an_untagged_video_is_an_answer_not_a_failure(self):
        """ffprobe leaves the key out; stored as "", so it is never probed again."""
        payload = {"streams": [{"codec_name": "h264", "pix_fmt": "yuv420p"}]}
        with mock.patch.object(video_color.subprocess, "run", _ffprobe(payload)):
            values = video_color.probe("/v.mp4")
        self.assertEqual(values["video_color_transfer"], "")
        self.assertEqual(values["video_container"], "")
        self.assertEqual(values["video_codec"], "h264")

    def test_unknown_is_stored_as_saying_nothing(self):
        payload = {"streams": [{"codec_name": "h264", "color_transfer": "unknown"}]}
        with mock.patch.object(video_color.subprocess, "run", _ffprobe(payload)):
            self.assertEqual(video_color.probe("/v.mp4")["video_color_transfer"], "")

    def test_a_file_ffprobe_cannot_read_has_no_answer_yet(self):
        """The drive may just not be mounted: None, so it is tried again."""
        run = _ffprobe("{\n\n}", returncode=1, stderr="Invalid data found")
        with mock.patch.object(video_color.subprocess, "run", run):
            self.assertIsNone(video_color.probe("/v.mov"))

    def test_ffprobe_blowing_up_has_no_answer(self):
        for side_effect in (
            OSError("boom"),
            subprocess.TimeoutExpired("ffprobe", 30),
        ):
            with mock.patch.object(
                video_color.subprocess, "run", side_effect=side_effect
            ):
                self.assertIsNone(video_color.probe("/v.mov"), side_effect)

    def test_output_that_is_not_json_has_no_answer(self):
        with mock.patch.object(video_color.subprocess, "run", _ffprobe("nope")):
            self.assertIsNone(video_color.probe("/v.mov"))

    def test_a_host_without_ffprobe_has_no_answer(self):
        with mock.patch.object(video_color.shutil, "which", return_value=None):
            with mock.patch.object(video_color.subprocess, "run") as run:
                self.assertIsNone(video_color.probe("/v.mov"))
        run.assert_not_called()


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "no ffmpeg")
class RealProbeTest(SimpleTestCase):
    """Against a real file, in the container ExifTool cannot read colour from."""

    def _encode(self, name, *args):
        path = os.path.join(self.tmp.name, name)
        subprocess.run(
            [
                shutil.which("ffmpeg"),
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=64x64:rate=5",
                "-t",
                "0.4",
                *args,
                path,
            ],
            check=True,
            capture_output=True,
        )
        return path

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def test_reads_an_hlg_transfer_out_of_matroska(self):
        path = self._encode(
            "hlg.mkv",
            "-vf",
            "setparams=color_trc=arib-std-b67,format=yuv420p10le",
            "-c:v",
            "libx264",
            "-color_trc",
            "arib-std-b67",
        )
        values = video_color.probe(path)
        self.assertEqual(values["video_color_transfer"], "arib-std-b67")
        self.assertEqual(values["video_codec"], "h264")
        self.assertEqual(values["video_pixel_format"], "yuv420p10le")
        self.assertIn("matroska", values["video_container"])

    def test_an_untagged_clip_probes_as_sdr(self):
        path = self._encode("plain.mp4", "-c:v", "libx264", "-pix_fmt", "yuv420p")
        values = video_color.probe(path)
        self.assertEqual(values["video_color_transfer"], "")
        self.assertEqual(values["video_pixel_format"], "yuv420p")


class RecordTest(TestCase):
    def setUp(self):
        self.photo = create_test_photo(owner=create_test_user(), video=True)

    def test_stores_the_answer_on_the_photo(self):
        answer = {
            "video_codec": "hevc",
            "video_pixel_format": "yuv420p10le",
            "video_color_transfer": "arib-std-b67",
            "video_container": "matroska,webm",
        }
        with mock.patch.object(video_color, "probe", return_value=answer):
            self.assertTrue(video_color.record(self.photo))
        self.photo.refresh_from_db()
        self.assertEqual(self.photo.video_codec, "hevc")
        self.assertEqual(self.photo.video_pixel_format, "yuv420p10le")
        self.assertEqual(self.photo.video_color_transfer, "arib-std-b67")
        self.assertEqual(self.photo.video_container, "matroska,webm")

    def test_no_answer_leaves_the_old_values(self):
        Photo.objects.filter(pk=self.photo.pk).update(video_color_transfer="bt709")
        self.photo.refresh_from_db()
        with mock.patch.object(video_color, "probe", return_value=None):
            self.assertFalse(video_color.record(self.photo))
        self.photo.refresh_from_db()
        self.assertEqual(self.photo.video_color_transfer, "bt709")


class StoredTransferTest(SimpleTestCase):
    """A stored answer is used as it is; only a video never probed is asked."""

    def setUp(self):
        ffmpeg_budget.reset_probe_cache()
        self.addCleanup(ffmpeg_budget.reset_probe_cache)
        is_hdr = mock.patch.object(video_color, "is_hdr", return_value=False)
        self.is_hdr = is_hdr.start()
        self.addCleanup(is_hdr.stop)

    def test_a_stored_hdr_transfer_tonemaps_without_probing(self):
        with _zscale():
            chain = video_color.video_filter("/v.mov", transfer="smpte2084")
        self.assertIn("tonemap=hable", chain)
        self.is_hdr.assert_not_called()

    def test_a_stored_empty_transfer_is_sdr_without_probing(self):
        """ "" is the answer for an untagged video, not a reason to ask again."""
        self.assertIsNone(video_color.video_filter("/v.mov", transfer=""))
        self.is_hdr.assert_not_called()

    def test_a_video_never_probed_is_asked(self):
        video_color.video_filter("/v.mov", transfer=None)
        self.is_hdr.assert_called_once_with("/v.mov")


class H264OutputTest(SimpleTestCase):
    """What comes out of libx264 has to be something a browser decodes."""

    def setUp(self):
        ffmpeg_budget.reset_probe_cache()
        self.addCleanup(ffmpeg_budget.reset_probe_cache)

    def test_sdr_is_forced_to_8_bit_420_and_keeps_its_own_tags(self):
        """A 10-bit SDR clip would otherwise encode as High 10."""
        args = video_color.h264_video_args("/v.mp4", "scale=-2:250", transfer="bt709")
        self.assertEqual(_after(args, "-filter:v"), "scale=-2:250")
        self.assertEqual(_after(args, "-pix_fmt"), "yuv420p")
        self.assertNotIn("-color_trc", args)

    def test_no_scale_and_sdr_passes_no_empty_filter(self):
        args = video_color.h264_video_args("/v.mp4", transfer="")
        self.assertNotIn("-filter:v", args)
        self.assertEqual(_after(args, "-pix_fmt"), "yuv420p")

    def test_tonemapped_output_says_it_is_bt709(self):
        with _zscale():
            args = video_color.h264_video_args("/v.mov", transfer="smpte2084")
        self.assertIn("tonemap=hable", _after(args, "-filter:v"))
        self.assertEqual(_after(args, "-color_primaries"), "bt709")
        self.assertEqual(_after(args, "-color_trc"), "bt709")
        self.assertEqual(_after(args, "-colorspace"), "bt709")

    def test_untonemapped_hdr_is_not_labelled_bt709(self):
        """Without zscale the curve is still PQ; calling it bt709 would be a lie."""
        with _zscale(available=False):
            args = video_color.h264_video_args("/v.mov", transfer="smpte2084")
        self.assertEqual(_after(args, "-filter:v"), "format=yuv420p")
        self.assertNotIn("-color_trc", args)

    def test_every_libx264_site_forces_the_pixel_format(self):
        with mock.patch.object(thumbnails, "_run_ffmpeg") as run:
            thumbnails.create_animated_thumbnail(
                "/v.mov", 250, "out", "h", ".mp4", transfer=""
            )
        for command in (
            media.build_live_command("/v.mov", ""),
            transcode_cache.build_command("/v.mov", "/out.mp4", ""),
            run.call_args.args[0],
        ):
            self.assertEqual(_after(command, "-pix_fmt"), "yuv420p", command)
            self.assertGreater(command.index("-pix_fmt"), command.index("-i"))


class ConversionSitesUseTheStoredValueTest(SimpleTestCase):
    def setUp(self):
        ffmpeg_budget.reset_probe_cache()
        self.addCleanup(ffmpeg_budget.reset_probe_cache)
        is_hdr = mock.patch.object(video_color, "is_hdr", return_value=False)
        self.is_hdr = is_hdr.start()
        self.addCleanup(is_hdr.stop)

    def test_live_playback(self):
        with _zscale():
            command = media.build_live_command("/v.mov", "arib-std-b67")
        self.assertIn("tonemap=hable", _after(command, "-filter:v"))
        self.is_hdr.assert_not_called()

    def test_the_cached_copy(self):
        with _zscale():
            command = transcode_cache.build_command("/v.mov", "/o.mp4", "smpte2084")
        self.assertIn("tonemap=hable", _after(command, "-filter:v"))
        self.is_hdr.assert_not_called()

    def test_the_poster_frame_and_the_animated_thumbnail(self):
        with _zscale(), mock.patch.object(thumbnails, "_run_ffmpeg") as run:
            thumbnails.create_thumbnail_for_video(
                "/v.mov", "out", "h", ".webp", transfer="smpte2084"
            )
            thumbnails.create_animated_thumbnail(
                "/v.mov", 500, "out", "h", ".mp4", transfer="smpte2084"
            )
        for call in run.call_args_list:
            self.assertIn("tonemap=hable", _after(call.args[0], "-filter:v"))
        self.is_hdr.assert_not_called()

    def test_the_cache_hands_over_the_photos_value(self):
        photo = mock.Mock(
            image_hash="h", video_length="3", video_color_transfer="smpte2084"
        )
        photo.main_file.path = "/v.mov"
        start = mock.Mock()
        with (
            tempfile.TemporaryDirectory() as root,
            mock.patch.object(transcode_cache, "is_enabled", return_value=True),
            mock.patch.object(transcode_cache, "_root", return_value=root),
            mock.patch.object(
                transcode_cache, "final_path", return_value=os.path.join(root, "h")
            ),
            mock.patch.object(transcode_cache, "make_room", return_value=True),
            mock.patch.object(transcode_cache, "build_command") as build,
        ):
            self.assertTrue(transcode_cache.ensure_cached(photo, start=start))
        self.assertEqual(build.call_args.args[2], "smpte2084")


class ThumbnailPassesTheStoredValueTest(TestCase):
    def test_video_thumbnails_get_the_photos_transfer(self):
        photo = create_test_photo(owner=create_test_user(), video=True)
        Photo.objects.filter(pk=photo.pk).update(video_color_transfer="smpte2084")
        thumbnail = Thumbnail.objects.get(photo=photo)
        with (
            tempfile.TemporaryDirectory() as media_root,
            override_settings(MEDIA_ROOT=media_root),
            mock.patch("api.models.thumbnail.create_thumbnail_for_video") as poster,
            mock.patch("api.models.thumbnail.create_animated_thumbnail") as animated,
        ):
            thumbnail._generate_thumbnail()
        self.assertEqual(poster.call_args.kwargs["transfer"], "smpte2084")
        self.assertEqual(animated.call_count, 2)
        for call in animated.call_args_list:
            self.assertEqual(call.kwargs["transfer"], "smpte2084")


class ScanProbesBeforeThumbnailingTest(TestCase):
    def setUp(self):
        self.user = create_test_user()

    def _process(self, photo):
        order = []
        with (
            mock.patch.object(
                file_handlers.video_color,
                "record",
                side_effect=lambda p: order.append("probe"),
            ) as record,
            mock.patch.object(
                Thumbnail,
                "_generate_thumbnail",
                side_effect=lambda: order.append("thumbnail"),
                autospec=False,
            ),
            mock.patch.object(Thumbnail, "_calculate_aspect_ratio"),
            mock.patch.object(Thumbnail, "_get_dominant_color"),
            mock.patch("api.models.photo_metadata.PhotoMetadata.extract_exif_data"),
            mock.patch.object(file_handlers, "extract_date_time"),
            mock.patch("api.screenshot_detection.classify", return_value=False),
            mock.patch.object(file_handlers.PhotoSearch, "recreate_search_captions"),
        ):
            file_handlers._process_photo(
                photo, photo.main_file.path, None, file_handlers.datetime.datetime.now()
            )
        return record, order

    def test_a_video_is_probed_before_its_thumbnails_are_made(self):
        photo = create_test_photo(owner=self.user, video=True)
        record, order = self._process(photo)
        record.assert_called_once_with(photo)
        self.assertEqual(order, ["probe", "thumbnail"])

    def test_a_photo_is_not_probed(self):
        photo = create_test_photo(owner=self.user, video=False)
        record, order = self._process(photo)
        record.assert_not_called()
        self.assertEqual(order, ["thumbnail"])


class ProbeVideosBackfillTest(TestCase):
    def setUp(self):
        self.user = create_test_user()

    def _video(self, **fields):
        photo = create_test_photo(owner=self.user, video=True)
        if fields:
            Photo.objects.filter(pk=photo.pk).update(**fields)
        return photo

    def test_picks_only_the_unprobed_videos_that_are_still_there(self):
        unprobed = self._video()
        self._video(video_color_transfer="")  # probed, untagged
        self._video(video_color_transfer="bt709")
        self._video(removed=True)
        create_test_photo(owner=self.user, video=False)
        create_test_photo(owner=create_test_user(), video=True)  # someone else's
        self.assertEqual(list(processing_jobs.videos_to_probe(self.user)), [unprobed])

    def _run(self):
        job_id = "00000000-0000-0000-0000-000000000019"
        with mock.patch.object(
            Thumbnail, "_regenerate_thumbnails", autospec=True
        ) as regenerate:
            processing_jobs.probe_videos(self.user, job_id)
        return LongRunningJob.objects.get(job_id=job_id), regenerate

    def _probe_saying(self, by_path):
        def probe(path):
            transfer = by_path[path]
            if transfer is None:
                return None
            return {
                "video_codec": "hevc",
                "video_pixel_format": "yuv420p10le",
                "video_color_transfer": transfer,
                "video_container": "mov,mp4,m4a,3gp,3g2,mj2",
            }

        return mock.patch.object(video_color, "probe", side_effect=probe)

    def test_fills_the_fields_and_rebuilds_only_hdr_thumbnails(self):
        hdr = self._video()
        sdr = self._video()
        with self._probe_saying(
            {hdr.main_file.path: "smpte2084", sdr.main_file.path: ""}
        ):
            job, regenerate = self._run()
        hdr.refresh_from_db()
        sdr.refresh_from_db()
        self.assertEqual(hdr.video_color_transfer, "smpte2084")
        self.assertEqual(sdr.video_color_transfer, "")
        self.assertEqual(sdr.video_codec, "hevc")
        rebuilt = [call.args[0].photo_id for call in regenerate.call_args_list]
        self.assertEqual(rebuilt, [hdr.pk])
        self.assertTrue(job.finished)
        self.assertEqual(job.progress_current, 2)

    def test_a_video_that_cannot_be_read_stays_unprobed_for_next_time(self):
        gone = self._video()
        with self._probe_saying({gone.main_file.path: None}):
            job, regenerate = self._run()
        gone.refresh_from_db()
        self.assertIsNone(gone.video_color_transfer)
        regenerate.assert_not_called()
        self.assertTrue(job.finished)
        self.assertEqual(list(processing_jobs.videos_to_probe(self.user)), [gone])

    def test_nothing_to_probe_finishes_at_once(self):
        with mock.patch.object(video_color, "probe") as probe:
            job, _ = self._run()
        probe.assert_not_called()
        self.assertTrue(job.finished)
        self.assertEqual(job.progress_target, 0)


class BackfillIsQueuedOnlyWhenNeededTest(TestCase):
    def setUp(self):
        self.user = create_test_user()

    def _queued(self, can_probe=True):
        with (
            mock.patch.object(scan_jobs, "AsyncTask") as task,
            mock.patch.object(scan_jobs, "Chain"),
            mock.patch.object(
                scan_jobs.video_color, "can_probe", return_value=can_probe
            ),
        ):
            scan_jobs._queue_followup_jobs(self.user, False, False)
        return [call.args[0] for call in task.call_args_list]

    def test_queued_after_a_scan_while_videos_are_unprobed(self):
        create_test_photo(owner=self.user, video=True)
        self.assertIn(processing_jobs.probe_videos, self._queued())

    def test_not_queued_once_every_video_is_probed(self):
        photo = create_test_photo(owner=self.user, video=True)
        Photo.objects.filter(pk=photo.pk).update(video_color_transfer="")
        self.assertNotIn(processing_jobs.probe_videos, self._queued())

    def test_not_queued_on_a_host_that_cannot_probe(self):
        create_test_photo(owner=self.user, video=True)
        self.assertNotIn(processing_jobs.probe_videos, self._queued(can_probe=False))


class HdrFlagTest(TestCase):
    def _is_hdr(self, **fields):
        photo = create_test_photo(owner=create_test_user(), **fields)
        return PhotoSummarySerializer(Photo.objects.get(pk=photo.pk)).data["is_hdr"]

    def test_hdr_videos_are_flagged(self):
        self.assertIs(self._is_hdr(video=True, video_color_transfer="smpte2084"), True)
        self.assertIs(
            self._is_hdr(video=True, video_color_transfer="arib-std-b67"), True
        )

    def test_sdr_unprobed_and_non_videos_are_not(self):
        self.assertIs(self._is_hdr(video=True, video_color_transfer="bt709"), False)
        self.assertIs(self._is_hdr(video=True, video_color_transfer=""), False)
        self.assertIs(self._is_hdr(video=True), False)
        self.assertIs(self._is_hdr(video=False), False)
