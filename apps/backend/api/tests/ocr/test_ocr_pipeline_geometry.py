"""Pure-geometry unit tests for the vendored PP-OCRv6 pipeline.

These exercise the numpy/cv2 building blocks with NO ONNX models, so they always
run in CI.  If any of these break, the detection/recognition math is wrong even
if inference "succeeds".
"""

import importlib.util
import json
import os
import sys
import tempfile

import cv2
import numpy as np
from django.test import SimpleTestCase

from service.ocr.ppocr.config import OCRConfig
from service.ocr.ppocr.crop import get_rotate_crop_image
from service.ocr.ppocr.detect import (
    OCRDecodeError,
    compute_resize,
    normalize_image,
    order_points_clockwise,
    polygon_area,
    polygon_perimeter,
    read_image,
    round_up_to_multiple,
    unclip,
    unclip_distance,
)
from service.ocr.ppocr.engine import reading_order_sort, text_area_fraction
from service.ocr.ppocr.recognize import ctc_greedy_decode


class PolygonMathTests(SimpleTestCase):
    def test_shoelace_area_unit_square(self):
        square = [[0, 0], [10, 0], [10, 10], [0, 10]]
        self.assertAlmostEqual(polygon_area(square), 100.0)

    def test_shoelace_area_triangle(self):
        triangle = [[0, 0], [4, 0], [0, 3]]
        self.assertAlmostEqual(polygon_area(triangle), 6.0)

    def test_shoelace_area_is_orientation_independent(self):
        clockwise = [[0, 0], [0, 10], [10, 10], [10, 0]]
        counter = [[0, 0], [10, 0], [10, 10], [0, 10]]
        self.assertAlmostEqual(polygon_area(clockwise), polygon_area(counter))
        self.assertAlmostEqual(polygon_area(clockwise), 100.0)

    def test_perimeter_rectangle(self):
        rect = [[0, 0], [20, 0], [20, 5], [0, 5]]
        self.assertAlmostEqual(polygon_perimeter(rect), 50.0)

    def test_perimeter_triangle(self):
        triangle = [[0, 0], [3, 0], [0, 4]]
        self.assertAlmostEqual(polygon_perimeter(triangle), 12.0)


class UnclipTests(SimpleTestCase):
    def test_unclip_distance_formula(self):
        # 10x10 square: area=100, perimeter=40, ratio=1.4 -> 100*1.4/40 = 3.5
        square = [[0, 0], [10, 0], [10, 10], [0, 10]]
        self.assertAlmostEqual(unclip_distance(square, 1.4), 3.5)

    def test_unclip_distance_zero_perimeter(self):
        degenerate = [[5, 5], [5, 5], [5, 5], [5, 5]]
        self.assertEqual(unclip_distance(degenerate, 1.4), 0.0)

    def test_unclip_expands_polygon(self):
        square = np.array([[0, 0], [10, 0], [10, 10], [0, 10]], dtype=np.float32)
        expanded = unclip(square, 1.4)
        self.assertIsNotNone(expanded)
        # The expanded polygon must strictly enclose the original bounds.
        self.assertLess(expanded[:, 0].min(), 0)
        self.assertLess(expanded[:, 1].min(), 0)
        self.assertGreater(expanded[:, 0].max(), 10)
        self.assertGreater(expanded[:, 1].max(), 10)
        # Expansion is bounded by roughly the offset distance (3.5) plus rounding.
        self.assertGreater(expanded[:, 0].min(), -6)
        self.assertLess(expanded[:, 0].max(), 16)


class OrderPointsTests(SimpleTestCase):
    def _assert_clockwise_tl(self, ordered):
        tl, tr, br, bl = ordered
        # top-left is left of top-right and above bottom-left.
        self.assertLessEqual(tl[0], tr[0])
        self.assertLessEqual(tl[1], bl[1])
        # bottom-right is right of bottom-left and below top-right.
        self.assertGreaterEqual(br[0], bl[0])
        self.assertGreaterEqual(br[1], tr[1])

    def test_axis_aligned(self):
        pts = [[0, 0], [10, 0], [10, 5], [0, 5]]
        ordered = order_points_clockwise(pts)
        np.testing.assert_allclose(ordered[0], [0, 0])
        np.testing.assert_allclose(ordered[2], [10, 5])
        self._assert_clockwise_tl(ordered)

    def test_shuffled_input(self):
        # Same rectangle, points fed in an arbitrary order.
        pts = [[10, 5], [0, 0], [0, 5], [10, 0]]
        ordered = order_points_clockwise(pts)
        np.testing.assert_allclose(ordered[0], [0, 0])
        np.testing.assert_allclose(ordered[1], [10, 0])
        np.testing.assert_allclose(ordered[2], [10, 5])
        np.testing.assert_allclose(ordered[3], [0, 5])

    def test_rotated_diamond(self):
        # 45-degree diamond: corners are top, right, bottom, left.
        pts = [[5, 0], [10, 5], [5, 10], [0, 5]]
        ordered = order_points_clockwise(pts)
        # Four distinct points preserved, ordered clockwise.
        self.assertEqual(len({tuple(p) for p in ordered}), 4)
        self._assert_clockwise_tl(ordered)

    def test_reflected_input(self):
        # Horizontally reflected rectangle still resolves TL correctly.
        pts = [[0, 2], [8, 2], [8, 0], [0, 0]]
        ordered = order_points_clockwise(pts)
        np.testing.assert_allclose(ordered[0], [0, 0])
        np.testing.assert_allclose(ordered[2], [8, 2])
        self._assert_clockwise_tl(ordered)


class ResizeMultipleTests(SimpleTestCase):
    def test_round_up_basic(self):
        self.assertEqual(round_up_to_multiple(1, 32), 32)
        self.assertEqual(round_up_to_multiple(32, 32), 32)
        self.assertEqual(round_up_to_multiple(33, 32), 64)
        self.assertEqual(round_up_to_multiple(64, 32), 64)
        self.assertEqual(round_up_to_multiple(65, 32), 96)

    def test_round_up_min_is_one_multiple(self):
        self.assertEqual(round_up_to_multiple(0, 32), 32)

    def test_compute_resize_no_downscale_small(self):
        # 100x50 fits under max_side 1600; just rounds up to multiples of 32.
        nh, nw = compute_resize(100, 50, 1600, 32)
        self.assertEqual((nh, nw), (128, 64))

    def test_compute_resize_edge_sizes(self):
        self.assertEqual(compute_resize(1, 1, 1600, 32), (32, 32))
        self.assertEqual(compute_resize(32, 32, 1600, 32), (32, 32))
        self.assertEqual(compute_resize(33, 33, 1600, 32), (64, 64))

    def test_compute_resize_downscales_long_side(self):
        # 3200x1600 -> longest side capped to 1600 (ratio 0.5) -> 1600x800.
        nh, nw = compute_resize(1600, 3200, 1600, 32)
        self.assertEqual(nw, 1600)
        self.assertEqual(nh, 800)
        self.assertLessEqual(max(nh, nw), 1600)
        self.assertEqual(nh % 32, 0)
        self.assertEqual(nw % 32, 0)


class RotateCropTests(SimpleTestCase):
    def test_axis_aligned_crop_recovers_content(self):
        # White canvas, a filled dark rectangle; crop the rectangle back out.
        img = np.full((100, 200, 3), 255, dtype=np.uint8)
        cv2.rectangle(img, (50, 30), (150, 70), (10, 10, 10), thickness=-1)
        quad = np.array([[50, 30], [150, 30], [150, 70], [50, 70]], dtype=np.float32)
        crop = get_rotate_crop_image(img, quad)
        self.assertEqual(crop.shape[0], 40)
        self.assertEqual(crop.shape[1], 100)
        # Interior should be the dark fill.
        self.assertLess(int(crop[20, 50].mean()), 60)

    def test_tall_crop_is_rotated_to_horizontal(self):
        img = np.full((200, 100, 3), 255, dtype=np.uint8)
        cv2.rectangle(img, (40, 20), (60, 180), (0, 0, 0), thickness=-1)
        quad = np.array([[40, 20], [60, 20], [60, 180], [40, 180]], dtype=np.float32)
        crop = get_rotate_crop_image(img, quad)
        # h/w = 160/20 = 8 >= 1.5, so it is rotated to be wider than tall.
        self.assertGreater(crop.shape[1], crop.shape[0])

    def test_warp_recovers_rotated_quad_content(self):
        # Draw a filled square, then define a rotated quad around a region and
        # confirm the warp pulls a solid patch out (pixel content assertion).
        img = np.full((120, 120, 3), 255, dtype=np.uint8)
        cv2.rectangle(img, (30, 30), (90, 90), (0, 0, 0), thickness=-1)
        quad = np.array([[35, 35], [85, 35], [85, 85], [35, 85]], dtype=np.float32)
        crop = get_rotate_crop_image(img, quad)
        self.assertLess(int(crop.mean()), 40)  # mostly black


class CTCDecodeTests(SimpleTestCase):
    # decode_charset[0] is the CTC blank; classes 1..N map to real chars.
    CHARSET = ["<blank>", "a", "b", "c"]

    def _one_hot(self, sequence, num_classes):
        probs = np.zeros((len(sequence), num_classes), dtype=np.float32)
        for t, cls in enumerate(sequence):
            probs[t, cls] = 1.0
        return probs

    def test_collapse_duplicates(self):
        # a a a -> "a" (repeated argmax collapses).
        probs = self._one_hot([1, 1, 1], 4)
        text, conf = ctc_greedy_decode(probs, self.CHARSET)
        self.assertEqual(text, "a")
        self.assertAlmostEqual(conf, 1.0)

    def test_blank_separates_repeats(self):
        # a blank a -> "aa" (blank breaks the collapse).
        probs = self._one_hot([1, 0, 1], 4)
        text, _ = ctc_greedy_decode(probs, self.CHARSET)
        self.assertEqual(text, "aa")

    def test_blanks_dropped(self):
        probs = self._one_hot([0, 1, 0, 2, 0, 3, 0], 4)
        text, _ = ctc_greedy_decode(probs, self.CHARSET)
        self.assertEqual(text, "abc")

    def test_mapping_off_by_one_guard(self):
        # Class index 1 MUST map to charset[1] == "a", not "b".  A one-off in the
        # blank/charset alignment would surface here.
        probs = self._one_hot([1, 2, 3], 4)
        text, _ = ctc_greedy_decode(probs, self.CHARSET)
        self.assertEqual(text, "abc")

    def test_confidence_is_mean_of_kept_steps(self):
        probs = np.array(
            [
                [0.1, 0.9, 0.0, 0.0],  # kept: a @ 0.9
                [0.0, 0.0, 0.0, 1.0],  # kept: c @ 1.0
            ],
            dtype=np.float32,
        )
        text, conf = ctc_greedy_decode(probs, self.CHARSET)
        self.assertEqual(text, "ac")
        self.assertAlmostEqual(conf, 0.95)

    def test_all_blank_yields_empty(self):
        probs = self._one_hot([0, 0, 0], 4)
        text, conf = ctc_greedy_decode(probs, self.CHARSET)
        self.assertEqual(text, "")
        self.assertEqual(conf, 0.0)


class ReadingOrderTests(SimpleTestCase):
    def _block(self, x0, y0, x1, y1, tag):
        return {
            "text": tag,
            "box": [[x0, y0], [x1, y0], [x1, y1], [x0, y1]],
            "confidence": 1.0,
        }

    def test_top_to_bottom(self):
        blocks = [
            self._block(0, 100, 50, 120, "second"),
            self._block(0, 0, 50, 20, "first"),
        ]
        ordered = reading_order_sort(blocks)
        self.assertEqual([b["text"] for b in ordered], ["first", "second"])

    def test_left_to_right_within_row(self):
        # Same row (overlapping y), different x -> left first.
        blocks = [
            self._block(200, 0, 260, 20, "right"),
            self._block(0, 2, 60, 22, "left"),
        ]
        ordered = reading_order_sort(blocks)
        self.assertEqual([b["text"] for b in ordered], ["left", "right"])

    def test_row_grouping_then_reading_order(self):
        blocks = [
            self._block(200, 4, 260, 24, "r1c2"),
            self._block(0, 0, 60, 20, "r1c1"),
            self._block(0, 100, 60, 120, "r2c1"),
            self._block(200, 104, 260, 124, "r2c2"),
        ]
        ordered = reading_order_sort(blocks)
        self.assertEqual([b["text"] for b in ordered], ["r1c1", "r1c2", "r2c1", "r2c2"])

    def test_empty(self):
        self.assertEqual(reading_order_sort([]), [])


class TextAreaFractionTests(SimpleTestCase):
    def test_single_box(self):
        # One 100x50 box in a 1000x500 image -> 5000 / 500000 = 0.01.
        box = np.array([[0, 0], [100, 0], [100, 50], [0, 50]])
        self.assertAlmostEqual(text_area_fraction([box], 500, 1000), 0.01)

    def test_multiple_boxes_sum(self):
        box = np.array([[0, 0], [100, 0], [100, 50], [0, 50]])
        self.assertAlmostEqual(text_area_fraction([box, box], 500, 1000), 0.02)

    def test_clamped_to_one(self):
        big = np.array([[0, 0], [2000, 0], [2000, 2000], [0, 2000]])
        self.assertEqual(text_area_fraction([big], 100, 100), 1.0)

    def test_no_boxes(self):
        self.assertEqual(text_area_fraction([], 500, 1000), 0.0)

    def test_zero_image_area(self):
        box = np.array([[0, 0], [10, 0], [10, 10], [0, 10]])
        self.assertEqual(text_area_fraction([box], 0, 0), 0.0)


class _FakeDetConfig:
    """Minimal stand-in for OCRConfig's det.* attributes (no model needed)."""

    det_scale = 1.0 / 255.0
    det_mean = np.array([0.0, 0.0, 0.0], dtype=np.float32)
    det_std = np.array([1.0, 1.0, 1.0], dtype=np.float32)

    def __init__(self, img_mode):
        self.det_img_mode = img_mode


class NormalizeImageChannelModeTests(SimpleTestCase):
    def _pixel(self):
        # A single BGR pixel: B=10, G=20, R=30.
        return np.array([[[10, 20, 30]]], dtype=np.uint8)

    def test_bgr_mode_does_not_swap(self):
        out = normalize_image(self._pixel(), _FakeDetConfig("BGR"))
        # Output is (1, C, H, W); channel 0 stays B=10 with mean0/std1/scale 1/255.
        self.assertAlmostEqual(out[0, 0, 0, 0], 10 / 255.0, places=6)
        self.assertAlmostEqual(out[0, 2, 0, 0], 30 / 255.0, places=6)

    def test_rgb_mode_swaps_channels(self):
        out = normalize_image(self._pixel(), _FakeDetConfig("RGB"))
        # After BGR->RGB swap, channel 0 is R=30 and channel 2 is B=10.
        self.assertAlmostEqual(out[0, 0, 0, 0], 30 / 255.0, places=6)
        self.assertAlmostEqual(out[0, 2, 0, 0], 10 / 255.0, places=6)

    def test_config_exposes_img_mode(self):
        # OCRConfig parses config.json (no ONNX load), so a synthetic bundle dir
        # is enough to prove the field is surfaced.
        tmp = tempfile.mkdtemp(prefix="ocr-cfg-")
        try:
            config_json = {
                "det": {
                    "preprocess": {
                        "mean": [0.0, 0.0, 0.0],
                        "std": [1.0, 1.0, 1.0],
                        "scale": 1.0 / 255.0,
                        "img_mode": "RGB",
                        "max_side": 1600,
                        "size_multiple": 32,
                    },
                    "postprocess": {
                        "thresh": 0.2,
                        "box_thresh": 0.45,
                        "unclip_ratio": 1.4,
                        "max_candidates": 3000,
                    },
                },
                "rec": {"input_shape": [3, 48, 320]},
                "use_space_char": False,
            }
            with open(os.path.join(tmp, "config.json"), "w", encoding="utf-8") as f:
                json.dump(config_json, f)
            with open(os.path.join(tmp, "charset.txt"), "w", encoding="utf-8") as f:
                f.write("a\nb\nc\n")

            cfg = OCRConfig(tmp)
            self.assertEqual(cfg.det_img_mode, "RGB")
        finally:
            import shutil

            shutil.rmtree(tmp, ignore_errors=True)


class ReadImageInputTests(SimpleTestCase):
    def test_missing_file_raises_decode_error(self):
        with self.assertRaises(OCRDecodeError):
            read_image(os.path.join(tempfile.gettempdir(), "definitely-not-here.png"))


def _load_ocr_main_module():
    """Import the sidecar's main.py in its script context (ppocr on sys.path).

    main.py uses ``from ppocr...`` imports (mirroring service/tags/main.py), so
    service/ocr must be on sys.path.  Importing it neither starts the server nor
    loads any model.
    """
    service_ocr = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "..", "..", "service", "ocr")
    )
    if service_ocr not in sys.path:
        sys.path.insert(0, service_ocr)
    spec = importlib.util.spec_from_file_location(
        "ocr_sidecar_main", os.path.join(service_ocr, "main.py")
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class MainRequestValidationTests(SimpleTestCase):
    """Endpoint input validation - runs without models (400 fires pre-load)."""

    def test_nonexistent_image_path_returns_400(self):
        main = _load_ocr_main_module()
        client = main.app.test_client()
        response = client.post(
            "/ocr",
            json={"image_path": os.path.join(tempfile.gettempdir(), "nope-xyz.png")},
        )
        self.assertEqual(response.status_code, 400)
        # The engine must NOT have been created just to reject bad input.
        self.assertIsNone(main.ocr_engine)

    def test_missing_image_path_returns_400(self):
        main = _load_ocr_main_module()
        client = main.app.test_client()
        response = client.post("/ocr", json={})
        self.assertEqual(response.status_code, 400)
