"""Tests for the pure (network-free) parsing logic in scripts/build_ocr_bundle.py.

The build script is a hand-run maintainer tool, not part of the server, but its
yml -> config extraction is easy to get subtly wrong (scale strings, BGR flag,
charset order, use_space_char). These tests pin that logic against fixture yml
snippets modelled on the real PP-OCRv6 inference ymls, with no network access.
"""

import importlib.util
from pathlib import Path

from django.test import SimpleTestCase

# Load scripts/build_ocr_bundle.py by path (scripts/ is not an importable pkg).
_SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "build_ocr_bundle.py"
_spec = importlib.util.spec_from_file_location("build_ocr_bundle", _SCRIPT)
build = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(build)


DET_YML = """
Global:
  model_name: PP-OCRv6_small_det
PostProcess:
  box_thresh: 0.45
  max_candidates: 3000
  name: DBPostProcess
  thresh: 0.2
  unclip_ratio: 1.4
PreProcess:
  transform_ops:
  - DecodeImage:
      channel_first: false
      img_mode: BGR
  - DetLabelEncode: null
  - DetResizeForTest: null
  - NormalizeImage:
      mean:
      - 0.485
      - 0.456
      - 0.406
      order: hwc
      scale: 1./255.
      std:
      - 0.229
      - 0.224
      - 0.225
  - ToCHWImage: null
  - KeepKeys:
      keep_keys:
      - image
      - shape
"""

REC_YML = """
Global:
  model_name: PP-OCRv6_small_rec
PostProcess:
  name: CTCLabelDecode
  character_dict:
  - '!'
  - '"'
  - a
  - ' '
  - z
PreProcess:
  transform_ops:
  - DecodeImage:
      img_mode: BGR
  - RecResizeImg:
      image_shape:
      - 3
      - 48
      - 320
  - KeepKeys:
      keep_keys:
      - image
"""

REC_YML_SPACE = """
PostProcess:
  name: CTCLabelDecode
  use_space_char: true
  character_dict:
  - a
  - b
PreProcess:
  transform_ops:
  - RecResizeImg:
      image_shape:
      - 3
      - 48
      - 320
"""


class ParseScaleTest(SimpleTestCase):
    def test_paddle_string_literal(self):
        self.assertAlmostEqual(build.parse_scale("1./255."), 1.0 / 255.0)

    def test_plain_float(self):
        self.assertAlmostEqual(build.parse_scale(0.00392), 0.00392)

    def test_integer_denominator_string(self):
        self.assertAlmostEqual(build.parse_scale("1/255"), 1.0 / 255.0)


class ParseDetConfigTest(SimpleTestCase):
    def setUp(self):
        self.cfg = build.parse_det_config(build.load_yaml(DET_YML))

    def test_postprocess_params(self):
        post = self.cfg["postprocess"]
        self.assertEqual(post["thresh"], 0.2)
        self.assertEqual(post["box_thresh"], 0.45)
        self.assertEqual(post["unclip_ratio"], 1.4)
        self.assertEqual(post["max_candidates"], 3000)

    def test_preprocess_normalization(self):
        pre = self.cfg["preprocess"]
        self.assertEqual(pre["mean"], [0.485, 0.456, 0.406])
        self.assertEqual(pre["std"], [0.229, 0.224, 0.225])
        self.assertAlmostEqual(pre["scale"], 1.0 / 255.0)
        self.assertEqual(pre["order"], "hwc")

    def test_bgr_flag_and_defaults(self):
        pre = self.cfg["preprocess"]
        self.assertEqual(pre["img_mode"], "BGR")
        self.assertTrue(pre["bgr"])
        self.assertEqual(pre["max_side"], build.DEFAULT_MAX_SIDE)
        self.assertEqual(pre["size_multiple"], build.DEFAULT_SIZE_MULTIPLE)


class ParseRecConfigTest(SimpleTestCase):
    def test_shape_and_charset_order_preserved(self):
        cfg = build.parse_rec_config(build.load_yaml(REC_YML))
        self.assertEqual(cfg["input_shape"], [3, 48, 320])
        # Order preserved exactly, including the inline space entry.
        self.assertEqual(cfg["charset"], ["!", '"', "a", " ", "z"])
        self.assertFalse(cfg["use_space_char"])

    def test_use_space_char_flag(self):
        cfg = build.parse_rec_config(build.load_yaml(REC_YML_SPACE))
        self.assertTrue(cfg["use_space_char"])

    def test_missing_charset_raises(self):
        with self.assertRaises(ValueError):
            build.parse_rec_config({"PostProcess": {"name": "CTCLabelDecode"}})


class CharsetTextTest(SimpleTestCase):
    def test_one_char_per_line_order_and_trailing_newline(self):
        text = build.charset_text(["!", "a", "z"], use_space_char=False)
        self.assertEqual(text, "!\na\nz\n")

    def test_use_space_char_appends_space_once(self):
        text = build.charset_text(["a", "b"], use_space_char=True)
        self.assertEqual(text.split("\n"), ["a", "b", " ", ""])

    def test_use_space_char_not_duplicated_when_present(self):
        text = build.charset_text(["a", " ", "b"], use_space_char=True)
        # Space already in the dict -> not appended again.
        self.assertEqual(text.count("\n"), 3)


class BuildConfigTest(SimpleTestCase):
    def test_assembles_expected_shape(self):
        det = build.parse_det_config(build.load_yaml(DET_YML))
        rec = build.parse_rec_config(build.load_yaml(REC_YML))
        config = build.build_config(det, rec)
        self.assertEqual(config["format"], "ppocrv6-bundle/1")
        self.assertIn("preprocess", config["det"])
        self.assertIn("postprocess", config["det"])
        self.assertEqual(config["rec"]["input_shape"], [3, 48, 320])
        self.assertFalse(config["use_space_char"])
