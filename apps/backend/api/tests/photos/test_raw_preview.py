"""``image_decoding.raw_preview``: when the camera's embedded JPEG stands in for a RAW render.

rawpy is faked; the previews are real JPEGs so pyvips does the actual work.
"""

import io
from types import SimpleNamespace
from unittest import mock

import pyvips
import rawpy
from django.test import SimpleTestCase
from PIL import Image

from api import image_decoding


def _jpeg(width, height, exif_orientation=None):
    buffer = io.BytesIO()
    image = Image.new("RGB", (width, height), (10, 200, 30))
    # Mark the top-left corner so rotations can be told apart.
    image.paste((255, 0, 0), (0, 0, width // 4, height // 4))
    exif = Image.Exif()
    if exif_orientation:
        exif[0x0112] = exif_orientation
    image.save(buffer, "JPEG", exif=exif.tobytes())
    return buffer.getvalue()


class _FakeRaw:
    def __init__(self, width, height, flip, thumb):
        self.sizes = SimpleNamespace(width=width, height=height, flip=flip)
        self._thumb = thumb

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def extract_thumb(self):
        if isinstance(self._thumb, Exception):
            raise self._thumb
        return self._thumb


def _preview(raw_size, jpeg, flip=0, height=1080, thumb_format=rawpy.ThumbFormat.JPEG):
    thumb = SimpleNamespace(format=thumb_format, data=jpeg)
    fake = _FakeRaw(*raw_size, flip, thumb)
    with mock.patch("api.image_decoding.rawpy.imread", return_value=fake):
        return image_decoding.raw_preview("/photos/x.CR2", height)


def _red_corner(image):
    """Which corner holds the red marker: tl, tr, bl or br."""
    w, h = image.width, image.height
    corners = {
        "tl": (w // 16, h // 16),
        "tr": (w - 1 - w // 16, h // 16),
        "bl": (w // 16, h - 1 - h // 16),
        "br": (w - 1 - w // 16, h - 1 - h // 16),
    }
    for name, (x, y) in corners.items():
        r, g, _ = image.getpoint(x, y)[:3]
        if r > 200 and g < 80:
            return name
    return None


class RawPreviewTest(SimpleTestCase):
    def test_full_size_preview_is_used(self):
        image = _preview((5184, 3456), _jpeg(5184, 3456))
        self.assertEqual((image.width, image.height), (1620, 1080))
        self.assertEqual(_red_corner(image), "tl")

    def test_preview_exactly_as_tall_as_the_thumbnail_is_used(self):
        # Panasonic RW2: 4608x2600 sensor output, 1920x1080 preview.
        image = _preview((4608, 2600), _jpeg(1920, 1080))
        self.assertEqual((image.width, image.height), (1920, 1080))

    def test_libraw_rotation_is_applied(self):
        # flip 6: the camera was turned clockwise, the picture is portrait.
        image = _preview((5184, 3456), _jpeg(5184, 3456), flip=6)
        self.assertEqual((image.width, image.height), (720, 1080))
        self.assertEqual(_red_corner(image), "tr")

        image = _preview((5184, 3456), _jpeg(5184, 3456), flip=5)
        self.assertEqual((image.width, image.height), (720, 1080))
        self.assertEqual(_red_corner(image), "bl")

        image = _preview((5184, 3456), _jpeg(5184, 3456), flip=3)
        self.assertEqual((image.width, image.height), (1620, 1080))
        self.assertEqual(_red_corner(image), "br")

    def test_preview_exif_orientation_is_ignored_and_dropped(self):
        # LibRaw's flip decides, and the thumbnail must carry no orientation
        # a browser would apply a second time.
        image = _preview((5184, 3456), _jpeg(5184, 3456, exif_orientation=8), flip=0)
        self.assertEqual(_red_corner(image), "tl")
        self.assertEqual(image.get_typeof("orientation"), 0)
        # libvips writes a minimal EXIF block of its own, saying "upright".
        written = pyvips.Image.new_from_buffer(image.write_to_buffer(".webp"), "")
        self.assertEqual(written.get("orientation"), 1)

    def test_letterboxed_preview_is_not_used(self):
        # A 3:2 sensor with a 16:9 preview shows a crop or black bars.
        self.assertIsNone(_preview((6000, 4000), _jpeg(1920, 1080)))

    def test_preview_smaller_than_the_thumbnail_is_not_used(self):
        self.assertIsNone(_preview((6000, 4000), _jpeg(640, 427)))

    def test_small_raw_accepts_a_preview_as_big_as_the_render(self):
        # The render could not be taller than the sensor output either.
        image = _preview((900, 600), _jpeg(900, 600))
        self.assertEqual((image.width, image.height), (900, 600))

    def test_bitmap_thumbnail_is_not_used(self):
        self.assertIsNone(
            _preview(
                (6000, 4000),
                b"",
                thumb_format=rawpy.ThumbFormat.BITMAP,
            )
        )

    def test_no_thumbnail_is_not_an_error(self):
        fake = _FakeRaw(6000, 4000, 0, rawpy.LibRawNoThumbnailError())
        with mock.patch("api.image_decoding.rawpy.imread", return_value=fake):
            self.assertIsNone(image_decoding.raw_preview("/photos/x.NEF", 1080))

    def test_unreadable_raw_is_not_an_error(self):
        with mock.patch(
            "api.image_decoding.rawpy.imread", side_effect=rawpy.LibRawIOError()
        ):
            self.assertIsNone(image_decoding.raw_preview("/photos/x.NEF", 1080))
