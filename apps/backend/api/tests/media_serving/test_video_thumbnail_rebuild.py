"""A video's thumbnails rebuilt by Probe Videos survive an ffmpeg that fails.

The backfill rebuilds the thumbnails of every video it finds was converted
wrongly before (an HDR source's washed out, a 10-bit one's unplayable). It used
to delete them first, so when ffmpeg then failed on the file, a video that had
a working thumbnail -- washed out, but the right picture -- was left with none.
The old files are now set aside and put back unless the new ones were made. A
rotation still starts from nothing: its old thumbnails show the wrong turn.
"""

import os
import subprocess
import tempfile
from unittest import mock

from django.test import TestCase, override_settings

from api import thumbnails, transcode_cache, video_color
from api.directory_watcher import processing_jobs
from api.models import LongRunningJob, Photo, Thumbnail
from api.models.thumbnail import SET_ASIDE_SUFFIX, thumbnail_file_paths
from api.tests.utils import create_test_photo, create_test_user

HDR_PROBE = {
    "video_codec": "hevc",
    "video_pixel_format": "yuv420p10le",
    "video_color_transfer": "smpte2084",
    "video_container": "mov,mp4,m4a,3gp,3g2,mj2",
}


def _ffmpeg_failing_on(fail_on):
    """An ffmpeg writing every output, and failing half-way on the ones named.

    A failed run leaves a partial file behind, as a real one can, for
    ``_run_ffmpeg`` to clean up.
    """

    def run(command, **kwargs):
        output = command[-1]
        with open(output, "wb") as handle:
            handle.write(b"new")
        if any(name in output for name in fail_on):
            raise subprocess.CalledProcessError(1, command, stderr=b"Invalid data")
        return mock.Mock(returncode=0)

    return mock.patch.object(thumbnails.subprocess, "run", side_effect=run)


class ThumbnailRebuildTest(TestCase):
    def setUp(self):
        self.media = tempfile.TemporaryDirectory()
        self.addCleanup(self.media.cleanup)
        settings = override_settings(MEDIA_ROOT=self.media.name)
        settings.enable()
        self.addCleanup(settings.disable)
        for patcher in (
            mock.patch.object(video_color, "h264_video_args", return_value=[]),
            mock.patch.object(video_color, "video_filter", return_value=None),
            # The files are not real pictures; what is read from them is not
            # what is being tested.
            mock.patch.object(Thumbnail, "_calculate_aspect_ratio"),
            mock.patch.object(Thumbnail, "_refresh_perceptual_hash"),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user, video=True)
        Photo.objects.filter(pk=self.photo.pk).update(video_color_transfer=None)
        self.paths = thumbnail_file_paths(self.photo.image_hash)
        self.video_paths = [
            path
            for path in self.paths
            if path.endswith(".mp4") or os.sep + "thumbnails_big" + os.sep in path
        ]
        for path in self.video_paths:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "wb") as handle:
                handle.write(b"old")

    def _contents(self):
        found = {}
        for path in self.video_paths:
            if os.path.exists(path):
                with open(path, "rb") as handle:
                    found[os.path.basename(os.path.dirname(path))] = handle.read()
        return found

    def _leftovers(self):
        return [
            path for path in self.video_paths if os.path.exists(path + SET_ASIDE_SUFFIX)
        ]

    def _thumbnail(self):
        return Thumbnail.objects.get(photo=self.photo)

    def test_a_failed_rebuild_puts_the_old_thumbnails_back(self):
        with (
            _ffmpeg_failing_on([".webp"]),
            self.assertRaises(thumbnails.VideoThumbnailError),
        ):
            self._thumbnail()._regenerate_thumbnails(keep_old_on_failure=True)
        self.assertEqual(
            self._contents(),
            {
                "thumbnails_big": b"old",
                "square_thumbnails": b"old",
                "square_thumbnails_small": b"old",
            },
        )
        self.assertEqual(self._leftovers(), [])

    def test_a_rebuild_that_fails_half_way_does_not_mix_old_and_new(self):
        """The poster frame was made before the animated thumbnail failed."""
        with (
            _ffmpeg_failing_on([os.path.join("square_thumbnails_small", "")]),
            self.assertRaises(thumbnails.VideoThumbnailError),
        ):
            self._thumbnail()._regenerate_thumbnails(keep_old_on_failure=True)
        self.assertEqual(set(self._contents().values()), {b"old"})
        self.assertEqual(len(self._contents()), 3)

    def test_a_rebuild_that_works_replaces_them_and_leaves_nothing_behind(self):
        with _ffmpeg_failing_on([]):
            self._thumbnail()._regenerate_thumbnails(keep_old_on_failure=True)
        self.assertEqual(set(self._contents().values()), {b"new"})
        self.assertEqual(len(self._contents()), 3)
        self.assertEqual(self._leftovers(), [])

    def test_a_rotation_still_starts_from_nothing(self):
        """Its old thumbnails would show the photo turned the wrong way."""
        with (
            _ffmpeg_failing_on([".mp4"]),
            self.assertRaises(thumbnails.VideoThumbnailError),
        ):
            self._thumbnail()._regenerate_thumbnails()
        self.assertNotIn(b"old", self._contents().values())
        self.assertEqual(self._leftovers(), [])

    def test_probe_videos_keeps_the_thumbnail_when_ffmpeg_fails(self):
        job_id = "00000000-0000-0000-0000-000000002157"
        with (
            mock.patch.object(video_color, "probe", return_value=HDR_PROBE),
            mock.patch.object(transcode_cache, "discard"),
            _ffmpeg_failing_on([".mp4"]),
        ):
            processing_jobs.probe_videos(self.user, job_id)
        self.assertEqual(set(self._contents().values()), {b"old"})
        self.assertEqual(len(self._contents()), 3)
        self.assertEqual(self._leftovers(), [])
        job = LongRunningJob.objects.get(job_id=job_id)
        self.assertTrue(job.finished)
        self.assertEqual(job.result["error_count"], 1)
        self.photo.refresh_from_db()
        self.assertEqual(self.photo.video_color_transfer, "smpte2084")
