"""Characterization tests for ``OCRConfig.build_decode_charset``.

These pin the CURRENT behavior of the CTC decode-table builder in
``service/ocr/ppocr/config.py`` before it is refactored.  No ONNX model, no
network and no ML runtime is involved: ``OCRConfig`` only parses ``config.json``
and ``charset.txt``, so a synthetic bundle directory on disk is enough.
"""

import contextlib
import io
import json
import os
import shutil
import tempfile

from django.test import SimpleTestCase

from service.ocr.ppocr.config import OCRConfig, OCRConfigError

BASE_CONFIG = {
    "det": {
        "preprocess": {
            "mean": [0.0, 0.0, 0.0],
            "std": [1.0, 1.0, 1.0],
            "scale": 1.0 / 255.0,
            "img_mode": "BGR",
            "max_side": 960,
            "size_multiple": 32,
        },
        "postprocess": {
            "thresh": 0.3,
            "box_thresh": 0.6,
            "unclip_ratio": 1.5,
            "max_candidates": 1000,
        },
    },
    "rec": {"input_shape": [3, 48, 320]},
    "use_space_char": False,
}


class BuildDecodeCharsetTests(SimpleTestCase):
    """Every branch of ``build_decode_charset`` on a synthetic 3-char bundle."""

    def _make_config(self, charset_lines=("a", "b", "c"), use_space_char=False):
        tmp = tempfile.mkdtemp(prefix="ocr-crap-u47-")
        self.addCleanup(shutil.rmtree, tmp, True)

        cfg_json = json.loads(json.dumps(BASE_CONFIG))
        cfg_json["use_space_char"] = use_space_char
        with open(os.path.join(tmp, "config.json"), "w", encoding="utf-8") as f:
            json.dump(cfg_json, f)
        with open(os.path.join(tmp, "charset.txt"), "w", encoding="utf-8") as f:
            f.write("".join(line + "\n" for line in charset_lines))
        return OCRConfig(tmp)

    def _build(self, cfg, width):
        """Call build_decode_charset, returning (decode_table, stdout_text)."""
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            decode = cfg.build_decode_charset(width)
        return decode, buf.getvalue()

    # --- happy paths ---------------------------------------------------

    def test_blank_only_width_no_space_class(self):
        cfg = self._make_config(use_space_char=False)
        decode, out = self._build(cfg, len(cfg.charset) + 1)
        self.assertEqual(decode, ["<blank>", "a", "b", "c"])
        # Config agrees with the model geometry -> no advisory note printed.
        self.assertEqual(out, "")

    def test_space_class_width_with_use_space_char(self):
        cfg = self._make_config(use_space_char=True)
        decode, out = self._build(cfg, len(cfg.charset) + 2)
        # Index 0 is the CTC blank; the space class is appended last.
        self.assertEqual(decode, ["<blank>", "a", "b", "c", " "])
        self.assertEqual(out, "")

    def test_returned_table_is_a_copy_of_charset(self):
        cfg = self._make_config()
        decode, _ = self._build(cfg, len(cfg.charset) + 1)
        decode[1] = "MUTATED"
        decode.append("EXTRA")
        self.assertEqual(cfg.charset, ["a", "b", "c"])

    def test_charset_entries_with_interior_space_are_preserved(self):
        cfg = self._make_config(charset_lines=("a", " ", "b c"))
        decode, _ = self._build(cfg, len(cfg.charset) + 1)
        self.assertEqual(decode, ["<blank>", "a", " ", "b c"])

    # --- advisory-note branches (model geometry wins over the flag) ----

    def test_model_has_space_class_but_flag_false_prints_note(self):
        cfg = self._make_config(use_space_char=False)
        decode, out = self._build(cfg, len(cfg.charset) + 2)
        # The trailing space class is added anyway - the model is authoritative.
        self.assertEqual(decode, ["<blank>", "a", "b", "c", " "])
        self.assertIn("a space class", out)
        self.assertIn("use_space_char=False", out)
        self.assertIn("trusting the model", out)

    def test_model_has_no_space_class_but_flag_true_prints_note(self):
        cfg = self._make_config(use_space_char=True)
        decode, out = self._build(cfg, len(cfg.charset) + 1)
        self.assertEqual(decode, ["<blank>", "a", "b", "c"])
        self.assertIn("no space class", out)
        self.assertIn("use_space_char=True", out)

    # --- refusal branches ----------------------------------------------

    def test_width_equal_to_charset_size_refuses(self):
        cfg = self._make_config()
        with self.assertRaises(OCRConfigError) as ctx:
            cfg.build_decode_charset(len(cfg.charset))
        message = str(ctx.exception)
        self.assertIn("output width (3)", message)
        self.assertIn("charset size (3)", message)
        self.assertIn("expected 4 or 5", message)
        self.assertIn("refusing to start", message)

    def test_width_three_wider_than_charset_refuses(self):
        cfg = self._make_config()
        with self.assertRaises(OCRConfigError):
            cfg.build_decode_charset(len(cfg.charset) + 3)

    def test_width_smaller_than_charset_refuses(self):
        cfg = self._make_config()
        with self.assertRaises(OCRConfigError):
            cfg.build_decode_charset(1)

    def test_zero_width_refuses(self):
        cfg = self._make_config()
        with self.assertRaises(OCRConfigError):
            cfg.build_decode_charset(0)

    def test_config_error_is_a_runtime_error(self):
        self.assertTrue(issubclass(OCRConfigError, RuntimeError))

    # --- input coercion (current, incidental behavior) ------------------

    def test_numeric_string_width_is_accepted(self):
        """``int(rec_output_dim)`` means a numeric string works today."""
        cfg = self._make_config()
        decode, _ = self._build(cfg, "4")
        self.assertEqual(decode, ["<blank>", "a", "b", "c"])

    def test_float_width_is_truncated_not_rounded(self):
        """4.9 -> int() -> 4, so this is accepted as the blank-only width."""
        cfg = self._make_config()
        decode, _ = self._build(cfg, 4.9)
        self.assertEqual(decode, ["<blank>", "a", "b", "c"])

    def test_non_numeric_width_raises_value_error_not_config_error(self):
        cfg = self._make_config()
        with self.assertRaises(ValueError):
            cfg.build_decode_charset("wide")

    def test_none_width_raises_type_error(self):
        cfg = self._make_config()
        with self.assertRaises(TypeError):
            cfg.build_decode_charset(None)

    # --- interaction with the surrounding loader ------------------------

    def test_large_charset_scales(self):
        lines = tuple(str(i) for i in range(500))
        cfg = self._make_config(charset_lines=lines, use_space_char=True)
        decode, out = self._build(cfg, 502)
        self.assertEqual(len(decode), 502)
        self.assertEqual(decode[0], "<blank>")
        self.assertEqual(decode[1], "0")
        self.assertEqual(decode[-1], " ")
        self.assertEqual(out, "")

    def test_empty_charset_is_rejected_before_build_is_reachable(self):
        with self.assertRaises(OCRConfigError):
            self._make_config(charset_lines=())
