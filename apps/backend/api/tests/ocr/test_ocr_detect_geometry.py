"""Characterization tests for service/ocr/ppocr/detect.py (CRAP unit 48).

Targets:
  * ``to_bgr_3channel`` - dtype coercion + channel coercion matrix.
  * ``boxes_from_bitmap`` - DBPostProcess filtering / rescaling behaviour.

These pin CURRENT behaviour before refactoring.  No ONNX model, no network and
no file IO beyond numpy arrays built in-process.
"""

import numpy as np
from django.test import SimpleTestCase

from service.ocr.ppocr.detect import (
    MIN_BOX_SIDE,
    OCRDecodeError,
    boxes_from_bitmap,
    to_bgr_3channel,
)


class ToBgr3ChannelDtypeTests(SimpleTestCase):
    """dtype coercion branch of to_bgr_3channel."""

    def test_uint8_gray_is_expanded_to_bgr_unchanged(self):
        img = np.array([[0, 128, 255]], dtype=np.uint8)
        out = to_bgr_3channel(img)
        self.assertEqual(out.dtype, np.uint8)
        self.assertEqual(out.shape, (1, 3, 3))
        # GRAY2BGR replicates the value into all three channels.
        np.testing.assert_array_equal(out[0, 1], [128, 128, 128])

    def test_uint16_is_scaled_by_257(self):
        img = np.array([[0, 257, 65535]], dtype=np.uint16)
        out = to_bgr_3channel(img)
        self.assertEqual(out.dtype, np.uint8)
        np.testing.assert_array_equal(out[0, :, 0], [0, 1, 255])

    def test_uint16_truncates_rather_than_rounds(self):
        # 256 / 257 == 0.996..., truncated to 0 by the astype(uint8) cast.
        img = np.array([[256, 513]], dtype=np.uint16)
        out = to_bgr_3channel(img)
        np.testing.assert_array_equal(out[0, :, 0], [0, 1])

    def test_float_is_clipped_to_0_255(self):
        img = np.array([[-5.0, 12.7, 300.0]], dtype=np.float32)
        out = to_bgr_3channel(img)
        self.assertEqual(out.dtype, np.uint8)
        # np.clip then truncating cast: 12.7 -> 12.
        np.testing.assert_array_equal(out[0, :, 0], [0, 12, 255])

    def test_int32_is_clipped_to_0_255(self):
        img = np.array([[-1000, 7, 99999]], dtype=np.int32)
        out = to_bgr_3channel(img)
        self.assertEqual(out.dtype, np.uint8)
        np.testing.assert_array_equal(out[0, :, 0], [0, 7, 255])

    def test_uint16_three_channel_keeps_channel_order(self):
        img = np.array([[[257, 514, 771]]], dtype=np.uint16)
        out = to_bgr_3channel(img)
        self.assertEqual(out.dtype, np.uint8)
        np.testing.assert_array_equal(out[0, 0], [1, 2, 3])


class ToBgr3ChannelShapeTests(SimpleTestCase):
    """Channel-count branches of to_bgr_3channel."""

    def test_2d_gray_becomes_3_channel(self):
        out = to_bgr_3channel(np.zeros((4, 5), dtype=np.uint8))
        self.assertEqual(out.shape, (4, 5, 3))

    def test_single_channel_3d_becomes_3_channel(self):
        img = np.full((2, 2, 1), 9, dtype=np.uint8)
        out = to_bgr_3channel(img)
        self.assertEqual(out.shape, (2, 2, 3))
        np.testing.assert_array_equal(out[0, 0], [9, 9, 9])

    def test_bgra_drops_alpha_via_cvtcolor(self):
        img = np.array([[[10, 20, 30, 128]]], dtype=np.uint8)
        out = to_bgr_3channel(img)
        self.assertEqual(out.shape, (1, 1, 3))
        # BGRA2BGR simply drops alpha; it does NOT premultiply.
        np.testing.assert_array_equal(out[0, 0], [10, 20, 30])

    def test_three_channel_uint8_is_returned_as_the_same_object(self):
        img = np.zeros((2, 2, 3), dtype=np.uint8)
        out = to_bgr_3channel(img)
        # Current behaviour: no copy is made for the already-correct case.
        self.assertIs(out, img)

    def test_five_channel_is_truncated_to_first_three(self):
        img = np.arange(5, dtype=np.uint8).reshape(1, 1, 5)
        out = to_bgr_3channel(img)
        self.assertEqual(out.shape, (1, 1, 3))
        np.testing.assert_array_equal(out[0, 0], [0, 1, 2])
        self.assertTrue(out.flags["C_CONTIGUOUS"])

    def test_two_channel_stays_two_channel(self):
        """Known wart: a 2-channel array falls through the slice branch and
        comes back with 2 channels, not 3.  Pinned as-is."""
        img = np.zeros((3, 3, 2), dtype=np.uint8)
        out = to_bgr_3channel(img)
        self.assertEqual(out.shape, (3, 3, 2))

    def test_1d_array_raises_decode_error(self):
        with self.assertRaises(OCRDecodeError) as ctx:
            to_bgr_3channel(np.zeros((4,), dtype=np.uint8))
        self.assertIn("unsupported image shape", str(ctx.exception))

    def test_4d_array_raises_decode_error(self):
        with self.assertRaises(OCRDecodeError):
            to_bgr_3channel(np.zeros((1, 2, 2, 3), dtype=np.uint8))

    def test_decode_error_is_a_value_error(self):
        self.assertTrue(issubclass(OCRDecodeError, ValueError))


class _FakePostConfig:
    """Minimal stand-in for OCRConfig's detection postprocess fields."""

    def __init__(
        self,
        thresh=0.3,
        box_thresh=0.5,
        unclip_ratio=1.5,
        max_candidates=1000,
    ):
        self.det_thresh = thresh
        self.det_box_thresh = box_thresh
        self.det_unclip_ratio = unclip_ratio
        self.det_max_candidates = max_candidates


def _prob_map(shape=(50, 60), blobs=(), value=1.0):
    """Build a float32 probability map with filled rectangular blobs."""
    prob = np.zeros(shape, dtype=np.float32)
    for y0, y1, x0, x1 in blobs:
        prob[y0:y1, x0:x1] = value
    return prob


class BoxesFromBitmapTests(SimpleTestCase):
    def test_empty_map_yields_no_boxes(self):
        boxes = boxes_from_bitmap(_prob_map(), _FakePostConfig(), 60, 50)
        self.assertEqual(boxes, [])

    def test_single_blob_yields_one_box_in_dest_coordinates(self):
        prob = _prob_map(blobs=[(10, 25, 15, 45)])
        boxes = boxes_from_bitmap(prob, _FakePostConfig(), 60, 50)
        self.assertEqual(len(boxes), 1)
        box = boxes[0]
        self.assertEqual(box.shape, (4, 2))
        self.assertEqual(box.dtype, np.int32)
        # Unclip expands the quad outward past the raw 15..44 / 10..24 blob.
        self.assertLess(box[:, 0].min(), 15)
        self.assertGreater(box[:, 0].max(), 44)
        self.assertLess(box[:, 1].min(), 10)
        self.assertGreater(box[:, 1].max(), 24)

    def test_box_is_ordered_clockwise_from_top_left(self):
        prob = _prob_map(blobs=[(10, 25, 15, 45)])
        box = boxes_from_bitmap(prob, _FakePostConfig(), 60, 50)[0]
        xs, ys = box[:, 0], box[:, 1]
        # p0 top-left, p1 top-right, p2 bottom-right, p3 bottom-left.
        self.assertEqual(int(np.argmin(xs + ys)), 0)
        self.assertGreater(xs[1], xs[0])
        self.assertGreater(ys[2], ys[1])
        self.assertLess(xs[3], xs[2])

    def test_coordinates_are_clipped_to_dest_bounds(self):
        # A blob touching the map edge unclips past it; output must stay inside.
        prob = _prob_map(shape=(40, 40), blobs=[(0, 40, 0, 40)])
        boxes = boxes_from_bitmap(prob, _FakePostConfig(), 40, 40)
        self.assertEqual(len(boxes), 1)
        box = boxes[0]
        self.assertGreaterEqual(box.min(), 0)
        self.assertLessEqual(box[:, 0].max(), 40)
        self.assertLessEqual(box[:, 1].max(), 40)

    def test_boxes_are_rescaled_to_dest_size(self):
        prob = _prob_map(shape=(50, 60), blobs=[(10, 25, 15, 45)])
        small = boxes_from_bitmap(prob, _FakePostConfig(), 60, 50)[0]
        large = boxes_from_bitmap(prob, _FakePostConfig(), 600, 500)[0]
        # dest 10x larger -> coordinates ~10x larger (rounding aside).
        self.assertAlmostEqual(
            large[:, 0].max() / float(small[:, 0].max()), 10.0, delta=0.5
        )
        self.assertAlmostEqual(
            large[:, 1].max() / float(small[:, 1].max()), 10.0, delta=0.5
        )

    def test_thin_blob_below_min_box_side_is_dropped(self):
        # 2px tall < MIN_BOX_SIDE (3): rejected by the first get_mini_boxes gate.
        self.assertEqual(MIN_BOX_SIDE, 3)
        prob = _prob_map(blobs=[(10, 12, 5, 50)])
        boxes = boxes_from_bitmap(prob, _FakePostConfig(), 60, 50)
        self.assertEqual(boxes, [])

    def test_low_confidence_blob_is_dropped_by_box_thresh(self):
        prob = _prob_map(blobs=[(10, 25, 15, 45)], value=0.4)
        cfg = _FakePostConfig(thresh=0.3, box_thresh=0.9)
        self.assertEqual(boxes_from_bitmap(prob, cfg, 60, 50), [])
        # Same map passes with a lower box_thresh.
        cfg_low = _FakePostConfig(thresh=0.3, box_thresh=0.2)
        self.assertEqual(len(boxes_from_bitmap(prob, cfg_low, 60, 50)), 1)

    def test_det_thresh_controls_binarization(self):
        prob = _prob_map(blobs=[(10, 25, 15, 45)], value=0.4)
        # thresh above the blob value -> empty bitmap -> no contours at all.
        cfg = _FakePostConfig(thresh=0.5, box_thresh=0.0)
        self.assertEqual(boxes_from_bitmap(prob, cfg, 60, 50), [])

    def test_max_candidates_caps_the_number_of_boxes(self):
        prob = _prob_map(blobs=[(5, 20, 5, 25), (30, 45, 30, 55)])
        cfg_all = _FakePostConfig()
        self.assertEqual(len(boxes_from_bitmap(prob, cfg_all, 60, 50)), 2)

        cfg_one = _FakePostConfig(max_candidates=1)
        self.assertEqual(len(boxes_from_bitmap(prob, cfg_one, 60, 50)), 1)

        cfg_none = _FakePostConfig(max_candidates=0)
        self.assertEqual(boxes_from_bitmap(prob, cfg_none, 60, 50), [])

    def test_unclip_ratio_scales_the_expansion(self):
        prob = _prob_map(blobs=[(10, 25, 15, 45)])
        tight = boxes_from_bitmap(prob, _FakePostConfig(unclip_ratio=0.5), 60, 50)[0]
        wide = boxes_from_bitmap(prob, _FakePostConfig(unclip_ratio=3.0), 60, 50)[0]
        tight_w = tight[:, 0].max() - tight[:, 0].min()
        wide_w = wide[:, 0].max() - wide[:, 0].min()
        self.assertGreater(wide_w, tight_w)

    def test_zero_unclip_ratio_drops_boxes_below_the_second_side_gate(self):
        # unclip_ratio 0 -> no expansion; a 4px-tall blob then fails the
        # post-unclip gate (MIN_BOX_SIDE + 2 == 5).
        prob = _prob_map(blobs=[(10, 14, 5, 50)])
        cfg = _FakePostConfig(unclip_ratio=0.0)
        self.assertEqual(boxes_from_bitmap(prob, cfg, 60, 50), [])
        # With the normal ratio the same blob survives.
        self.assertEqual(len(boxes_from_bitmap(prob, _FakePostConfig(), 60, 50)), 1)

    def test_accepts_boolean_style_map_and_returns_python_list(self):
        prob = _prob_map(blobs=[(10, 25, 15, 45)])
        out = boxes_from_bitmap(prob, _FakePostConfig(), 60, 50)
        self.assertIsInstance(out, list)
        self.assertTrue(all(isinstance(b, np.ndarray) for b in out))
