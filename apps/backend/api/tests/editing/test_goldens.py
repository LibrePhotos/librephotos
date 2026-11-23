"""The committed golden values are current, and the float32 renderer meets them."""

import json
import math

import numpy as np
from django.test import SimpleTestCase

from api.editing import goldens
from api.editing.pipeline import PixelPlanes, develop, develop_params
from api.editing.recipe import CONTROLS, recipe_from_json

# The values are rounded to 6 decimals; a different libm may move the last one.
TOLERANCE = 2e-6


def _assert_close(
    test: SimpleTestCase, committed: object, fresh: object, path: str
) -> None:
    if isinstance(fresh, dict):
        test.assertIsInstance(committed, dict, path)
        test.assertEqual(set(committed), set(fresh), path)
        for key in fresh:
            _assert_close(test, committed[key], fresh[key], f"{path}.{key}")
    elif isinstance(fresh, list):
        test.assertIsInstance(committed, list, path)
        test.assertEqual(len(committed), len(fresh), path)
        for index, (a, b) in enumerate(zip(committed, fresh, strict=True)):
            _assert_close(test, a, b, f"{path}[{index}]")
    elif isinstance(fresh, float) and not isinstance(committed, str):
        test.assertTrue(
            math.isclose(committed, fresh, abs_tol=TOLERANCE),
            f"{path}: {committed} != {fresh}",
        )
    else:
        test.assertEqual(committed, fresh, path)


class GoldenFileTest(SimpleTestCase):
    def test_committed_file_is_current(self):
        committed = json.loads(goldens.GOLDEN_PATH.read_text(encoding="utf-8"))
        _assert_close(self, committed, goldens.generate(), "goldens")

    def test_file_is_compact(self):
        self.assertLess(goldens.GOLDEN_PATH.stat().st_size, 150_000)

    def test_cases_cover_every_stage4_control(self):
        committed = json.loads(goldens.GOLDEN_PATH.read_text(encoding="utf-8"))
        touched = set()

        def walk(data: dict, prefix: str) -> None:
            for key, value in data.items():
                path = f"{prefix}.{key}" if prefix else key
                if isinstance(value, dict):
                    walk(value, path)
                else:
                    touched.add(path)

        for case in committed["cases"] + committed["finish_cases"]:
            walk(case["recipe"], "")
        stage4_and_5 = {
            path
            for path in CONTROLS
            if not path.startswith(("geometry.", "detail.", "curve."))
        }
        self.assertEqual(stage4_and_5 - touched, set())
        for channel in ("master", "red", "green", "blue"):
            self.assertIn(f"curve.{channel}", touched)
        self.assertIn("color.treatment", touched)

    def test_float32_renderer_meets_the_goldens(self):
        committed = json.loads(goldens.GOLDEN_PATH.read_text(encoding="utf-8"))
        inputs = {
            entry["source_max"]: entry["pixels"] for entry in committed["pixel_inputs"]
        }
        for case in committed["cases"]:
            recipe = recipe_from_json(case["recipe"])
            for run in case["runs"]:
                pixels = inputs[run["source_max"]]
                rgb = np.array([p["rgb"] for p in pixels], dtype=np.float32).T
                planes = PixelPlanes(
                    lc=np.array([p["lc"] for p in pixels], dtype=np.float32),
                    lf=np.array([p["lf"] for p in pixels], dtype=np.float32),
                    dk=np.array([p["dk"] for p in pixels], dtype=np.float32),
                )
                e = develop(rgb, planes, develop_params(recipe, run["source_max"])).T
                with self.subTest(case=case["name"], source_max=run["source_max"]):
                    np.testing.assert_allclose(e, run["e"], atol=2e-4)
