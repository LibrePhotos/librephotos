"""Stage 1 frame math, and the render's geometry on a tiny asymmetric picture."""

import itertools

import numpy as np
from django.test import SimpleTestCase

from api.editing.geometry import (
    Box,
    Frame,
    box_to_output,
    box_to_source,
    default_crop_scale,
    make_frame,
    mirror_geometry,
    output_size,
    round_half_up,
    turn_geometry,
)
from api.editing.pipeline import render
from api.editing.recipe import Crop, Geometry, Recipe
from api.editing.source import Source

# 3 wide, 2 high, every pixel different.
PIXELS = np.array(
    [
        [[10, 20, 30], [40, 50, 60], [70, 80, 90]],
        [[100, 110, 120], [130, 140, 150], [160, 170, 180]],
    ],
    dtype=np.uint8,
)


def _expected(orientation: int, flip_h: bool, flip_v: bool) -> np.ndarray:
    """The picture turned clockwise, then mirrored, worked out with numpy."""
    out = np.rot90(PIXELS, k=-(orientation // 90))
    if flip_h:
        out = out[:, ::-1]
    if flip_v:
        out = out[::-1]
    return out


class OrientationTest(SimpleTestCase):
    def test_every_orientation_and_flip(self):
        source = Source(PIXELS, "srgb8", 1.0, 3, 2)
        for orientation, flip_h, flip_v in itertools.product(
            (0, 90, 180, 270), (False, True), (False, True)
        ):
            geometry = Geometry(orientation=orientation, flip_h=flip_h, flip_v=flip_v)
            with self.subTest(orientation=orientation, flip_h=flip_h, flip_v=flip_v):
                expected = _expected(orientation, flip_h, flip_v)
                frame = make_frame(geometry, 3, 2)
                self.assertEqual((frame.height, frame.width), expected.shape[:2])
                for j, i in itertools.product(range(frame.height), range(frame.width)):
                    xs, ys = frame.to_source(i + 0.5, j + 0.5)
                    np.testing.assert_array_equal(
                        PIXELS[int(ys), int(xs)], expected[j, i]
                    )
                rendered = render(source, Recipe(geometry=geometry))
                np.testing.assert_array_equal(rendered, expected)

    def test_quarter_turn_by_hand(self):
        # A quarter turn clockwise puts the bottom-left pixel at the top left.
        frame = make_frame(Geometry(orientation=90), 3, 2)
        self.assertEqual(frame.to_source(0.5, 0.5), (0.5, 1.5))
        self.assertEqual(frame.to_source(1.5, 2.5), (2.5, 0.5))


class FrameTest(SimpleTestCase):
    def test_crop_size_and_centre(self):
        geometry = Geometry(crop=Crop(cx=0.25, cy=0.5, w=0.5, h=0.5))
        self.assertEqual(output_size(geometry, 400, 300), (200, 150))
        frame = make_frame(geometry, 400, 300)
        self.assertEqual(frame.to_source(100, 75), (100.0, 150.0))
        self.assertEqual(frame.to_source_normalised(0, 0), (0.0, 0.25))

    def test_long_edge_scales_both_sides(self):
        self.assertEqual(
            output_size(Geometry(), 4000, 3000, long_edge=1000), (1000, 750)
        )
        self.assertEqual(output_size(Geometry(), 400, 300, long_edge=1000), (400, 300))
        full = make_frame(Geometry(straighten=7), 4000, 3000)
        small = make_frame(Geometry(straighten=7), 4000, 3000, long_edge=500)
        for uv in ((0.0, 0.0), (0.3, 0.8), (1.0, 1.0)):
            np.testing.assert_allclose(
                full.to_source_normalised(*uv), small.to_source_normalised(*uv)
            )

    def test_round_half_up(self):
        self.assertEqual(round_half_up(2.5), 3)
        self.assertEqual(round_half_up(3.5), 4)
        self.assertEqual(round_half_up(0.49), 0)

    def test_straighten_default_crop_stays_inside(self):
        for width, height in ((400, 300), (300, 400), (500, 500), (1000, 100)):
            for angle in (-45, -20, -3, 1, 12, 45):
                frame = make_frame(Geometry(straighten=angle), width, height)
                s = default_crop_scale(width, height, angle)
                self.assertLess(s, 1)
                with self.subTest(size=(width, height), angle=angle):
                    for u, v in itertools.product((0.0, 1.0), (0.0, 1.0)):
                        x, y = frame.to_source_normalised(u, v)
                        self.assertGreaterEqual(x, -1e-9)
                        self.assertLessEqual(x, 1 + 1e-9)
                        self.assertGreaterEqual(y, -1e-9)
                        self.assertLessEqual(y, 1 + 1e-9)
                    # At least one corner touches the edge: it is the largest.
                    corners = [
                        frame.to_source_normalised(u, v)
                        for u, v in itertools.product((0.0, 1.0), (0.0, 1.0))
                    ]
                    margin = min(min(x, 1 - x, y, 1 - y) for x, y in corners)
                    self.assertAlmostEqual(margin, 0.0, places=6)

    def test_forward_and_inverse_are_inverses(self):
        geometry = Geometry(
            orientation=270,
            flip_h=True,
            straighten=-11,
            crop=Crop(cx=0.45, cy=0.55, w=0.6, h=0.4),
        )
        frame = make_frame(geometry, 640, 480, long_edge=300)
        for point in ((0.0, 0.0), (12.5, 99.0), (frame.width, frame.height)):
            np.testing.assert_allclose(
                frame.to_output(*frame.to_source(*point)), point, atol=1e-9
            )
        for st in ((0.1, 0.2), (0.5, 0.5), (0.9, 0.3)):
            np.testing.assert_allclose(
                frame.to_source_normalised(*frame.to_output_normalised(*st)),
                st,
                atol=1e-12,
            )


def _gradient(width: int, height: int) -> np.ndarray:
    """A picture without symmetry: red across, green down, blue a diagonal ramp."""
    x = np.linspace(0, 255, width)[None, :].repeat(height, 0)
    y = np.linspace(0, 255, height)[:, None].repeat(width, 1)
    return np.stack([x, y, (x + 2 * y) / 3], axis=-1).round().astype(np.uint8)


GEOMETRIES = (
    Geometry(),
    Geometry(crop=Crop(cx=0.4, cy=0.55, w=0.5, h=0.6)),
    Geometry(orientation=90, flip_h=True, crop=Crop(cx=0.6, cy=0.4, w=0.7, h=0.5)),
    Geometry(orientation=180, flip_v=True, straighten=7.5),
    Geometry(orientation=270, straighten=-12, crop=Crop(cx=0.5, cy=0.5, w=0.6, h=0.6)),
)


class TurnGeometryTest(SimpleTestCase):
    """A turn or a flip of the edited picture, folded into its recipe."""

    def setUp(self):
        self.source = Source(_gradient(48, 32), "srgb8", 1.0, 48, 32)

    def assert_close(self, a: np.ndarray, b: np.ndarray) -> None:
        self.assertEqual(a.shape, b.shape)
        self.assertLessEqual(int(np.abs(a.astype(int) - b.astype(int)).max()), 1)

    def test_a_quarter_turn_turns_the_render(self):
        for geometry in GEOMETRIES:
            with self.subTest(geometry=geometry):
                before = render(self.source, Recipe(geometry=geometry))
                after = render(self.source, Recipe(geometry=turn_geometry(geometry)))
                self.assert_close(after, np.rot90(before, k=-1))

    def test_a_flip_flips_the_render(self):
        for geometry in GEOMETRIES:
            with self.subTest(geometry=geometry):
                before = render(self.source, Recipe(geometry=geometry))
                after = render(self.source, Recipe(geometry=mirror_geometry(geometry)))
                self.assert_close(after, before[:, ::-1])

    def test_four_turns_and_two_flips_change_nothing(self):
        for geometry in GEOMETRIES:
            turned = geometry
            for _ in range(4):
                turned = turn_geometry(turned)
            self.assertEqual(turned, geometry)
            self.assertEqual(mirror_geometry(mirror_geometry(geometry)), geometry)

    def test_the_aspect_lock_turns_with_the_picture(self):
        locked = Geometry(aspect="4:5")
        self.assertEqual(turn_geometry(locked).aspect, "5:4")
        self.assertEqual(turn_geometry(Geometry(aspect="original")).aspect, "original")
        self.assertEqual(mirror_geometry(locked).aspect, "4:5")


def move_box(before: Frame, after: Frame, box: Box) -> Box:
    """A box on ``before``'s picture onto ``after``'s, through the source."""
    return box_to_output(after, box_to_source(before, box))


class MoveBoxTest(SimpleTestCase):
    def test_a_crop_by_hand(self):
        before = make_frame(Geometry(), 120, 80)
        after = make_frame(Geometry(crop=Crop(cx=0.5, cy=0.5, w=0.5, h=0.5)), 120, 80)
        # x 30 to 60, y 20 to 40 of 120 x 80; the crop starts at (30, 20), 60 x 40.
        box = move_box(before, after, (0.25, 0.25, 0.5, 0.5))
        np.testing.assert_allclose(box, (0, 0, 0.5, 0.5), atol=1e-12)
        back = move_box(after, before, box)
        np.testing.assert_allclose(back, (0.25, 0.25, 0.5, 0.5), atol=1e-12)

    def test_a_quarter_turn_by_hand(self):
        before = make_frame(Geometry(), 120, 80)
        after = make_frame(Geometry(orientation=90), 120, 80)
        # Clockwise, (u, v) goes to (1 - v, u).
        box = move_box(before, after, (0.1, 0.2, 0.3, 0.6))
        np.testing.assert_allclose(box, (0.4, 0.1, 0.8, 0.3), atol=1e-12)

    def test_outside_the_crop_is_clamped_to_an_empty_box(self):
        before = make_frame(Geometry(), 120, 80)
        after = make_frame(Geometry(crop=Crop(cx=0.75, cy=0.5, w=0.5, h=1)), 120, 80)
        left, top, right, bottom = move_box(before, after, (0.0, 0.2, 0.25, 0.4))
        self.assertEqual((left, right), (0.0, 0.0))
        self.assertAlmostEqual(top, 0.2)
        self.assertAlmostEqual(bottom, 0.4)

    def test_back_to_the_source_is_not_clamped(self):
        crop = make_frame(Geometry(crop=Crop(cx=0.5, cy=0.5, w=0.5, h=0.5)), 120, 80)
        # The whole crop and a quarter of it again to its left, off the crop.
        box = box_to_source(crop, (-0.25, 0.0, 1.0, 1.0))
        np.testing.assert_allclose(box, (0.125, 0.25, 0.75, 0.75), atol=1e-12)
