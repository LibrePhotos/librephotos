"""The numpy pHash gives the hashes ImageHash 4.3.2 gave.

``Photo.perceptual_hash`` holds values computed by ``imagehash.phash`` and the
scan compares new hashes with them (``SIMILAR_PICTURE_DISTANCE`` in
``api/directory_watcher/file_handlers.py``), so a drift would make unchanged
photos look replaced. The expected values below were computed once with
``imagehash.phash`` (ImageHash 4.3.2, scipy 1.18.1, Pillow 13.0.0) on the same images.

A failure after a Pillow upgrade means its Lanczos resize changed, which moves
new hashes away from the stored ones just as it would have with ImageHash.
"""

import random
import shutil
import tempfile
from collections.abc import Callable
from pathlib import Path
from unittest import skipUnless

import PIL.Image
import PIL.ImageDraw
from django.test import SimpleTestCase

from api.duplicates.perceptual_hash import (
    calculate_perceptual_hash,
    hamming_distance,
    phash,
)
from api.tests.infra.deploy_files import DEPLOY_DIR

# The backend image ships apps/backend only; the generated images still run there.
E2E_PHOTOS = DEPLOY_DIR / "e2e" / "photos"


def horizontal_gradient() -> PIL.Image.Image:
    return PIL.Image.linear_gradient("L").rotate(90)


def diagonal_gradient() -> PIL.Image.Image:
    return PIL.Image.linear_gradient("L").rotate(
        30, resample=PIL.Image.Resampling.BICUBIC
    )


def radial_gradient() -> PIL.Image.Image:
    return PIL.Image.radial_gradient("L")


def mandelbrot() -> PIL.Image.Image:
    # Off-centre: the whole set is mirror-symmetric, which ties coefficients.
    return PIL.Image.effect_mandelbrot((320, 240), (-2.0, -1.0, 1.0, 1.4), 100)


def grey_noise() -> PIL.Image.Image:
    return PIL.Image.frombytes("L", (97, 61), random.Random(7).randbytes(97 * 61))


def colour_noise() -> PIL.Image.Image:
    return PIL.Image.frombytes(
        "RGB", (120, 80), random.Random(11).randbytes(120 * 80 * 3)
    )


def photo_like() -> PIL.Image.Image:
    """Smooth colour fields, hard edges and texture, like a photo has."""
    red = PIL.Image.linear_gradient("L")
    green = PIL.Image.radial_gradient("L")
    blue = PIL.Image.effect_mandelbrot((256, 256), (-1.5, -1.0, 0.5, 1.0), 60)
    image = PIL.Image.merge("RGB", (red, green, blue)).resize((400, 300))
    draw = PIL.ImageDraw.Draw(image)
    draw.ellipse((40, 30, 180, 170), fill=(230, 200, 40))
    draw.rectangle((220, 150, 380, 280), fill=(20, 60, 120))
    draw.line((0, 299, 399, 0), fill=(255, 255, 255), width=9)
    return image


def photo_like_with_alpha() -> PIL.Image.Image:
    image = photo_like().convert("RGBA")
    image.putalpha(PIL.Image.linear_gradient("L").resize(image.size))
    return image


def flat() -> PIL.Image.Image:
    return PIL.Image.new("L", (64, 64), 128)


def nearly_flat() -> PIL.Image.Image:
    """One grey level with 20 pixels one step brighter."""
    image = PIL.Image.new("L", (64, 64), 128)
    rng = random.Random(3)
    for _ in range(20):
        image.putpixel((rng.randrange(64), rng.randrange(64)), 129)
    return image


def low_contrast() -> PIL.Image.Image:
    """Three grey levels in rings, like fog or a blank wall."""
    return PIL.Image.radial_gradient("L").point(lambda v: 120 + v // 86)


def flat_with_block() -> PIL.Image.Image:
    """A grey square in a corner of another grey: two levels, nothing else."""
    image = PIL.Image.new("L", (64, 64), 40)
    image.paste(60, (0, 0, 16, 16))
    return image


GENERATED: dict[str, Callable[[], PIL.Image.Image]] = {
    "horizontal_gradient": horizontal_gradient,
    "diagonal_gradient": diagonal_gradient,
    "radial_gradient": radial_gradient,
    "mandelbrot": mandelbrot,
    "grey_noise": grey_noise,
    "colour_noise": colour_noise,
    "photo_like": photo_like,
    "photo_like_with_alpha": photo_like_with_alpha,
    "flat": flat,
    "nearly_flat": nearly_flat,
    "low_contrast": low_contrast,
}

# str(imagehash.phash(image, hash_size=8)) of each image, through
# calculate_perceptual_hash (files saved as PNG, so nothing is lost).
IMAGEHASH_VALUES = {
    "e2e_01.jpg": "c5113a6fc5103b6f",
    "e2e_02.jpg": "c6a93996c6a93b86",
    "e2e_03.jpg": "c69139c6c4b93bc6",
    "e2e_04.jpg": "c6a13986c6f97986",
    "e2e_05.jpg": "c69139cec6913bc6",
    "e2e_06.jpg": "c6593966c6993966",
    "e2e_07.jpg": "c79438cbc5943b4b",
    "e2e_08.jpg": "c6b139c6c6b139c6",
    "horizontal_gradient": "aa00000000000000",
    "diagonal_gradient": "813d53bc5ba46b94",
    "radial_gradient": "ee989837e69ac819",
    "mandelbrot": "c4e41b9a63736467",
    "grey_noise": "dd592a7a14b4c35a",
    "colour_noise": "afd04f96ca1c450f",
    "photo_like": "e207bc39b9489e4e",
    "photo_like_with_alpha": "e207bc39b9489e4e",
    "flat": "8000000000000000",
    "nearly_flat": "8000000000000000",
    "low_contrast": "ff8a94a2c1a2d688",
}

# Other hash sizes: imagehash.phash(image, hash_size=n).
IMAGEHASH_OTHER_SIZES = {
    ("photo_like", 4): "e0b3",
    (
        "photo_like",
        16,
    ): "e2aba775bdcc3b88b9544863be675eca95956c3994374bec83186c3b93024386",
    ("mandelbrot", 2): "a",
    ("mandelbrot", 12): "c4ee4a1b19a961673766d6764763c938e849",
}


class PerceptualHashParityTest(SimpleTestCase):
    def setUp(self) -> None:
        self.temp_dir = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.temp_dir, ignore_errors=True)

    def _saved(self, name: str) -> str:
        path = self.temp_dir / f"{name}.png"
        GENERATED[name]().save(path)
        return str(path)

    @skipUnless(E2E_PHOTOS.is_dir(), "needs the repository checkout")
    def test_e2e_photos(self) -> None:
        photos = sorted(E2E_PHOTOS.glob("*.jpg"))
        self.assertEqual(
            [p.name for p in photos],
            [name for name in IMAGEHASH_VALUES if name.endswith(".jpg")],
        )
        for photo in photos:
            with self.subTest(photo=photo.name):
                self.assertEqual(
                    calculate_perceptual_hash(str(photo)), IMAGEHASH_VALUES[photo.name]
                )

    def test_generated_images(self) -> None:
        for name in GENERATED:
            with self.subTest(image=name):
                self.assertEqual(
                    calculate_perceptual_hash(self._saved(name)),
                    IMAGEHASH_VALUES[name],
                )

    def test_other_hash_sizes(self) -> None:
        for (name, size), expected in IMAGEHASH_OTHER_SIZES.items():
            with self.subTest(image=name, hash_size=size):
                self.assertEqual(phash(GENERATED[name](), hash_size=size), expected)

    def test_flat_and_nearly_flat_images(self) -> None:
        # Every coefficient but the first is zero, so is the median, and only
        # the first bit is set. scipy's FFT returns exact zeros there; our
        # matrix product leaves ~1e-12 of rounding noise, snapped to zero, or
        # its sign would decide the other 63 bits. A few pixels one step
        # brighter do not change that.
        self.assertEqual(phash(flat()), "8000000000000000")
        self.assertEqual(phash(nearly_flat()), "8000000000000000")

    def test_two_level_image_may_move_a_few_bits(self) -> None:
        # Here half the low coefficients are zero by symmetry, so the median
        # is zero and each of those bits is the sign of rounding noise: scipy's
        # FFT left +-1e-14 there, ours is snapped to zero. Such a hash depended
        # on scipy's build before too. Real photos have no exact ties (no
        # difference over tens of thousands of thumbnails).
        imagehash_value = "f0f8f0f000070f0f"
        ours = phash(flat_with_block())
        self.assertEqual(ours, "f0f0f0f000070707")
        self.assertLessEqual(hamming_distance(ours, imagehash_value), 3)

    def test_hash_size_below_two_is_refused(self) -> None:
        with self.assertRaises(ValueError):
            phash(flat(), hash_size=1)
