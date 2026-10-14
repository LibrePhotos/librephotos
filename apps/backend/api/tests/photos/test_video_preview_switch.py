"""The animated video previews can be switched off (#649).

With ``VIDEO_PREVIEWS_ENABLED`` off (or ``FEATURE_VIDEO_PREVIEWS`` false), a
video's square thumbnails are WebP stills resized from its big thumbnail
instead of mp4 clips, stored under names ending in ``.webp``. The media view
serves a square by its stored name, so the clips made before keep working
next to the stills, and the grid serializers say which kind a video has.
"""

import os
import tempfile
from unittest import mock

import pyvips
from constance.test import override_config
from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from api.models import Photo, Thumbnail
from api.runtime.features import forget_site_switches
from api.serializers.photos import PhotoSummarySerializer, with_photo_summary_relations
from api.serializers.simple import PhotoSimpleSerializer, has_animated_preview
from api.tests.utils import create_test_photo, create_test_user
from api.thumbnails import render

SQUARES = ("square_thumbnails", "square_thumbnails_small")


def _size(path):
    # From bytes, so libvips holds no handle on Windows and cleanup works.
    with open(path, "rb") as handle:
        image = pyvips.Image.new_from_buffer(handle.read(), "")
    return image.width, image.height


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
        # A first frame of a 4:3 video, larger than both squares.
        pyvips.Image.black(1200, 900).write_to_file(
            self._path("thumbnails_big", photo, ".webp")
        )


class VideoSquareRenderTest(_MediaRootTestCase):
    def _video(self):
        photo = create_test_photo(owner=self.user, video=True)
        self._write_big_thumbnail(photo)
        return photo

    def _generate(self, photo):
        with self.captureOnCommitCallbacks(execute=True):
            render.generate_thumbnail(photo.thumbnail)
        photo.thumbnail.refresh_from_db()
        return photo.thumbnail

    @override_config(VIDEO_PREVIEWS_ENABLED=False)
    def test_switched_off_a_video_gets_webp_stills(self):
        photo = self._video()
        with mock.patch.object(render, "create_animated_thumbnail") as clip:
            thumbnail = self._generate(photo)

        clip.assert_not_called()
        self.assertEqual(
            thumbnail.square_thumbnail.name,
            os.path.join("square_thumbnails", photo.image_hash + ".webp"),
        )
        self.assertEqual(
            thumbnail.square_thumbnail_small.name,
            os.path.join("square_thumbnails_small", photo.image_hash + ".webp"),
        )
        self.assertEqual(
            _size(self._path("square_thumbnails", photo, ".webp")), (667, 500)
        )
        self.assertEqual(
            _size(self._path("square_thumbnails_small", photo, ".webp")), (333, 250)
        )

    @override_settings(FEATURE_VIDEO_PREVIEWS=False)
    def test_the_environment_switch_also_makes_stills(self):
        photo = self._video()
        with mock.patch.object(render, "create_animated_thumbnail") as clip:
            thumbnail = self._generate(photo)

        clip.assert_not_called()
        self.assertTrue(thumbnail.square_thumbnail.name.endswith(".webp"))

    def test_switched_on_a_video_gets_mp4_clips(self):
        photo = self._video()
        with mock.patch.object(render, "create_animated_thumbnail") as clip:
            thumbnail = self._generate(photo)

        heights = {
            call.kwargs["output_path"]: call.kwargs["output_height"]
            for call in clip.call_args_list
        }
        self.assertEqual(
            heights, {"square_thumbnails": 500, "square_thumbnails_small": 250}
        )
        self.assertEqual(
            thumbnail.square_thumbnail.name,
            os.path.join("square_thumbnails", photo.image_hash + ".mp4"),
        )
        self.assertEqual(
            thumbnail.square_thumbnail_small.name,
            os.path.join("square_thumbnails_small", photo.image_hash + ".mp4"),
        )
        self.assertFalse(os.path.exists(self._path(SQUARES[0], photo, ".webp")))

    @override_config(VIDEO_PREVIEWS_ENABLED=False)
    def test_a_rescan_switched_off_replaces_the_clips_and_frees_them(self):
        photo = self._video()
        for directory in SQUARES:
            self._write(directory, photo, ".mp4")

        thumbnail = self._generate(photo)

        self.assertTrue(thumbnail.square_thumbnail.name.endswith(".webp"))
        for directory in SQUARES:
            self.assertTrue(os.path.exists(self._path(directory, photo, ".webp")))
            self.assertFalse(os.path.exists(self._path(directory, photo, ".mp4")))

    def test_a_rescan_switched_on_again_replaces_the_stills(self):
        photo = self._video()
        for directory in SQUARES:
            self._write(directory, photo, ".webp")

        def make_clip(**kwargs):
            self._write(kwargs["output_path"], photo, ".mp4")

        with mock.patch.object(
            render, "create_animated_thumbnail", side_effect=make_clip
        ):
            thumbnail = self._generate(photo)

        self.assertTrue(thumbnail.square_thumbnail.name.endswith(".mp4"))
        for directory in SQUARES:
            self.assertTrue(os.path.exists(self._path(directory, photo, ".mp4")))
            self.assertFalse(os.path.exists(self._path(directory, photo, ".webp")))

    @override_config(VIDEO_PREVIEWS_ENABLED=False)
    def test_stills_already_there_are_kept(self):
        photo = self._video()
        for directory in SQUARES:
            self._write(directory, photo, ".webp", b"kept")

        with mock.patch.object(render, "create_static_thumbnails") as stills:
            self._generate(photo)

        stills.assert_not_called()
        with open(self._path(SQUARES[0], photo, ".webp"), "rb") as handle:
            self.assertEqual(handle.read(), b"kept")

    @override_config(VIDEO_PREVIEWS_ENABLED=False)
    def test_the_squares_are_kept_when_the_save_fails(self):
        """Old clips go only once the new names are stored."""
        photo = self._video()
        for directory in SQUARES:
            self._write(directory, photo, ".mp4")

        with (
            mock.patch.object(Thumbnail, "save", side_effect=RuntimeError("db")),
            self.captureOnCommitCallbacks(execute=True),
            self.assertRaises(RuntimeError),
        ):
            render.generate_thumbnail(photo.thumbnail)

        for directory in SQUARES:
            self.assertTrue(os.path.exists(self._path(directory, photo, ".mp4")))

    @override_config(VIDEO_PREVIEWS_ENABLED=False)
    def test_a_photo_is_not_touched_by_the_switch(self):
        photo = create_test_photo(owner=self.user)
        with mock.patch.object(render, "create_static_thumbnails") as stills:
            with self.captureOnCommitCallbacks(execute=True):
                render.generate_thumbnail(photo.thumbnail)

        self.assertEqual(
            stills.call_args.kwargs["output_paths"],
            ["thumbnails_big", "square_thumbnails", "square_thumbnails_small"],
        )
        photo.thumbnail.refresh_from_db()
        self.assertTrue(photo.thumbnail.square_thumbnail.name.endswith(".webp"))


class VideoSquareServingTest(_MediaRootTestCase):
    """Both kinds of video square are served, each as what it is."""

    def setUp(self):
        super().setUp()
        self.client = APIClient()
        self.client.cookies["jwt"] = str(AccessToken.for_user(self.user))

    def _still_video(self):
        photo = create_test_photo(owner=self.user, video=True)
        # Scanned with the animated previews off.
        Thumbnail.objects.filter(photo=photo).update(
            square_thumbnail=os.path.join(
                "square_thumbnails", photo.image_hash + ".webp"
            ),
            square_thumbnail_small=os.path.join(
                "square_thumbnails_small", photo.image_hash + ".webp"
            ),
        )
        return Photo.objects.get(pk=photo.pk)

    def _get(self, directory, photo):
        return self.client.get(f"/media/{directory}/{photo.image_hash}")

    def test_behind_the_proxy_each_square_is_served_by_its_stored_name(self):
        still = self._still_video()
        clip = create_test_photo(owner=self.user, video=True)
        for photo, extension, content_type in (
            (still, ".webp", "image/webp"),
            (clip, ".mp4", "video/mp4"),
        ):
            for directory in SQUARES:
                with self.subTest(directory=directory, extension=extension):
                    response = self._get(directory, photo)
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response["Content-Type"], content_type)
                    self.assertEqual(
                        response["X-Accel-Redirect"],
                        f"/protected_media/{directory}/{photo.image_hash}{extension}",
                    )

    @override_settings(SERVE_FRONTEND=True)
    def test_served_directly_each_square_has_its_own_type(self):
        still = self._still_video()
        clip = create_test_photo(owner=self.user, video=True)
        self._write(SQUARES[0], still, ".webp", b"STILL")
        self._write(SQUARES[0], clip, ".mp4", b"CLIP")
        for photo, content_type, body in (
            (still, "image/webp", b"STILL"),
            (clip, "video/mp4", b"CLIP"),
        ):
            with self.subTest(content_type=content_type):
                response = self._get(SQUARES[0], photo)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response["Content-Type"], content_type)
                self.assertEqual(b"".join(response.streaming_content), body)

    def test_without_a_thumbnail_row_the_file_on_disk_decides(self):
        clip = create_test_photo(owner=self.user, video=True)
        still = create_test_photo(owner=self.user, video=True)
        self._write(SQUARES[0], clip, ".mp4")
        Thumbnail.objects.filter(photo__in=[clip, still]).delete()
        for photo, extension, content_type in (
            (clip, ".mp4", "video/mp4"),
            (still, ".webp", "image/webp"),
        ):
            with self.subTest(extension=extension):
                response = self._get(SQUARES[0], photo)
                self.assertEqual(response["Content-Type"], content_type)
                self.assertEqual(
                    response["X-Accel-Redirect"],
                    f"/protected_media/{SQUARES[0]}/{photo.image_hash}{extension}",
                )


class AnimatedPreviewFlagTest(TestCase):
    def setUp(self):
        self.user = create_test_user()

    def _summary(self, photo):
        loaded = with_photo_summary_relations(Photo.objects.filter(pk=photo.pk)).get()
        return PhotoSummarySerializer(loaded).data

    def test_a_video_with_a_clip_is_animated(self):
        photo = create_test_photo(owner=self.user, video=True)
        self.assertTrue(self._summary(photo)["animated_preview"])
        self.assertTrue(PhotoSimpleSerializer(photo).data["animated_preview"])

    def test_the_grid_relations_load_what_the_flag_reads(self):
        """No query per video: the summary's .only() keeps the square's name."""
        photo = create_test_photo(owner=self.user, video=True)
        loaded = with_photo_summary_relations(Photo.objects.filter(pk=photo.pk)).get()
        with self.assertNumQueries(0):
            self.assertTrue(has_animated_preview(loaded))

    def test_a_video_with_a_still_is_not(self):
        photo = create_test_photo(owner=self.user, video=True)
        Thumbnail.objects.filter(photo=photo).update(
            square_thumbnail=f"square_thumbnails/{photo.image_hash}.webp"
        )
        photo = Photo.objects.get(pk=photo.pk)
        self.assertFalse(self._summary(photo)["animated_preview"])
        self.assertFalse(PhotoSimpleSerializer(photo).data["animated_preview"])

    def test_a_photo_is_not(self):
        photo = create_test_photo(owner=self.user)
        self.assertFalse(self._summary(photo)["animated_preview"])

    def test_a_video_without_a_thumbnail_row_is_not(self):
        photo = create_test_photo(owner=self.user, video=True)
        Thumbnail.objects.filter(photo=photo).delete()
        self.assertFalse(has_animated_preview(Photo.objects.get(pk=photo.pk)))
