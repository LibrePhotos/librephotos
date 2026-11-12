"""The renderer: each stage moves pixels the right way, strips and sizes agree."""

import cv2
import numpy as np
from django.test import SimpleTestCase

from api.editing import pipeline
from api.editing.geometry import output_size
from api.editing.pipeline import render
from api.editing.recipe import Grain, recipe_from_json
from api.editing.source import Source


def _source(pixels: np.ndarray) -> Source:
    return Source(pixels, "srgb8", 1.0, pixels.shape[1], pixels.shape[0])


def _flat(value: int, width: int = 120, height: int = 80) -> Source:
    return _source(np.full((height, width, 3), value, dtype=np.uint8))


def _photo_like(width: int = 240, height: int = 160, seed: int = 0) -> Source:
    """Smooth colour fields with an edge and a little noise."""
    rng = np.random.default_rng(seed)
    base = rng.integers(20, 235, (6, 9, 3)).astype(np.uint8)
    pixels = cv2.resize(base, (width, height), interpolation=cv2.INTER_CUBIC)
    pixels[:, width // 2 :] //= 3
    noise = rng.integers(-6, 7, pixels.shape)
    return _source(np.clip(pixels.astype(int) + noise, 0, 255).astype(np.uint8))


def _render(source: Source, data: dict, **kwargs: object) -> np.ndarray:
    return render(source, recipe_from_json(data), **kwargs).astype(np.float64)


EVERY_STAGE = {
    "geometry": {"straighten": 4, "orientation": 90},
    "wb": {"temp": 20, "tint": -10},
    "light": {
        "exposure": 0.4,
        "contrast": 20,
        "highlights": -40,
        "shadows": 35,
        "whites": 10,
        "blacks": -10,
    },
    "curve": {"master": [[0, 0], [0.4, 0.45], [1, 1]], "blue": [[0, 0.05], [1, 1]]},
    "color": {"vibrance": 25, "saturation": 10},
    "mixer": {"red": {"hue": 20, "sat": 10, "lum": -10}},
    "grading": {"shadows": {"hue": 220, "sat": 30}, "global": {"lum": 10}},
    "effects": {"texture": 30, "clarity": 40, "dehaze": 25},
    "vignette": {"amount": -30, "roundness": 20},
    "grain": {"amount": 25, "seed": 9},
    "detail": {"sharpen_amount": 60, "nr_luminance": 30, "nr_color": 40},
}


class IdentityTest(SimpleTestCase):
    def test_default_recipe_returns_the_source(self):
        rng = np.random.default_rng(1)
        pixels = rng.integers(0, 256, (37, 53, 3), dtype=np.uint8)
        out = render(_source(pixels), recipe_from_json({}))
        self.assertEqual(out.dtype, np.uint8)
        self.assertLessEqual(np.abs(out.astype(int) - pixels).max(), 1)

    def test_linear16_rolls_off_its_headroom(self):
        # u encodes v = max (u / 65535)^2; a quarter of max is 0.35, below the knee.
        values = np.array([0, 32768, 65535], dtype=np.uint16)
        pixels = np.repeat(np.tile(values, (4, 1))[:, :, None], 3, axis=2)
        source = Source(pixels, "linear16", 1.4, 3, 4)
        out = render(source, recipe_from_json({}))[0, :, 0]
        expected_mid = pipeline.oetf(np.array([1.4 * (32768 / 65535) ** 2]))[0]
        self.assertEqual(out[0], 0)
        self.assertAlmostEqual(out[1] / 255, expected_mid, delta=1 / 255)
        self.assertEqual(out[2], 255)


class StageDirectionTest(SimpleTestCase):
    def test_exposure_brightens(self):
        source = _photo_like()
        self.assertGreater(
            _render(source, {"light": {"exposure": 1}}).mean(),
            _render(source, {}).mean() + 10,
        )

    def test_temperature_warms(self):
        out = _render(_flat(128), {"wb": {"temp": 60}})
        self.assertGreater(out[..., 0].mean(), out[..., 2].mean() + 10)

    def test_black_and_white_is_neutral(self):
        out = _render(
            _photo_like(), {"color": {"treatment": "bw"}, "bw_mix": {"red": 50}}
        )
        self.assertLessEqual(np.abs(out[..., 0] - out[..., 1]).max(), 1)
        self.assertLessEqual(np.abs(out[..., 1] - out[..., 2]).max(), 1)

    def test_vignette_darkens_corners(self):
        out = _render(_flat(160), {"vignette": {"amount": -80}})
        self.assertLess(out[0, 0].mean(), out[40, 60].mean() - 20)
        self.assertAlmostEqual(out[40, 60].mean(), 160, delta=1)

    def test_grain_is_deterministic_for_a_seed(self):
        source = _flat(128)
        first = _render(source, {"grain": {"amount": 60, "seed": 1}})
        again = _render(source, {"grain": {"amount": 60, "seed": 1}})
        other = _render(source, {"grain": {"amount": 60, "seed": 2}})
        np.testing.assert_array_equal(first, again)
        self.assertGreater(first.std(), 1)
        self.assertGreater(np.abs(first - other).mean(), 1)

    def test_grain_grid_matches_points(self):
        settings = Grain(amount=50, size=10, roughness=70, seed=77)
        columns = (np.arange(40) + 0.5) / 40
        rows = (np.arange(10, 20) + 0.5) / 30
        grid = pipeline._grain_noise_grid(columns, rows, 40, 30, settings)
        u, v = np.meshgrid(columns, rows)
        points = pipeline.grain_noise(u, v, 40, 30, settings)
        np.testing.assert_array_equal(grid, points)

    def test_sharpening_raises_contrast_at_an_edge(self):
        # Spatial amounts are relative to the long edge: 2560 pixels is u = 1.
        pixels = np.full((40, 2560, 3), 60, dtype=np.uint8)
        pixels[:, 1280:] = 180
        source = _source(pixels)
        plain = _render(source, {})
        sharp = _render(source, {"detail": {"sharpen_amount": 150}})
        self.assertLess(sharp[20, 1279, 0], plain[20, 1279, 0] - 5)
        self.assertGreater(sharp[20, 1280, 0], plain[20, 1280, 0] + 5)
        self.assertAlmostEqual(sharp[20, 100, 0], plain[20, 100, 0], delta=1)

    def test_noise_reduction_smooths_flat_areas_and_keeps_edges(self):
        rng = np.random.default_rng(5)
        pixels = np.full((60, 2560, 3), 70.0)
        pixels[:, 1280:] = 190
        pixels += rng.normal(0, 8, pixels.shape)
        source = _source(np.clip(pixels, 0, 255).astype(np.uint8))
        plain = _render(source, {})
        smooth = _render(source, {"detail": {"nr_luminance": 100, "nr_color": 100}})
        flat = (slice(10, 50), slice(100, 1200))
        self.assertLess(smooth[flat].std(), 0.7 * plain[flat].std())
        step_before = plain[:, 1282:1286].mean() - plain[:, 1274:1278].mean()
        step_after = smooth[:, 1282:1286].mean() - smooth[:, 1274:1278].mean()
        self.assertGreater(step_after, 0.95 * step_before)

    def test_local_stages_change_the_picture(self):
        source = _photo_like()
        plain = _render(source, {})
        for data in (
            {"light": {"shadows": 80}},
            {"light": {"highlights": -80}},
            {"effects": {"clarity": 80}},
            {"effects": {"texture": 80}},
            {"effects": {"dehaze": 80}},
            {"effects": {"dehaze": -80}},
        ):
            with self.subTest(data):
                self.assertGreater(np.abs(_render(source, data) - plain).mean(), 0.5)

    def test_dehaze_deepens_shadows(self):
        source = _flat(140)
        self.assertLess(
            _render(source, {"effects": {"dehaze": 100}}).mean(),
            _render(source, {}).mean() - 5,
        )


class StripAndSizeTest(SimpleTestCase):
    def test_strip_heights_give_the_same_picture(self):
        source = _photo_like(97, 61)
        whole = render(source, recipe_from_json(EVERY_STAGE), strip_height=10_000)
        for strip in (1, 3, 16):
            with self.subTest(strip=strip):
                np.testing.assert_array_equal(
                    render(source, recipe_from_json(EVERY_STAGE), strip_height=strip),
                    whole,
                )

    def test_reduced_render_looks_like_the_full_one(self):
        source = _photo_like(1200, 800, seed=4)
        data = {key: value for key, value in EVERY_STAGE.items() if key != "grain"}
        full = render(source, recipe_from_json(data))
        small = render(source, recipe_from_json(data), long_edge=300)
        self.assertEqual(max(small.shape[:2]), 300)
        reduced = cv2.resize(full, small.shape[1::-1], interpolation=cv2.INTER_AREA)
        difference = np.abs(reduced.astype(float) - small.astype(float))
        self.assertLess(difference.mean(), 3)

    def test_every_stage_at_once(self):
        recipe = recipe_from_json(EVERY_STAGE)
        out = render(_photo_like(), recipe)
        width, height = output_size(recipe.geometry, 240, 160)
        self.assertEqual(out.shape, (height, width, 3))
        self.assertGreater(out.std(), 5)
