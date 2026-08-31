"""Characterization tests for ``PPOCREngine.predict`` (CRAP unit 49).

Target: ``service/ocr/ppocr/engine.py`` -> ``PPOCREngine.predict``.

The pipeline is pinned WITHOUT any ONNX model, file IO or network: the module
level collaborators ``read_image`` / ``detect`` / ``get_rotate_crop_image`` are
patched, ``load`` is stubbed to install a fake recognizer, and the config is a
tiny stand-in exposing only ``det_max_side``.

Everything asserted here is the CURRENT observed behaviour.
"""

from unittest import mock

import numpy as np
from django.test import SimpleTestCase

from service.ocr.ppocr.engine import MIN_BLOCK_CHARS, PPOCREngine

ENGINE = "service.ocr.ppocr.engine"


def quad(x0, y0, x1, y1):
    """Axis-aligned (4, 2) float box, as ``detect`` returns them."""
    return np.array(
        [[x0, y0], [x1, y0], [x1, y1], [x0, y1]],
        dtype=np.float64,
    )


class FakeConfig:
    def __init__(self, det_max_side=960):
        self.det_max_side = det_max_side


class FakeRecognizer:
    """Returns a canned ``(text, confidence)`` list; records the crops it saw."""

    def __init__(self, results):
        self.results = results
        self.calls = []

    def recognize(self, crops):
        self.calls.append(crops)
        return self.results


class PredictHarness(SimpleTestCase):
    """Builds an engine whose every collaborator is a stub."""

    def make_engine(self, boxes, recognized, image=None, det_max_side=960):
        engine = PPOCREngine()
        engine.config = FakeConfig(det_max_side)
        engine.det_session = mock.sentinel.det_session
        engine.det_input_name = "x"
        engine.recognizer = FakeRecognizer(recognized)
        engine.is_loaded = True

        if image is None:
            # 40 rows x 100 cols x 3 channels -> height=40, width=100
            image = np.zeros((40, 100, 3), dtype=np.uint8)

        self.detect_mock = mock.Mock(return_value=(boxes, mock.sentinel.scores))
        self.read_image_mock = mock.Mock(return_value=image)
        self.crop_mock = mock.Mock(side_effect=lambda img, box: ("crop", tuple(box[0])))

        patchers = [
            mock.patch(f"{ENGINE}.read_image", self.read_image_mock),
            mock.patch(f"{ENGINE}.detect", self.detect_mock),
            mock.patch(f"{ENGINE}.get_rotate_crop_image", self.crop_mock),
        ]
        for p in patchers:
            p.start()
            self.addCleanup(p.stop)
        return engine


class PredictDetOnlyTests(PredictHarness):
    def test_det_only_returns_only_detection_signals(self):
        boxes = [quad(0, 0, 10, 10), quad(20, 0, 30, 10)]
        engine = self.make_engine(boxes, recognized=[])

        result = engine.predict("/img.jpg", det_only=True)

        self.assertEqual(
            sorted(result),
            ["box_count", "image_height", "image_width", "text_area_fraction"],
        )
        self.assertEqual(result["box_count"], 2)
        self.assertEqual(result["image_width"], 100)
        self.assertEqual(result["image_height"], 40)
        # 2 boxes of 100px each over a 4000px image.
        self.assertAlmostEqual(result["text_area_fraction"], 200.0 / 4000.0)

    def test_det_only_never_touches_the_recognizer(self):
        engine = self.make_engine([quad(0, 0, 10, 10)], recognized=[("hi", 0.9)])
        engine.predict("/img.jpg", det_only=True)
        self.assertEqual(engine.recognizer.calls, [])
        self.crop_mock.assert_not_called()

    def test_det_only_with_no_boxes_reports_zero_area(self):
        engine = self.make_engine([], recognized=[])
        result = engine.predict("/img.jpg", det_only=True)
        self.assertEqual(result["box_count"], 0)
        self.assertEqual(result["text_area_fraction"], 0.0)

    def test_text_area_fraction_is_clamped_to_one(self):
        # Boxes overlapping / exceeding the image still cap at 1.0.
        boxes = [quad(0, 0, 100, 40), quad(0, 0, 100, 40)]
        engine = self.make_engine(boxes, recognized=[])
        result = engine.predict("/img.jpg", det_only=True)
        self.assertEqual(result["text_area_fraction"], 1.0)


class PredictFullPipelineTests(PredictHarness):
    def test_happy_path_returns_full_contract(self):
        boxes = [quad(0, 0, 10, 10), quad(20, 0, 30, 10)]
        engine = self.make_engine(boxes, recognized=[("hello", 0.9), ("world", 0.8)])

        result = engine.predict("/img.jpg")

        self.assertEqual(
            sorted(result),
            [
                "blocks",
                "image_height",
                "image_width",
                "mean_confidence",
                "text",
                "text_area_fraction",
            ],
        )
        self.assertEqual(result["text"], "hello\nworld")
        self.assertAlmostEqual(result["mean_confidence"], 0.85)
        self.assertEqual(result["image_width"], 100)
        self.assertEqual(result["image_height"], 40)
        self.assertEqual(len(result["blocks"]), 2)

    def test_block_shape_and_box_is_a_plain_list(self):
        engine = self.make_engine([quad(1, 2, 3, 4)], recognized=[("ab", 0.75)])
        block = engine.predict("/img.jpg")["blocks"][0]
        self.assertEqual(sorted(block), ["box", "confidence", "text"])
        self.assertEqual(block["text"], "ab")
        self.assertEqual(block["confidence"], 0.75)
        self.assertIsInstance(block["box"], list)
        self.assertEqual(block["box"], [[1.0, 2.0], [3.0, 2.0], [3.0, 4.0], [1.0, 4.0]])

    def test_text_is_stripped_before_length_check_and_storage(self):
        engine = self.make_engine(
            [quad(0, 0, 10, 10), quad(0, 20, 10, 30)],
            recognized=[("  padded  ", 0.9), ("   x   ", 0.9)],
        )
        result = engine.predict("/img.jpg")
        # "padded" survives; the single stripped char "x" is below MIN_BLOCK_CHARS.
        self.assertEqual(MIN_BLOCK_CHARS, 2)
        self.assertEqual(result["text"], "padded")

    def test_confidence_below_threshold_is_dropped_and_boundary_is_inclusive(self):
        engine = self.make_engine(
            [quad(0, 0, 10, 10), quad(0, 20, 10, 30)],
            recognized=[("keep", 0.6), ("drop", 0.5999)],
        )
        result = engine.predict("/img.jpg", min_confidence=0.6)
        self.assertEqual(result["text"], "keep")
        self.assertAlmostEqual(result["mean_confidence"], 0.6)

    def test_min_confidence_default_is_zero_point_six(self):
        engine = self.make_engine(
            [quad(0, 0, 10, 10)],
            recognized=[("maybe", 0.55)],
        )
        self.assertEqual(engine.predict("/img.jpg")["text"], "")

    def test_all_blocks_filtered_out_yields_empty_text_and_zero_confidence(self):
        engine = self.make_engine(
            [quad(0, 0, 10, 10), quad(0, 20, 10, 30)],
            recognized=[("", 0.99), ("a", 0.99)],
        )
        result = engine.predict("/img.jpg")
        self.assertEqual(result["text"], "")
        self.assertEqual(result["blocks"], [])
        self.assertEqual(result["mean_confidence"], 0.0)
        # ...but the area fraction still reflects ALL detected boxes.
        self.assertGreater(result["text_area_fraction"], 0.0)

    def test_no_boxes_short_circuits_to_an_empty_result(self):
        engine = self.make_engine([], recognized=[])
        result = engine.predict("/img.jpg")
        self.assertEqual(result["text"], "")
        self.assertEqual(result["blocks"], [])
        self.assertEqual(result["mean_confidence"], 0.0)
        self.assertEqual(result["text_area_fraction"], 0.0)
        # The recognizer IS still called, with an empty crop list.
        self.assertEqual(engine.recognizer.calls, [[]])

    def test_blocks_are_emitted_in_reading_order_not_detection_order(self):
        # Detection order is deliberately scrambled: bottom-right first.
        boxes = [
            quad(50, 30, 60, 38),  # row 2, right
            quad(50, 0, 60, 8),  # row 1, right
            quad(0, 30, 10, 38),  # row 2, left
            quad(0, 0, 10, 8),  # row 1, left
        ]
        engine = self.make_engine(
            boxes,
            recognized=[("BR", 0.9), ("TR", 0.9), ("BL", 0.9), ("TL", 0.9)],
        )
        result = engine.predict("/img.jpg")
        self.assertEqual(result["text"], "TL\nTR\nBL\nBR")

    def test_zip_truncates_when_recognizer_returns_fewer_results(self):
        # Pinned as a latent hazard: extra boxes are silently dropped by zip().
        engine = self.make_engine(
            [quad(0, 0, 10, 10), quad(0, 20, 10, 30)],
            recognized=[("only", 0.9)],
        )
        result = engine.predict("/img.jpg")
        self.assertEqual(result["text"], "only")
        self.assertEqual(len(result["blocks"]), 1)

    def test_one_crop_is_produced_per_detected_box(self):
        boxes = [quad(0, 0, 10, 10), quad(0, 20, 10, 30)]
        engine = self.make_engine(boxes, recognized=[("aa", 0.9), ("bb", 0.9)])
        engine.predict("/img.jpg")
        self.assertEqual(self.crop_mock.call_count, 2)
        self.assertEqual(len(engine.recognizer.calls[0]), 2)


class PredictWiringTests(PredictHarness):
    def test_max_side_defaults_to_config_det_max_side(self):
        engine = self.make_engine([], recognized=[], det_max_side=1234)
        engine.predict("/img.jpg", det_only=True)
        self.assertEqual(self.detect_mock.call_args.args[4], 1234)

    def test_explicit_max_side_overrides_the_config(self):
        engine = self.make_engine([], recognized=[], det_max_side=1234)
        engine.predict("/img.jpg", max_side=320, det_only=True)
        self.assertEqual(self.detect_mock.call_args.args[4], 320)

    def test_detect_receives_session_input_name_image_and_config(self):
        image = np.zeros((7, 9, 3), dtype=np.uint8)
        engine = self.make_engine([], recognized=[], image=image)
        engine.predict("/some/path.png", det_only=True)

        self.read_image_mock.assert_called_once_with("/some/path.png")
        args = self.detect_mock.call_args.args
        self.assertIs(args[0], mock.sentinel.det_session)
        self.assertEqual(args[1], "x")
        self.assertIs(args[2], image)
        self.assertIs(args[3], engine.config)

    def test_image_dimensions_come_from_the_first_two_array_axes(self):
        engine = self.make_engine(
            [], recognized=[], image=np.zeros((7, 9, 3), dtype=np.uint8)
        )
        result = engine.predict("/img.jpg", det_only=True)
        self.assertEqual((result["image_height"], result["image_width"]), (7, 9))

    def test_predict_lazily_loads_when_not_loaded(self):
        engine = self.make_engine([], recognized=[])
        engine.is_loaded = False
        engine.config = None

        def fake_load():
            engine.config = FakeConfig(555)
            engine.is_loaded = True

        with mock.patch.object(engine, "load", side_effect=fake_load) as load_mock:
            engine.predict("/img.jpg", det_only=True)

        load_mock.assert_called_once_with()
        self.assertEqual(self.detect_mock.call_args.args[4], 555)

    def test_predict_does_not_reload_when_already_loaded(self):
        engine = self.make_engine([], recognized=[])
        with mock.patch.object(engine, "load") as load_mock:
            engine.predict("/img.jpg", det_only=True)
        load_mock.assert_not_called()


class EngineLifecycleTests(SimpleTestCase):
    def test_fresh_engine_is_not_loaded(self):
        engine = PPOCREngine(model_dir="/models")
        self.assertFalse(engine.is_loaded)
        self.assertIsNone(engine.config)
        self.assertIsNone(engine.recognizer)

    def test_unload_resets_every_attribute(self):
        engine = PPOCREngine()
        engine.config = FakeConfig()
        engine.det_session = object()
        engine.rec_session = object()
        engine.recognizer = object()
        engine.det_input_name = "x"
        engine.is_loaded = True

        engine.unload()

        self.assertIsNone(engine.config)
        self.assertIsNone(engine.det_session)
        self.assertIsNone(engine.rec_session)
        self.assertIsNone(engine.recognizer)
        self.assertIsNone(engine.det_input_name)
        self.assertFalse(engine.is_loaded)
