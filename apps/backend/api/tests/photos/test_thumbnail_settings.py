"""Thumbnail size and quality come from the settings (issue #516).

BIG_THUMBNAIL_QUALITY and BIG_THUMBNAIL_HEIGHT shape the big thumbnail,
VIDEO_PREVIEW_SECONDS and VIDEO_PREVIEW_CRF the animated video previews; all
four are read from the environment and clamped. A face box is stored in pixels
of the big thumbnail, so one rendered again at another height scales the
photo's face boxes with it.
"""

import importlib
import os
import shutil
import tempfile
from unittest import mock
from unittest.mock import patch

import pyvips
from django.test import SimpleTestCase, TestCase, override_settings
from PIL import Image

from api.models import Face
from api.tests.utils import create_test_face, create_test_photo, create_test_user
from api.thumbnails import face_boxes, render
from librephotos.settings import production

ALL_SIZES = ["thumbnails_big", "square_thumbnails", "square_thumbnails_small"]
_TOUCHED = (
    "BIG_THUMBNAIL_QUALITY",
    "BIG_THUMBNAIL_HEIGHT",
    "VIDEO_PREVIEW_SECONDS",
    "VIDEO_PREVIEW_CRF",
)


def _size(path):
    # From bytes, so libvips holds no handle on Windows and cleanup works.
    with open(path, "rb") as handle:
        image = pyvips.Image.new_from_buffer(handle.read(), "")
    return image.width, image.height


class ThumbnailSettingsParsingTest(SimpleTestCase):
    def setUp(self):
        super().setUp()
        # Put the settings module back the way the rest of the suite expects it.
        self.addCleanup(importlib.reload, production)

    def _reload(self, **values):
        environment = {k: v for k, v in os.environ.items() if k not in _TOUCHED}
        environment.update(values)
        with patch.dict(os.environ, environment, clear=True):
            importlib.reload(production)
        return production

    def _values(self, settings):
        return [getattr(settings, name) for name in _TOUCHED]

    def test_unset_keeps_what_was_hard_coded(self):
        self.assertEqual(self._values(self._reload()), [95, 1080, 5, 20])

    def test_values_in_range_are_taken(self):
        settings = self._reload(
            BIG_THUMBNAIL_QUALITY="70",
            BIG_THUMBNAIL_HEIGHT="2160",
            VIDEO_PREVIEW_SECONDS="10",
            VIDEO_PREVIEW_CRF="28",
        )
        self.assertEqual(self._values(settings), [70, 2160, 10, 28])

    def test_values_below_the_range_are_raised_to_its_floor(self):
        settings = self._reload(
            BIG_THUMBNAIL_QUALITY="0",
            BIG_THUMBNAIL_HEIGHT="100",
            VIDEO_PREVIEW_SECONDS="0",
            VIDEO_PREVIEW_CRF="-5",
        )
        self.assertEqual(self._values(settings), [1, 500, 1, 0])

    def test_values_above_the_range_are_lowered_to_its_ceiling(self):
        settings = self._reload(
            BIG_THUMBNAIL_QUALITY="150",
            BIG_THUMBNAIL_HEIGHT="10000",
            VIDEO_PREVIEW_SECONDS="600",
            VIDEO_PREVIEW_CRF="99",
        )
        self.assertEqual(self._values(settings), [100, 4320, 30, 51])


class BigThumbnailSettingsTest(SimpleTestCase):
    def setUp(self):
        self.media = tempfile.mkdtemp(prefix="librephotos-thumbs")
        self.addCleanup(shutil.rmtree, self.media, True)
        for directory in ALL_SIZES:
            os.makedirs(os.path.join(self.media, directory))
        self.source = os.path.join(self.media, "photo.jpg")
        Image.new("RGB", (2000, 1500), (200, 120, 40)).save(self.source)
        settings = override_settings(MEDIA_ROOT=self.media)
        settings.enable()
        self.addCleanup(settings.disable)

    def path(self, directory):
        return os.path.join(self.media, directory, "h.webp")

    @override_settings(BIG_THUMBNAIL_HEIGHT=600)
    def test_the_big_thumbnail_has_the_configured_height(self):
        with mock.patch(
            "api.thumbnails.render.decoding.thumbnail",
            wraps=render.decoding.thumbnail,
        ) as decode:
            render.create_static_thumbnails(self.source, "h", ALL_SIZES)

        decode.assert_called_once_with(self.source, 600)
        self.assertEqual(_size(self.path("thumbnails_big")), (800, 600))
        # The squares keep their sizes.
        self.assertEqual(_size(self.path("square_thumbnails")), (667, 500))
        self.assertEqual(_size(self.path("square_thumbnails_small")), (333, 250))

    @override_settings(BIG_THUMBNAIL_QUALITY=70, SQUARE_THUMBNAIL_QUALITY=60)
    def test_the_big_thumbnail_has_the_configured_quality(self):
        written = {}
        real_write = pyvips.Image.write_to_file

        def record(image, path, **options):
            written[os.path.basename(os.path.dirname(path))] = options["Q"]
            return real_write(image, path, **options)

        with mock.patch.object(pyvips.Image, "write_to_file", record):
            render.create_static_thumbnails(self.source, "h", ALL_SIZES)

        self.assertEqual(
            written,
            {
                "thumbnails_big": 70,
                "square_thumbnails": 60,
                "square_thumbnails_small": 60,
            },
        )

    @override_settings(BIG_THUMBNAIL_HEIGHT=700, BIG_THUMBNAIL_QUALITY=80)
    def test_a_raw_without_a_usable_preview_asks_the_service_for_both(self):
        raw = os.path.join(self.media, "photo.CR2")
        with (
            mock.patch("api.thumbnails.render.decoding.raw_preview", return_value=None),
            mock.patch.object(render.sidecars, "post") as post,
        ):
            post.return_value.json.return_value = {"thumbnail": "x"}
            render.create_static_thumbnails(raw, "h", ["thumbnails_big"])

        payload = post.call_args.kwargs["json"]
        self.assertEqual(payload["height"], 700)
        self.assertEqual(payload["quality"], 80)

    def test_big_thumbnail_size_reads_the_file_on_disk(self):
        self.assertIsNone(render.big_thumbnail_size("h"))

        Image.new("RGB", (640, 480)).save(self.path("thumbnails_big"), "WEBP")

        self.assertEqual(render.big_thumbnail_size("h"), (640, 480))


@override_settings(BIG_THUMBNAIL_HEIGHT=600, BIG_THUMBNAIL_QUALITY=70)
class RenderBigThumbnailToTest(SimpleTestCase):
    """The render a changed file's perceptual hash is compared through."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="librephotos-compare")
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.source = os.path.join(self.tmp, "photo.png")
        Image.new("RGB", (2000, 1500), (10, 20, 30)).save(self.source)
        self.out = os.path.join(self.tmp, "out.webp")

    def _render(self, **kwargs):
        written = {}
        real_write = pyvips.Image.write_to_file

        def record(image, path, **options):
            written.update(options)
            return real_write(image, path, **options)

        with mock.patch.object(pyvips.Image, "write_to_file", record):
            render.render_big_thumbnail_to(self.source, self.out, **kwargs)
        return _size(self.out), written["Q"]

    def test_it_follows_the_settings(self):
        self.assertEqual(self._render(), ((800, 600), 70))

    def test_the_height_of_the_indexed_thumbnail_wins(self):
        self.assertEqual(self._render(height=900), ((1200, 900), 70))

    def test_a_legacy_render_is_what_older_releases_made(self):
        self.assertEqual(self._render(legacy=True), ((1440, 1080), 95))

    def test_a_legacy_raw_render_asks_the_service_for_1080_at_95(self):
        with mock.patch.object(render, "_request_raw_thumbnail") as request:
            render.render_big_thumbnail_to("/photos/x.CR2", self.out, 1, legacy=True)

        request.assert_called_once_with("/photos/x.CR2", 1080, self.out, 1, quality=95)

    def test_a_raw_render_uses_the_height_too(self):
        preview = pyvips.Image.black(1200, 900, bands=3)
        with mock.patch(
            "api.thumbnails.render.decoding.raw_preview", return_value=preview
        ) as raw_preview:
            render.render_big_thumbnail_to("/photos/x.CR2", self.out, 1, height=900)

        raw_preview.assert_called_once_with("/photos/x.CR2", 900)
        self.assertEqual(_size(self.out), (1200, 900))


class VideoPreviewSettingsTest(SimpleTestCase):
    def setUp(self):
        self.media = tempfile.TemporaryDirectory()
        self.addCleanup(self.media.cleanup)
        settings = override_settings(MEDIA_ROOT=self.media.name)
        settings.enable()
        self.addCleanup(settings.disable)
        video_args = mock.patch.object(
            render.color, "h264_video_args", return_value=["-vf", "scale=-2:250"]
        )
        video_args.start()
        self.addCleanup(video_args.stop)

    def _command(self):
        with mock.patch.object(render.binaries, "run_tool") as run:
            render.create_animated_thumbnail("/v.mov", 250, "out", "h")
        return run.call_args.args[1]

    def _option(self, command, name):
        return command[command.index(name) + 1]

    def test_the_defaults_are_five_seconds_at_crf_20(self):
        command = self._command()
        self.assertEqual(self._option(command, "-to"), "5")
        self.assertEqual(self._option(command, "-crf"), "20")

    @override_settings(VIDEO_PREVIEW_SECONDS=12, VIDEO_PREVIEW_CRF=28)
    def test_length_and_crf_come_from_the_settings(self):
        command = self._command()
        self.assertEqual(self._option(command, "-to"), "12")
        self.assertEqual(self._option(command, "-crf"), "28")


class RescaleFaceBoxesTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)
        self.face = create_test_face(
            photo=self.photo,
            location_top=100,
            location_right=300,
            location_bottom=200,
            location_left=150,
        )

    def _box(self):
        face = Face.objects.get(pk=self.face.pk)
        return (
            face.location_top,
            face.location_right,
            face.location_bottom,
            face.location_left,
        )

    def test_a_taller_thumbnail_of_the_same_picture_scales_the_boxes(self):
        changed = face_boxes.rescale_face_boxes(self.photo, (1440, 1080), (2880, 2160))

        self.assertEqual(changed, 1)
        self.assertEqual(self._box(), (200, 600, 400, 300))

    def test_a_smaller_one_scales_them_down_rounded(self):
        face_boxes.rescale_face_boxes(self.photo, (1440, 1080), (960, 720))

        self.assertEqual(self._box(), (67, 200, 133, 100))

    def test_nothing_changes_without_a_size_change(self):
        for before, after in [
            (None, (960, 720)),
            ((960, 720), None),
            ((960, 720), (960, 720)),
            # A rotation: another shape, not another size.
            ((1440, 1080), (810, 1080)),
        ]:
            with self.subTest(before=before, after=after):
                self.assertEqual(
                    face_boxes.rescale_face_boxes(self.photo, before, after), 0
                )
                self.assertEqual(self._box(), (100, 300, 200, 150))


class RegenerateKeepsFaceBoxesOnTheFacesTest(TestCase):
    def setUp(self):
        self.media_root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.media_root, ignore_errors=True)
        media = override_settings(MEDIA_ROOT=self.media_root)
        media.enable()
        self.addCleanup(media.disable)
        user = create_test_user()
        self.photo = create_test_photo(owner=user)
        self.thumbnail = self.photo.thumbnail
        self.face = create_test_face(
            photo=self.photo,
            location_top=100,
            location_right=300,
            location_bottom=200,
            location_left=150,
        )
        self._write_big((1440, 1080))

    def _write_big(self, size):
        path = os.path.join(self.media_root, self.thumbnail.thumbnail_big.name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        Image.new("RGB", size).save(path, "WEBP")

    def _regenerate(self, size, **kwargs):
        def generate(instance):
            self._write_big(size)

        with mock.patch(
            "api.thumbnails.render.generate_thumbnail",
            autospec=True,
            side_effect=generate,
        ):
            render.regenerate_thumbnails(self.thumbnail, **kwargs)
        self.face.refresh_from_db()

    def test_a_new_big_thumbnail_height_scales_the_face_boxes(self):
        self._regenerate((2880, 2160))

        self.assertEqual(self.face.location_top, 200)
        self.assertEqual(self.face.location_right, 600)

    def test_a_rebuild_that_keeps_the_old_files_on_failure_scales_them_too(self):
        self._regenerate((720, 540), keep_old_on_failure=True)

        self.assertEqual(self.face.location_bottom, 100)
        self.assertEqual(self.face.location_left, 75)

    def test_the_same_height_leaves_them_alone(self):
        self._regenerate((1440, 1080))

        self.assertEqual(self.face.location_top, 100)
        self.assertEqual(self.face.location_right, 300)
