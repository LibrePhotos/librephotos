"""Face regions under each EXIF orientation, pinned against libvips (#2292).

A file stores face areas in the coordinates of the stored image; LibrePhotos'
face boxes live in the thumbnail, which libvips' ``autorot()`` turned upright.
``region_to_display`` has to move a region exactly as ``autorot()`` moves the
pixels under it, and ``region_to_stored`` has to undo that.
"""

import numpy as np
import pyvips
from django.test import SimpleTestCase

from api.metadata.orientation import (
    normalize_orientation,
    region_to_display,
    region_to_stored,
)

# Stored image and a marked rectangle in it, off-centre and wider than tall so
# every orientation moves it somewhere else.
WIDTH, HEIGHT = 40, 24
LEFT, TOP, BOX_WIDTH, BOX_HEIGHT = 6, 4, 10, 2


def _marked_image() -> pyvips.Image:
    pixels = np.zeros((HEIGHT, WIDTH), dtype=np.uint8)
    pixels[TOP : TOP + BOX_HEIGHT, LEFT : LEFT + BOX_WIDTH] = 255
    return pyvips.Image.new_from_array(pixels)


def _marked_region(image: pyvips.Image) -> tuple[float, float, float, float]:
    """The marked rectangle of ``image``: centre x, centre y, width, height, normalized."""
    pixels = image.numpy()
    rows, columns = np.nonzero(pixels)
    left, right = columns.min(), columns.max() + 1
    top, bottom = rows.min(), rows.max() + 1
    return (
        (left + right) / 2 / image.width,
        (top + bottom) / 2 / image.height,
        (right - left) / image.width,
        (bottom - top) / image.height,
    )


def _autorotated(image: pyvips.Image, orientation: int) -> pyvips.Image:
    tagged = image.copy()
    tagged.set_type(pyvips.GValue.gint_type, "orientation", orientation)
    return tagged.autorot()


class RegionOrientationTest(SimpleTestCase):
    def test_region_to_display_moves_the_region_like_libvips(self):
        stored = _marked_image()
        region = _marked_region(stored)
        for orientation in range(1, 9):
            with self.subTest(orientation=orientation):
                expected = _marked_region(_autorotated(stored, orientation))
                for got, want in zip(region_to_display(region, orientation), expected):
                    self.assertAlmostEqual(want, got, places=9)

    def test_region_to_stored_inverts_region_to_display(self):
        region = (0.2, 0.3, 0.1, 0.25)
        for orientation in range(1, 9):
            with self.subTest(orientation=orientation):
                shown = region_to_display(region, orientation)
                for got, want in zip(region_to_stored(shown, orientation), region):
                    self.assertAlmostEqual(want, got, places=9)


class NormalizeOrientationTest(SimpleTestCase):
    def test_numbers_and_exiftool_print_strings_agree(self):
        names = {
            "Horizontal (normal)": 1,
            "Mirror horizontal": 2,
            "Rotate 180": 3,
            "Mirror vertical": 4,
            "Mirror horizontal and rotate 270 CW": 5,
            "Rotate 90 CW": 6,
            "Mirror horizontal and rotate 90 CW": 7,
            "Rotate 270 CW": 8,
        }
        for name, number in names.items():
            with self.subTest(name=name):
                self.assertEqual(number, normalize_orientation(name))
                self.assertEqual(number, normalize_orientation(number))
                self.assertEqual(number, normalize_orientation(str(number)))

    def test_missing_or_unknown_is_upright(self):
        for value in (None, "", "Unknown (0)", "sideways", 0, 9, -1):
            with self.subTest(value=value):
                self.assertEqual(1, normalize_orientation(value))
