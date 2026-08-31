"""Characterization tests for api/thumbnails.py (CRAP unit 30).

Pins the CURRENT behavior of:
  * ``_apply_local_orientation`` -- the EXIF-orientation transform dispatch
  * ``create_thumbnail``         -- raw/non-raw thumbnail creation

The orientation tests use real (tiny, in-memory) pyvips images so the actual
pixel transform is pinned, not just the method name that gets called.
``create_thumbnail`` is exercised with pyvips/requests fully mocked -- no
image files, no RAW service, no network.
"""

import os
from unittest import mock

import pyvips
from django.test import SimpleTestCase, override_settings

from api.thumbnails import _apply_local_orientation, create_thumbnail

MEDIA_ROOT = os.path.join("/tmp", "lp-crap-u30-media")


def _make_image():
    """A 3x2 single-band image with distinct pixel values.

    Raster layout:
        0 1 2
        3 4 5
    """
    return pyvips.Image.new_from_memory(bytes([0, 1, 2, 3, 4, 5]), 3, 2, 1, "uchar")


def _pixels(image):
    return list(bytes(image.write_to_memory()))


class ApplyLocalOrientationTests(SimpleTestCase):
    """Pins the pixel-level result of every orientation branch."""

    def setUp(self):
        self.image = _make_image()

    def test_orientation_1_returns_same_object(self):
        result = _apply_local_orientation(self.image, 1)
        self.assertIs(result, self.image)

    def test_orientation_none_returns_same_object(self):
        # ``None`` short-circuits on the first ``if`` (the ``is None`` check).
        result = _apply_local_orientation(self.image, None)
        self.assertIs(result, self.image)

    def test_orientation_2_flips_horizontally(self):
        result = _apply_local_orientation(self.image, 2)
        self.assertEqual((result.width, result.height), (3, 2))
        self.assertEqual(_pixels(result), [2, 1, 0, 5, 4, 3])

    def test_orientation_3_rotates_180(self):
        result = _apply_local_orientation(self.image, 3)
        self.assertEqual((result.width, result.height), (3, 2))
        self.assertEqual(_pixels(result), [5, 4, 3, 2, 1, 0])

    def test_orientation_4_flips_vertically(self):
        result = _apply_local_orientation(self.image, 4)
        self.assertEqual((result.width, result.height), (3, 2))
        self.assertEqual(_pixels(result), [3, 4, 5, 0, 1, 2])

    def test_orientation_5_rot90_then_flip_horizontal(self):
        result = _apply_local_orientation(self.image, 5)
        self.assertEqual((result.width, result.height), (2, 3))
        # rot90 -> [3,0 / 4,1 / 5,2]; flip H -> [0,3 / 1,4 / 2,5]
        self.assertEqual(_pixels(result), [0, 3, 1, 4, 2, 5])

    def test_orientation_6_uses_rot270(self):
        result = _apply_local_orientation(self.image, 6)
        self.assertEqual((result.width, result.height), (2, 3))
        self.assertEqual(_pixels(result), [2, 5, 1, 4, 0, 3])
        self.assertEqual(_pixels(result), _pixels(self.image.rot270()))

    def test_orientation_7_rot270_then_flip_horizontal(self):
        result = _apply_local_orientation(self.image, 7)
        self.assertEqual((result.width, result.height), (2, 3))
        # rot270 -> [2,5 / 1,4 / 0,3]; flip H -> [5,2 / 4,1 / 3,0]
        self.assertEqual(_pixels(result), [5, 2, 4, 1, 3, 0])

    def test_orientation_8_uses_rot90(self):
        result = _apply_local_orientation(self.image, 8)
        self.assertEqual((result.width, result.height), (2, 3))
        self.assertEqual(_pixels(result), [3, 0, 4, 1, 5, 2])
        self.assertEqual(_pixels(result), _pixels(self.image.rot90()))

    def test_unknown_orientation_returns_image_unchanged(self):
        for value in (9, -1, 42):
            with self.subTest(value=value):
                self.assertIs(_apply_local_orientation(self.image, value), self.image)

    def test_orientation_zero_falls_through_to_identity(self):
        # 0 is falsy but not ``None`` and not 1 -- it reaches the final return.
        self.assertIs(_apply_local_orientation(self.image, 0), self.image)

    def test_5_and_7_are_not_equal(self):
        # Guards against collapsing the two "rotate + flip" branches.
        self.assertNotEqual(
            _pixels(_apply_local_orientation(self.image, 5)),
            _pixels(_apply_local_orientation(self.image, 7)),
        )


@override_settings(MEDIA_ROOT=MEDIA_ROOT)
class CreateThumbnailNonRawTests(SimpleTestCase):
    """Non-raw input: pyvips thumbnail + optional local orientation."""

    def setUp(self):
        patcher = mock.patch("api.thumbnails.pyvips")
        self.pyvips = patcher.start()
        self.addCleanup(patcher.stop)
        # ``pyvips.enums`` is mocked too; the values are only passed through.
        self.thumb = self.pyvips.Image.thumbnail.return_value

    def test_happy_path_orientation_1(self):
        result = create_thumbnail(
            "/data/photo.jpg", 200, "thumbnails_big", "abc123", ".webp"
        )
        expected = os.path.join(MEDIA_ROOT, "thumbnails_big", "abc123.webp")
        self.assertEqual(result, expected)
        self.pyvips.Image.thumbnail.assert_called_once_with(
            "/data/photo.jpg",
            10000,
            height=200,
            size=self.pyvips.enums.Size.DOWN,
        )
        # orientation 1 -> no copy_memory, the thumbnail itself is written
        self.thumb.copy_memory.assert_not_called()
        self.thumb.write_to_file.assert_called_once_with(expected, Q=95)

    def test_orientation_none_skips_transform(self):
        create_thumbnail(
            "/data/photo.jpg",
            200,
            "thumbnails_small",
            "h",
            ".webp",
            local_orientation=None,
        )
        self.thumb.copy_memory.assert_not_called()
        self.thumb.write_to_file.assert_called_once()

    def test_orientation_zero_skips_transform(self):
        # 0 is falsy, so the ``local_orientation and ...`` guard skips it.
        create_thumbnail(
            "/data/photo.jpg",
            200,
            "thumbnails_small",
            "h",
            ".webp",
            local_orientation=0,
        )
        self.thumb.copy_memory.assert_not_called()

    def test_non_trivial_orientation_copies_memory_and_transforms(self):
        with mock.patch("api.thumbnails._apply_local_orientation") as apply_mock:
            result = create_thumbnail(
                "/data/photo.jpg",
                200,
                "thumbnails_big",
                "abc123",
                ".webp",
                local_orientation=6,
            )
        expected = os.path.join(MEDIA_ROOT, "thumbnails_big", "abc123.webp")
        self.assertEqual(result, expected)
        copied = self.thumb.copy_memory.return_value
        apply_mock.assert_called_once_with(copied, 6)
        # the *transformed* image is what gets written
        apply_mock.return_value.write_to_file.assert_called_once_with(expected, Q=95)
        self.thumb.write_to_file.assert_not_called()

    def test_exception_is_logged_and_reraised(self):
        boom = RuntimeError("vips exploded")
        self.pyvips.Image.thumbnail.side_effect = boom
        with mock.patch("api.thumbnails.util.logger") as logger:
            with self.assertRaises(RuntimeError) as ctx:
                create_thumbnail("/data/photo.jpg", 200, "thumbnails_big", "h", ".webp")
        self.assertIs(ctx.exception, boom)
        logger.error.assert_called_once_with(
            "Could not create thumbnail for file /data/photo.jpg"
        )


@override_settings(MEDIA_ROOT=MEDIA_ROOT)
class CreateThumbnailRawTests(SimpleTestCase):
    """RAW input: big thumbnails go through the RAW service on port 8003."""

    RAW_PATH = "/data/photo.CR2"

    def setUp(self):
        pyvips_patcher = mock.patch("api.thumbnails.pyvips")
        self.pyvips = pyvips_patcher.start()
        self.addCleanup(pyvips_patcher.stop)
        requests_patcher = mock.patch("api.thumbnails.requests")
        self.requests = requests_patcher.start()
        self.addCleanup(requests_patcher.stop)
        self.requests.post.return_value.json.return_value = {
            "thumbnail": "/service/result.webp"
        }

    def test_big_thumbnail_posts_to_raw_service_and_returns_service_path(self):
        from api.http_timeouts import THUMBNAIL

        result = create_thumbnail(
            self.RAW_PATH, 800, "thumbnails_big", "deadbeef", ".webp"
        )
        # NOTE: the RAW/big branch returns the service's response, *not* the
        # locally computed complete_path like every other branch.
        self.assertEqual(result, "/service/result.webp")
        self.requests.post.assert_called_once_with(
            "http://localhost:8003/",
            json={
                "source": self.RAW_PATH,
                "destination": os.path.join(
                    MEDIA_ROOT, "thumbnails_big", "deadbeef.webp"
                ),
                "height": 800,
            },
            timeout=THUMBNAIL,
        )
        # orientation 1 -> no post-processing of the service output
        self.pyvips.Image.new_from_file.assert_not_called()

    def test_big_thumbnail_applies_local_orientation_in_place(self):
        with mock.patch("api.thumbnails._apply_local_orientation") as apply_mock:
            result = create_thumbnail(
                self.RAW_PATH,
                800,
                "thumbnails_big",
                "deadbeef",
                ".webp",
                local_orientation=8,
            )
        complete = os.path.join(MEDIA_ROOT, "thumbnails_big", "deadbeef.webp")
        self.assertEqual(result, "/service/result.webp")
        self.pyvips.Image.new_from_file.assert_called_once_with(complete)
        copied = self.pyvips.Image.new_from_file.return_value.copy_memory.return_value
        apply_mock.assert_called_once_with(copied, 8)
        apply_mock.return_value.write_to_file.assert_called_once_with(complete, Q=95)

    def test_small_raw_thumbnail_resizes_the_big_thumbnail(self):
        result = create_thumbnail(
            self.RAW_PATH, 200, "thumbnails_small", "deadbeef", ".webp"
        )
        big = os.path.join(MEDIA_ROOT, "thumbnails_big", "deadbeef.webp")
        expected = os.path.join(MEDIA_ROOT, "thumbnails_small", "deadbeef.webp")
        self.assertEqual(result, expected)
        self.requests.post.assert_not_called()
        self.pyvips.Image.thumbnail.assert_called_once_with(
            big, 10000, height=200, size=self.pyvips.enums.Size.DOWN
        )
        self.pyvips.Image.thumbnail.return_value.write_to_file.assert_called_once_with(
            expected, Q=95
        )

    def test_small_raw_thumbnail_ignores_local_orientation(self):
        with mock.patch("api.thumbnails._apply_local_orientation") as apply_mock:
            create_thumbnail(
                self.RAW_PATH,
                200,
                "thumbnails_small",
                "deadbeef",
                ".webp",
                local_orientation=6,
            )
        # Deliberate: the big thumbnail already carries the rotation.
        apply_mock.assert_not_called()

    def test_output_path_containing_thumbnails_big_substring_takes_raw_branch(self):
        # The branch test is a substring check, not an equality check.
        create_thumbnail(self.RAW_PATH, 800, "nested/thumbnails_big/x", "h", ".webp")
        self.requests.post.assert_called_once()

    def test_raw_service_error_is_logged_and_reraised(self):
        boom = ValueError("service down")
        self.requests.post.side_effect = boom
        with mock.patch("api.thumbnails.util.logger") as logger:
            with self.assertRaises(ValueError) as ctx:
                create_thumbnail(self.RAW_PATH, 800, "thumbnails_big", "h", ".webp")
        self.assertIs(ctx.exception, boom)
        logger.error.assert_called_once_with(
            f"Could not create thumbnail for file {self.RAW_PATH}"
        )

    def test_missing_thumbnail_key_in_response_raises_keyerror(self):
        self.requests.post.return_value.json.return_value = {}
        with mock.patch("api.thumbnails.util.logger"):
            with self.assertRaises(KeyError):
                create_thumbnail(self.RAW_PATH, 800, "thumbnails_big", "h", ".webp")
