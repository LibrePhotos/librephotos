"""RAW files through the real decoders: the source, the render and the edit API.

The RAW is a DNG written by ``dng.write_dng`` from the patches of
``dng.test_card``, so every number below is known. ``flashraw`` and ``rawpy``
are imported here on purpose: both are pinned in ``requirements.txt`` without a
marker, and an environment without one fails this module instead of skipping
it. FlashRaw develops by default; ``LibRawSourceTest`` runs the source tests
again through LibRaw, which takes over for a file FlashRaw cannot read.

Tolerance of a source value: 0.002 plus 0.5 % (``assert_source``). The test
card's values reach the decoder through the 14-bit sensor values of the DNG (a
step of 1 / 15871), its white balance and scaling, the demosaic (exact in the
middle of a flat patch, which is all ``patch_centre`` reads) and the
square-root 16-bit encoding of the source (a step of 2e-4 relative at the
darkest grey). Measured, the error is about 1e-4; the margin is for versions
that round differently. A rendered value may be off by 2 of 255, the
renderers' own agreement (``photo-editing.md``, "Agreement between the
renderers").
"""

from __future__ import annotations

import io
import json
import os
import re
import tempfile
import zlib
from pathlib import Path
from typing import Any
from unittest import mock

import flashraw
import numpy as np
import numpy.typing as npt
import PIL.Image
import rawpy
from django.test import SimpleTestCase

from api.editing import source as source_module
from api.editing.files import rendition_path
from api.editing.pipeline import render
from api.editing.recipe import recipe_from_json
from api.editing.source import (
    LINEAR16_FILE_EDGE,
    RAW_BASE_GAIN,
    SRGB8_FILE_EDGE,
    Source,
    load_source,
    source_file_edge,
)
from api.tests.editing.dng import (
    COLUMNS,
    PATCHES,
    ROWS,
    Patch,
    patch_centre,
    test_card,
    write_dng,
)
from api.tests.editing.edited_photo import EditedPhotoTestCase, read_pixels, recipe
from api.tests.stubs import BACKEND_ROOT

BY_NAME = {patch.name: patch for patch in PATCHES}
WIDTH, HEIGHT = COLUMNS * 32, ROWS * 32


def linear(source: Source) -> npt.NDArray[np.float64]:
    """A linear16 source's values: ``max * (u / 65535) ** 2``."""
    codes = source.pixels.astype(np.float64) / 65535
    return source.max * codes * codes


def expected_source(patch: Patch) -> npt.NDArray[np.float64]:
    """LibRaw's output is the card clipped at 1.0, times the base gain."""
    return RAW_BASE_GAIN * np.minimum(np.asarray(patch.rgb), 1.0)


def oetf(x: npt.NDArray[np.float64]) -> npt.NDArray[np.float64]:
    return np.where(x <= 0.0031308, 12.92 * x, 1.055 * x ** (1 / 2.4) - 0.055)


def developed(value: npt.NDArray[np.float64], gain: float) -> npt.NDArray[np.float64]:
    """Stages 4.2 and 4.5 of the spec for a recipe of Exposure only, in 8 bits."""
    ceiling = max(1.0, RAW_BASE_GAIN * gain)
    c = np.clip(value * gain, 0.0, ceiling)
    if ceiling > 1:
        knee = 0.8
        t = (c - knee) / (ceiling - knee)
        p = (ceiling - knee) / (1 - knee)
        c = np.where(c > knee, knee + (1 - knee) * (1 - (1 - t) ** p), c)
    return np.floor(oetf(np.clip(c, 0.0, 1.0)) * 255 + 0.5)


def dng_bytes(
    orientation: int = 1, picture: npt.NDArray[np.float64] | None = None
) -> bytes:
    """The test card as a DNG with a camera-style JPEG preview, as bytes."""
    card = test_card() if picture is None else picture
    display = np.clip(RAW_BASE_GAIN * card, 0, 1) ** (1 / 2.2) * 255
    preview = io.BytesIO()
    PIL.Image.fromarray(display.round().astype(np.uint8)).save(preview, "JPEG")
    with tempfile.TemporaryDirectory() as directory:
        path = os.path.join(directory, "card.dng")
        write_dng(
            path,
            card,
            orientation=orientation,
            preview=preview.getvalue(),
        )
        return Path(path).read_bytes()


class DecodersAreRequiredTest(SimpleTestCase):
    def test_both_decoders_are_pinned_for_every_platform(self) -> None:
        lines = (BACKEND_ROOT / "requirements.txt").read_text().splitlines()
        for name, module in (("rawpy", rawpy), ("flashraw", flashraw)):
            with self.subTest(name):
                pins = [line for line in lines if re.match(rf"{name}\b", line)]
                self.assertEqual(len(pins), 1, pins)
                self.assertRegex(pins[0], rf"^{name}==[\d.]+$")
                self.assertTrue(module.__version__)


class RawSourceTest(SimpleTestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.directory = directory.name

    def write(self, orientation: int = 1, picture: Any = None) -> str:
        path = os.path.join(self.directory, f"card{orientation}.dng")
        Path(path).write_bytes(dng_bytes(orientation, picture))
        return path

    def assert_source(
        self, values: npt.NDArray[np.float64], rows: int = ROWS, columns: int = COLUMNS
    ) -> None:
        for patch in PATCHES:
            np.testing.assert_allclose(
                patch_centre(values, patch, rows, columns),
                expected_source(patch),
                rtol=0.005,
                atol=0.002,
                err_msg=patch.name,
            )

    def test_patches_land_at_their_linear_values(self) -> None:
        source = load_source(self.write(), 1)
        self.assertEqual(source.kind, "linear16")
        self.assertEqual(source.max, RAW_BASE_GAIN)
        self.assertEqual(source.pixels.dtype, np.uint16)
        self.assertEqual(source.pixels.shape, (HEIGHT, WIDTH, 3))
        self.assertEqual((source.full_width, source.full_height), (WIDTH, HEIGHT))
        self.assert_source(linear(source))
        # The over-white patch is brighter than a JPEG's white, below the clip.
        over_white = patch_centre(linear(source), BY_NAME["over_white"])
        self.assertTrue(np.all((over_white > 1.2) & (over_white < 1.3)))

    def test_brightness_does_not_depend_on_the_brightest_pixel(self) -> None:
        # Nothing clips: the brightest patch is at 0.9 of the white level.
        # LibRaw's default would make that the clip and brighten everything.
        source = load_source(self.write(picture=np.minimum(test_card(), 0.9)), 1)
        np.testing.assert_allclose(
            patch_centre(linear(source), BY_NAME["grey_50"]),
            [0.7, 0.7, 0.7],
            atol=0.002,
        )

    def test_orientation_tags_turn_the_picture(self) -> None:
        # Each case: the TIFF Orientation, and how to put the upright source
        # back into the card's layout.
        cases = {
            3: lambda p: np.rot90(p, 2),
            5: lambda p: p.transpose(1, 0, 2),
            6: lambda p: np.rot90(p, 1),
            7: lambda p: np.rot90(p, 2).transpose(1, 0, 2),
            8: lambda p: np.rot90(p, -1),
        }
        for orientation, back in cases.items():
            with self.subTest(orientation=orientation):
                source = load_source(self.write(orientation), 1)
                sideways = orientation in (5, 6, 7, 8)
                size = (HEIGHT, WIDTH) if sideways else (WIDTH, HEIGHT)
                self.assertEqual((source.width, source.height), size)
                self.assertEqual((source.full_width, source.full_height), size)
                self.assert_source(back(linear(source)))
        # Orientation 6 is a quarter turn clockwise: the card's top-left
        # patch is at the top right, its bottom-left one at the top left.
        turned = linear(load_source(self.write(6), 1))
        corners = {"grey_02": (0, ROWS - 1), "grey_15": (0, 0)}
        for name, (row, column) in corners.items():
            cell = Patch(name, row, column, BY_NAME[name].rgb)
            np.testing.assert_allclose(
                patch_centre(turned, cell, COLUMNS, ROWS),
                expected_source(BY_NAME[name]),
                atol=0.002,
                err_msg=name,
            )

    def test_local_orientation_on_top_of_the_file_orientation(self) -> None:
        # Orientation 6, then local_orientation 6 (a quarter counter-clockwise).
        source = load_source(self.write(6), 6)
        self.assertEqual((source.width, source.height), (WIDTH, HEIGHT))
        self.assertEqual((source.full_width, source.full_height), (WIDTH, HEIGHT))
        self.assert_source(linear(source))

    def test_a_reduced_source_keeps_the_values(self) -> None:
        # Half the long edge: LibRaw's half-size development, no demosaic.
        source = load_source(self.write(), 1, long_edge=WIDTH // 2)
        self.assertEqual(source.pixels.shape, (HEIGHT // 2, WIDTH // 2, 3))
        self.assertEqual((source.full_width, source.full_height), (WIDTH, HEIGHT))
        self.assert_source(linear(source))
        smaller = load_source(self.write(), 1, long_edge=60)
        self.assertEqual(smaller.pixels.shape, (40, 60, 3))


class LibRawSourceTest(RawSourceTest):
    """The same source through LibRaw, as for a file FlashRaw cannot read."""

    def setUp(self) -> None:
        super().setUp()
        patcher = mock.patch.object(
            source_module,
            "_develop_flashraw",
            side_effect=flashraw.UnsupportedFormatError("not this one"),
        )
        patcher.start()
        self.addCleanup(patcher.stop)


class DecoderChoiceTest(SimpleTestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.directory = directory.name
        self.path = os.path.join(self.directory, "card.dng")
        Path(self.path).write_bytes(dng_bytes())

    def test_flashraw_develops_without_libraw(self) -> None:
        with mock.patch.object(
            source_module, "_develop_libraw", side_effect=AssertionError("LibRaw ran")
        ):
            source = load_source(self.path, 1)
        self.assertEqual(source.pixels.shape, (HEIGHT, WIDTH, 3))

    def test_libraw_takes_over_when_flashraw_fails(self) -> None:
        failing = mock.patch.object(
            source_module,
            "_develop_flashraw",
            side_effect=flashraw.CorruptFileError("truncated"),
        )
        with failing, self.assertLogs(source_module.logger, "INFO") as logs:
            source = load_source(self.path, 1)
        self.assertEqual(source.pixels.shape, (HEIGHT, WIDTH, 3))
        self.assertIn("CorruptFileError", logs.output[0])
        # The path stays out of the log.
        self.assertNotIn("card.dng", logs.output[0])

    def test_a_file_neither_reads_fails_with_libraws_error(self) -> None:
        path = os.path.join(self.directory, "broken.dng")
        Path(path).write_bytes(b"not a raw file at all")
        with self.assertRaises(rawpy.LibRawError):
            load_source(path, 1)

    def test_the_edit_source_of_a_raw_is_loaded_at_its_payload_size(self) -> None:
        # Half the work for most sensors: a 2x2 binned development, no demosaic.
        self.assertEqual(source_file_edge("photo.NEF"), LINEAR16_FILE_EDGE)
        self.assertEqual(source_file_edge("photo.jpg"), SRGB8_FILE_EDGE)


class RawRenderTest(SimpleTestCase):
    @classmethod
    def setUpClass(cls) -> None:
        super().setUpClass()
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "card.dng")
            Path(path).write_bytes(dng_bytes())
            cls.source = load_source(path, 1)

    def rendered(self, settings: dict[str, Any]) -> dict[str, npt.NDArray[np.float64]]:
        pixels = render(self.source, recipe_from_json(settings))
        self.assertEqual(pixels.shape, (HEIGHT, WIDTH, 3))
        return {patch.name: patch_centre(pixels, patch) for patch in PATCHES}

    def assert_developed(self, settings: dict[str, Any], gain: float) -> None:
        values = self.rendered(settings)
        for patch in PATCHES:
            expected = developed(expected_source(patch), gain)
            np.testing.assert_allclose(
                values[patch.name], expected, atol=2, err_msg=patch.name
            )

    def test_default_recipe_folds_the_headroom_into_the_picture(self) -> None:
        self.assert_developed(recipe(), 1.0)
        values = self.rendered(recipe())
        # A mid grey: 0.2 of the clip is 0.28 linear, 145 in sRGB.
        np.testing.assert_allclose(values["grey_20"], [145, 145, 145], atol=2)
        # The roll-off keeps the grey ramp in order up to the clip...
        ramp = ["grey_50", "grey_60", "grey_70"]
        self.assertTrue(
            all(values[a][1] < values[b][1] for a, b in zip(ramp, ramp[1:]))
        )
        # ...and the over-white patch is folded into white with the clipped one.
        self.assertGreaterEqual(values["over_white"].min(), 253)
        self.assertGreaterEqual(values["clipped"].min(), 254)

    def test_exposure_down_brings_back_the_headroom(self) -> None:
        self.assert_developed(recipe(light={"exposure": -1.0}), 0.5)
        values = self.rendered(recipe(light={"exposure": -1.0}))
        # 1.26 linear at half the gain: 0.63, 208 in sRGB; the clip is 218.
        np.testing.assert_allclose(values["over_white"], [208, 208, 208], atol=2)
        self.assertGreater(values["clipped"].min() - values["over_white"].max(), 6)

    def test_highlights_down_recover_the_over_white_patch(self) -> None:
        plain = self.rendered(recipe())
        values = self.rendered(recipe(light={"highlights": -100}))
        # Pulled down well below white, while the clipped patch stays white
        # (``keep`` of stage 4.3) and the dark greys are left alone.
        self.assertLess(values["over_white"].max(), 246)
        self.assertGreater(plain["over_white"].min() - values["over_white"].max(), 8)
        self.assertGreaterEqual(values["clipped"].min(), 254)
        for name in ("grey_02", "grey_05", "grey_10"):
            np.testing.assert_allclose(values[name], plain[name], atol=2, err_msg=name)
        # Still neutral.
        self.assertLess(np.ptp(values["over_white"]), 2)

    def test_white_balance_keeps_neutral_patches_neutral_at_default(self) -> None:
        values = self.rendered(recipe())
        for name in ("grey_05", "grey_20", "grey_50"):
            self.assertLess(np.ptp(values[name]), 1.5, name)
        warm = self.rendered(recipe(wb={"temp": 50}))
        self.assertGreater(warm["grey_20"][0], warm["grey_20"][2] + 20)


class RawEditApiTest(EditedPhotoTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.raw = self.make_photo(self.owner, dng_bytes(), "card.dng")

    def test_save_renders_the_raw_and_serves_its_edit_source(self) -> None:
        settings = recipe(light={"exposure": -1.0})
        response = self.put(
            {
                "settings": settings,
                "history": [
                    {
                        "action": "set",
                        "at": "2026-11-12T09:30:00Z",
                        "settings": settings,
                    }
                ],
                "history_cursor": 0,
            },
            self.raw,
        )
        self.assertEqual(response.status_code, 200, response.content[:500])
        self.assertEqual(response.json()["rendition"], "pending")
        self.run_queued()
        self.raw.refresh_from_db()
        edit = self.client.get(self.url(self.raw)).json()
        self.assertEqual(edit["rendition"], "ready")
        rendition = read_pixels(rendition_path(self.raw.image_hash))
        self.assertEqual(rendition.shape, (HEIGHT, WIDTH, 3))
        over_white = patch_centre(rendition, BY_NAME["over_white"])
        np.testing.assert_allclose(over_white, [208, 208, 208], atol=3)
        # The big thumbnail shows the edit too.
        thumbnail = patch_centre(self.big_thumbnail(self.raw), BY_NAME["over_white"])
        np.testing.assert_allclose(thumbnail, [208, 208, 208], atol=4)

    def test_edit_source_is_a_linear16_file_the_web_editor_reads(self) -> None:
        response = self.client.get(self.url(self.raw) + "source/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "application/octet-stream")
        data = (
            b"".join(response.streaming_content)
            if response.streaming
            else response.content
        )
        # parseEditSourceFile (editSource.ts): magic, version, kind, zero bytes,
        # the header length, a JSON header of these keys with positive numbers.
        self.assertEqual(data[:8], b"LPES\x01\x01\x00\x00")
        length = int.from_bytes(data[8:12], "little")
        header = json.loads(data[12 : 12 + length].decode("utf-8"))
        self.assertEqual(
            header,
            {
                "kind": "linear16",
                "width": WIDTH,
                "height": HEIGHT,
                "full_width": WIDTH,
                "full_height": HEIGHT,
                "max": RAW_BASE_GAIN,
            },
        )
        # linear16Pixels: six planes after inflating, each value the difference
        # to its left neighbour modulo 65536.
        planes = np.frombuffer(zlib.decompress(data[12 + length :]), dtype=np.uint8)
        self.assertEqual(planes.size, 6 * WIDTH * HEIGHT)
        planes = planes.reshape(6, HEIGHT, WIDTH)
        deltas = (planes[0::2].astype(np.uint16) << 8) | planes[1::2]
        codes = np.cumsum(deltas, axis=2, dtype=np.uint16).transpose(1, 2, 0)
        self.assertFalse(np.any(codes & 0xF))
        values = RAW_BASE_GAIN * (codes.astype(np.float64) / 65535) ** 2
        for patch in PATCHES:
            np.testing.assert_allclose(
                patch_centre(values, patch),
                expected_source(patch),
                rtol=0.005,
                # Clearing the low four bits costs up to 2 * 15 / 65535 relative.
                atol=0.004,
                err_msg=patch.name,
            )
