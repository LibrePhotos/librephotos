"""Still posters for videos in the grid (#2026).

Every video gets WebP stills beside its clips, resized from its big thumbnail.
The grid shows them and mounts the clip only while a tile is pointed at, so a
page of videos no longer holds one media player per tile. The media view
serves a video's poster as ``<square directory>/<image_hash>.webp``, the grid
serializers say which videos have one, and the Make Video Posters job (an
upgrade task) makes them for the videos scanned before.
"""

import os
import tempfile
from unittest import mock

import pyvips
from constance.test import override_config
from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from api.models import LongRunningJob, Photo, Thumbnail
from api.models.long_running_job import JobCancelledError
from api.runtime.features import forget_site_switches
from api.serializers.photos import PhotoSummarySerializer, with_photo_summary_relations
from api.serializers.simple import PhotoSimpleSerializer, has_video_poster
from api.tests.utils import create_test_job, create_test_photo, create_test_user
from api.thumbnails import posters, render

SQUARES = ("square_thumbnails", "square_thumbnails_small")


class _MediaRootTestCase(TestCase):
    def setUp(self):
        super().setUp()
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.media_root = folder.name
        overrider = override_settings(MEDIA_ROOT=self.media_root)
        overrider.enable()
        self.addCleanup(overrider.disable)
        for directory in ("thumbnails_big", *SQUARES):
            os.makedirs(os.path.join(self.media_root, directory))
        forget_site_switches()
        self.addCleanup(forget_site_switches)
        self.user = create_test_user()

    def _path(self, directory, photo, extension):
        return os.path.join(self.media_root, directory, photo.image_hash + extension)

    def _write(self, directory, photo, extension, content=b"x"):
        with open(self._path(directory, photo, extension), "wb") as handle:
            handle.write(content)

    def _write_big_thumbnail(self, photo):
        pyvips.Image.black(1200, 900).write_to_file(
            self._path("thumbnails_big", photo, ".webp")
        )


class PosterServingTest(_MediaRootTestCase):
    def setUp(self):
        super().setUp()
        self.client = APIClient()
        self.client.cookies["jwt"] = str(AccessToken.for_user(self.user))

    def test_behind_the_proxy_a_videos_poster_is_its_webp_still(self):
        video = create_test_photo(owner=self.user, video=True)
        for directory in SQUARES:
            with self.subTest(directory=directory):
                response = self.client.get(
                    f"/media/{directory}/{video.image_hash}.webp"
                )
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response["Content-Type"], "image/webp")
                self.assertEqual(
                    response["X-Accel-Redirect"],
                    f"/protected_media/{directory}/{video.image_hash}.webp",
                )

    def test_the_clip_is_still_served_without_the_extension(self):
        video = create_test_photo(owner=self.user, video=True)
        response = self.client.get(f"/media/{SQUARES[0]}/{video.image_hash}")
        self.assertEqual(response["Content-Type"], "video/mp4")

    def test_a_poster_asked_for_by_id_is_named_after_the_hash(self):
        video = create_test_photo(owner=self.user, video=True)
        response = self.client.get(f"/media/{SQUARES[1]}/{video.pk}.webp")
        self.assertEqual(
            response["X-Accel-Redirect"],
            f"/protected_media/{SQUARES[1]}/{video.image_hash}.webp",
        )

    @override_settings(SERVE_FRONTEND=True)
    def test_served_directly_the_poster_is_the_still_and_not_the_clip(self):
        video = create_test_photo(owner=self.user, video=True)
        self._write(SQUARES[0], video, ".webp", b"STILL")
        self._write(SQUARES[0], video, ".mp4", b"CLIP")

        response = self.client.get(f"/media/{SQUARES[0]}/{video.image_hash}.webp")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "image/webp")
        self.assertEqual(b"".join(response.streaming_content), b"STILL")

    @override_settings(SERVE_FRONTEND=True)
    def test_served_directly_a_missing_poster_is_not_found(self):
        video = create_test_photo(owner=self.user, video=True)
        response = self.client.get(f"/media/{SQUARES[0]}/{video.image_hash}.webp")
        self.assertEqual(response.status_code, 404)

    def test_another_users_video_poster_is_refused(self):
        video = create_test_photo(owner=create_test_user(), video=True)
        response = self.client.get(f"/media/{SQUARES[0]}/{video.image_hash}.webp")
        self.assertEqual(response.status_code, 404)

    def test_a_photo_and_the_big_thumbnail_are_served_as_before(self):
        photo = create_test_photo(owner=self.user)
        video = create_test_photo(owner=self.user, video=True)
        for directory, item in ((SQUARES[0], photo), ("thumbnails_big", video)):
            with self.subTest(directory=directory):
                response = self.client.get(f"/media/{directory}/{item.image_hash}.webp")
                self.assertEqual(
                    response["X-Accel-Redirect"],
                    f"/protected_media/{directory}/{item.image_hash}.webp",
                )


class PosterFlagTest(TestCase):
    def setUp(self):
        self.user = create_test_user()

    def _summary(self, photo):
        loaded = with_photo_summary_relations(Photo.objects.filter(pk=photo.pk)).get()
        return PhotoSummarySerializer(loaded).data

    def test_a_video_with_a_poster_says_so(self):
        video = create_test_photo(owner=self.user, video=True)
        Thumbnail.objects.filter(photo=video).update(video_poster=True)
        video = Photo.objects.get(pk=video.pk)
        self.assertTrue(self._summary(video)["video_poster"])
        self.assertTrue(PhotoSimpleSerializer(video).data["video_poster"])

    def test_a_video_scanned_before_has_none_yet(self):
        video = create_test_photo(owner=self.user, video=True)
        self.assertFalse(self._summary(video)["video_poster"])
        self.assertFalse(PhotoSimpleSerializer(video).data["video_poster"])

    def test_a_photo_never_has_one(self):
        photo = create_test_photo(owner=self.user)
        Thumbnail.objects.filter(photo=photo).update(video_poster=True)
        self.assertFalse(self._summary(Photo.objects.get(pk=photo.pk))["video_poster"])

    def test_a_video_without_a_thumbnail_row_has_none(self):
        video = create_test_photo(owner=self.user, video=True)
        Thumbnail.objects.filter(photo=video).delete()
        self.assertFalse(has_video_poster(Photo.objects.get(pk=video.pk)))

    def test_the_grid_relations_load_what_the_flag_reads(self):
        video = create_test_photo(owner=self.user, video=True)
        loaded = with_photo_summary_relations(Photo.objects.filter(pk=video.pk)).get()
        with self.assertNumQueries(0):
            self.assertFalse(has_video_poster(loaded))


class PosterRenderTest(_MediaRootTestCase):
    def test_a_photo_is_not_marked(self):
        photo = create_test_photo(owner=self.user)
        with mock.patch.object(render, "create_static_thumbnails"):
            with self.captureOnCommitCallbacks(execute=True):
                render.generate_thumbnail(photo.thumbnail)
        photo.thumbnail.refresh_from_db()
        self.assertFalse(photo.thumbnail.video_poster)

    def test_stills_already_there_are_only_marked(self):
        video = create_test_photo(owner=self.user, video=True)
        for directory in SQUARES:
            self._write(directory, video, ".webp")
        with mock.patch.object(render, "create_static_thumbnails") as stills:
            render.create_video_posters(video.thumbnail)
        stills.assert_not_called()
        self.assertTrue(video.thumbnail.video_poster)

    def test_a_poster_that_cannot_be_made_leaves_the_clips(self):
        """The poster is extra with the animated previews on: the tile plays the clip."""
        video = create_test_photo(owner=self.user, video=True)
        self._write("thumbnails_big", video, ".webp", b"not a picture")
        with mock.patch.object(render, "create_animated_thumbnail") as clip:
            with self.captureOnCommitCallbacks(execute=True):
                render.generate_thumbnail(video.thumbnail)

        self.assertEqual(clip.call_count, 2)
        video.thumbnail.refresh_from_db()
        self.assertTrue(video.thumbnail.square_thumbnail.name.endswith(".mp4"))
        self.assertFalse(video.thumbnail.video_poster)

    @override_config(VIDEO_PREVIEWS_ENABLED=False)
    def test_without_clips_a_still_that_cannot_be_made_fails(self):
        video = create_test_photo(owner=self.user, video=True)
        self._write("thumbnails_big", video, ".webp", b"not a picture")
        with self.assertRaises(pyvips.Error):
            render.generate_thumbnail(video.thumbnail)


class MakeVideoPostersTest(_MediaRootTestCase):
    def _video(self, big=True):
        video = create_test_photo(owner=self.user, video=True)
        if big:
            self._write_big_thumbnail(video)
        return video

    def _poster(self, video):
        return Thumbnail.objects.get(photo=video).video_poster

    def test_a_video_gets_both_stills_from_its_big_thumbnail(self):
        video = self._video()

        result = posters.make_video_posters()

        self.assertEqual((result.made, result.skipped, result.errors), (1, 0, []))
        self.assertTrue(self._poster(video))
        for directory in SQUARES:
            self.assertTrue(os.path.exists(self._path(directory, video, ".webp")))

    def test_a_video_without_a_big_thumbnail_is_skipped(self):
        video = self._video(big=False)

        result = posters.make_video_posters()

        self.assertEqual((result.made, result.skipped), (0, 1))
        self.assertFalse(self._poster(video))

    def test_an_unreadable_big_thumbnail_is_skipped(self):
        broken = self._video(big=False)
        self._write("thumbnails_big", broken, ".webp", b"not a picture")

        result = posters.make_video_posters()

        self.assertEqual((result.made, result.skipped), (0, 1))

    def test_a_failed_render_is_an_error_and_the_rest_go_on(self):
        broken = self._video()
        good = self._video()
        real = render.create_static_thumbnails

        def fail_for_broken(**kwargs):
            if kwargs["hash"] == broken.image_hash:
                raise pyvips.Error("decode failed")
            real(**kwargs)

        with mock.patch.object(
            render, "create_static_thumbnails", side_effect=fail_for_broken
        ):
            result = posters.make_video_posters()

        self.assertEqual(result.made, 1)
        self.assertEqual(len(result.errors), 1)
        self.assertTrue(result.errors[0].startswith(broken.image_hash))
        self.assertFalse(self._poster(broken))
        self.assertTrue(self._poster(good))

    def test_photos_and_videos_with_a_poster_are_left_alone(self):
        create_test_photo(owner=self.user)
        done = self._video()
        Thumbnail.objects.filter(photo=done).update(video_poster=True)

        result = posters.make_video_posters()

        self.assertEqual((result.made, result.skipped), (0, 0))

    def test_progress_is_reported_at_the_start_every_batch_and_the_end(self):
        for _ in range(3):
            self._video()
        progress = mock.Mock()

        posters.make_video_posters(progress=progress, progress_every=2)

        self.assertEqual(
            [call.args for call in progress.call_args_list], [(0, 3), (2, 3), (3, 3)]
        )


class MakeVideoPostersJobTest(_MediaRootTestCase):
    def _job(self):
        return create_test_job(self.user, LongRunningJob.JOB_MAKE_VIDEO_POSTERS)

    def test_the_job_completes_with_its_counts(self):
        video = create_test_photo(owner=self.user, video=True)
        self._write_big_thumbnail(video)
        create_test_photo(owner=self.user, video=True)
        job = self._job()

        posters.make_video_posters_job(self.user, job.job_id)

        job.refresh_from_db()
        self.assertTrue(job.finished)
        self.assertFalse(job.failed)
        self.assertEqual(job.result["made"], 1)
        self.assertEqual(job.result["skipped"], 1)
        self.assertEqual(job.result["error_count"], 0)
        self.assertEqual((job.progress_current, job.progress_target), (2, 2))

    def test_a_cancelled_job_stops(self):
        create_test_photo(owner=self.user, video=True)
        job = self._job()
        with mock.patch.object(
            LongRunningJob, "stop_if_cancelled", side_effect=JobCancelledError("job")
        ):
            posters.make_video_posters_job(self.user, job.job_id)

        job.refresh_from_db()
        self.assertFalse(job.failed)
        self.assertIsNone(job.result)

    def test_an_unexpected_error_fails_the_job(self):
        job = self._job()
        with mock.patch.object(
            posters, "make_video_posters", side_effect=RuntimeError("database gone")
        ):
            posters.make_video_posters_job(self.user, job.job_id)

        job.refresh_from_db()
        self.assertTrue(job.failed)

    def test_a_job_cancelled_while_queued_does_nothing(self):
        job = self._job()
        LongRunningJob.objects.filter(pk=job.pk).update(cancelled=True, finished=True)
        with mock.patch.object(posters, "make_video_posters") as make:
            posters.make_video_posters_job(self.user, job.job_id)
        make.assert_not_called()
