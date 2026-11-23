"""The lookup tables and white balance values of the develop stage."""

import numpy as np
from django.test import SimpleTestCase

from api.editing import tables
from api.editing.recipe import Curve, Light, recipe_from_json

X = np.linspace(0.0, 1.0, 2001)


class LightTableTest(SimpleTestCase):
    def test_default_is_identity(self):
        table = tables.light_table(Light())
        np.testing.assert_allclose(table, tables.table_positions(), atol=1e-12)

    def test_endpoints_and_monotone(self):
        for light in (
            Light(contrast=100),
            Light(contrast=-100),
            Light(whites=100, blacks=-100),
            Light(whites=-100, blacks=100, contrast=40),
        ):
            with self.subTest(light=light):
                table = tables.light_table(light)
                self.assertEqual(table.shape, (1024,))
                self.assertTrue(np.all(np.diff(table) >= -1e-12))
                self.assertGreaterEqual(table.min(), 0.0)
                self.assertLessEqual(table.max(), 1.0)
        contrast = tables.light_table(Light(contrast=50))
        self.assertAlmostEqual(contrast[0], 0.0)
        self.assertAlmostEqual(contrast[-1], 1.0)
        self.assertLess(contrast[256], 256 / 1023)
        self.assertGreater(contrast[768], 768 / 1023)

    def test_blacks_lift_the_shadows(self):
        table = tables.light_table(Light(blacks=100))
        self.assertAlmostEqual(table[0], 0.15)
        self.assertAlmostEqual(table[-1], 1.0)


class MonotoneCurveTest(SimpleTestCase):
    def test_two_points_are_a_line(self):
        y = tables.monotone_curve(((0.2, 0.1), (0.8, 0.7)), X)
        inside = (X >= 0.2) & (X <= 0.8)
        np.testing.assert_allclose(y[inside], X[inside] - 0.1, atol=1e-12)
        self.assertTrue(np.all(y[X < 0.2] == 0.1))
        self.assertTrue(np.all(y[X > 0.8] == 0.7))

    def test_three_points_pass_through_them_and_stay_monotone(self):
        points = ((0.0, 0.0), (0.3, 0.6), (1.0, 1.0))
        y = tables.monotone_curve(points, np.array([p[0] for p in points]))
        np.testing.assert_allclose(y, [0.0, 0.6, 1.0], atol=1e-12)
        self.assertTrue(np.all(np.diff(tables.monotone_curve(points, X)) >= -1e-12))

    def test_many_points_stay_monotone(self):
        rng = np.random.default_rng(3)
        xs = np.sort(rng.choice(np.arange(1, 99), 14, replace=False)) / 100
        ys = np.sort(rng.random(14))
        points = ((0.0, 0.0), *zip(xs, ys, strict=True), (1.0, 1.0))
        self.assertEqual(len(points), 16)
        y = tables.monotone_curve(points, X)
        self.assertTrue(np.all(np.diff(y) >= -1e-12))
        np.testing.assert_allclose(
            tables.monotone_curve(points, np.array([p[0] for p in points])),
            [p[1] for p in points],
            atol=1e-12,
        )

    def test_not_monotone_points_do_not_overshoot(self):
        points = ((0.0, 0.1), (0.3, 0.7), (0.5, 0.2), (0.8, 0.9), (1.0, 0.4))
        for (x0, y0), (x1, y1) in zip(points, points[1:], strict=False):
            segment = X[(X >= x0) & (X <= x1)]
            y = tables.monotone_curve(points, segment)
            with self.subTest(segment=(x0, x1)):
                self.assertGreaterEqual(y.min(), min(y0, y1) - 1e-12)
                self.assertLessEqual(y.max(), max(y0, y1) + 1e-12)
                steps = np.diff(y)
                self.assertTrue(np.all(steps >= -1e-12) or np.all(steps <= 1e-12))

    def test_flat_segment_stays_flat(self):
        points = ((0.0, 0.0), (0.4, 0.5), (0.6, 0.5), (1.0, 1.0))
        segment = X[(X >= 0.4) & (X <= 0.6)]
        np.testing.assert_allclose(
            tables.monotone_curve(points, segment), 0.5, atol=1e-12
        )


class CurveTableTest(SimpleTestCase):
    def test_default_is_identity(self):
        table = tables.curve_table(Curve())
        self.assertEqual(table.shape, (1024, 3))
        for channel in range(3):
            np.testing.assert_allclose(
                table[:, channel], tables.table_positions(), atol=1e-12
            )

    def test_channel_applies_after_master(self):
        master = ((0.0, 0.0), (0.5, 0.7), (1.0, 1.0))
        red = ((0.0, 0.2), (1.0, 1.0))
        table = tables.curve_table(Curve(master=master, red=red))
        x = tables.table_positions()
        m = tables.monotone_curve(master, x)
        np.testing.assert_allclose(table[:, 0], tables.monotone_curve(red, m))
        np.testing.assert_allclose(table[:, 1], m)
        self.assertGreaterEqual(table.min(), 0.0)
        self.assertLessEqual(table.max(), 1.0)


class HueTableTest(SimpleTestCase):
    def test_default_is_zero(self):
        table = tables.hue_table(recipe_from_json({}))
        self.assertEqual(table.shape, (360, 4))
        self.assertFalse(table.any())

    def test_bands_and_the_hues_between_them(self):
        recipe = recipe_from_json(
            {
                "mixer": {"red": {"hue": 100, "sat": -50}, "magenta": {"lum": 100}},
                "bw_mix": {"orange": 40},
            }
        )
        table = tables.hue_table(recipe)
        np.testing.assert_allclose(table[29], [30.0, -0.5, 0.0, 0.0])
        np.testing.assert_allclose(table[330], [0.0, 0.0, 1.0, 0.0])
        np.testing.assert_allclose(table[55], [0.0, 0.0, 0.0, 0.4])
        # Between magenta (330) and red (29 + 360): 0 degrees is 30 of 59 along.
        t = 30 / 59
        np.testing.assert_allclose(table[0], [30 * t, -0.5 * t, 1 - t, 0.0])
        # Between red and orange (26 degrees apart).
        t = (42 - 29) / 26
        np.testing.assert_allclose(
            table[42], [30 * (1 - t), -0.5 * (1 - t), 0.0, 0.4 * t]
        )


class WhiteBalanceTest(SimpleTestCase):
    def test_default(self):
        wb = tables.white_balance(recipe_from_json({}), 1.4)
        np.testing.assert_allclose(wb.k, (1.0, 1.0, 1.0))
        self.assertEqual(wb.gain, 1.0)
        self.assertAlmostEqual(wb.ceiling, 1.4)
        self.assertEqual(tables.white_balance(recipe_from_json({}), 1.0).ceiling, 1.0)

    def test_warm_keeps_luminance(self):
        wb = tables.white_balance(
            recipe_from_json({"wb": {"temp": 50}, "light": {"exposure": -1}}), 1.0
        )
        self.assertGreater(wb.k[0], wb.k[2])
        self.assertAlmostEqual(float(np.dot(wb.k, tables.LUMA)), 1.0)
        self.assertEqual(wb.gain, 0.5)
        self.assertAlmostEqual(wb.ceiling, max(1.0, max(wb.k) * 0.5))
