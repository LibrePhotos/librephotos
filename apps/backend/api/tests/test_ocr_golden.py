"""Golden end-to-end tests for the vendored PP-OCRv6 pipeline.

These run REAL ONNX inference and are skipped cleanly when the model bundle is
absent (so CI without the bundle stays green).  Point OCR_MODEL_DIR at the test
bundle to run them, e.g. ``.testtmp-ocr-models/ppocrv6_small``.

The fixture is generated at test time with Pillow (no binary committed): a
synthetic ~800px white "receipt" with black text lines.  The core proof is that
the pipeline actually reads the strong tokens back out of that image.
"""

import os
import shutil
import tempfile

from django.test import SimpleTestCase

from service.ocr.ppocr.config import OCRConfig, OCRConfigError, resolve_model_dir
from service.ocr.ppocr.engine import PPOCREngine


def _model_dir_available():
    model_dir = resolve_model_dir()
    required = ["det.onnx", "rec.onnx", "config.json", "charset.txt"]
    return all(os.path.exists(os.path.join(model_dir, name)) for name in required)


def _load_font(size):
    from PIL import ImageFont

    candidates = [
        r"C:\Windows\Fonts\arial.ttf",
        r"C:\Windows\Fonts\consola.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
        "/Library/Fonts/Arial.ttf",
    ]
    for path in candidates:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return None


def _render_receipt(path):
    """Render a synthetic receipt PNG; returns True on success."""
    from PIL import Image, ImageDraw

    width, height = 800, 500
    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)

    lines = [
        ("LIBREPHOTOS MARKET", 40, 40),
        ("123 MAIN STREET", 120, 28),
        ("TOTAL   12.34", 220, 40),
        ("THANK YOU", 320, 36),
    ]
    for text, y, size in lines:
        font = _load_font(size)
        if font is None:
            return False
        draw.text((60, y), text, fill="black", font=font)

    image.save(path)
    return os.path.getsize(path) <= 100 * 1024


class OCRGoldenTests(SimpleTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls._tmp = tempfile.mkdtemp(prefix="ocr-golden-")
        cls.fixture = os.path.join(cls._tmp, "receipt.png")

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls._tmp, ignore_errors=True)
        super().tearDownClass()

    def setUp(self):
        if not _model_dir_available():
            self.skipTest(
                f"OCR model bundle not found at {resolve_model_dir()}; "
                f"set OCR_MODEL_DIR to run golden tests."
            )
        if not os.path.exists(self.fixture):
            if not _render_receipt(self.fixture):
                self.skipTest("no usable TrueType font to render the fixture")

    def test_reads_strong_tokens(self):
        engine = PPOCREngine()
        result = engine.predict(self.fixture, min_confidence=0.6)

        self.assertIn("blocks", result)
        self.assertGreater(len(result["blocks"]), 0, "expected detected text blocks")

        text = result["text"].upper()
        # Strong tokens must survive OCR (substring checks tolerate noise around).
        self.assertIn("TOTAL", text)
        self.assertIn("12.34", text)

        # text_area_fraction is a sane "how much text" signal, not degenerate.
        self.assertGreater(result["text_area_fraction"], 0.01)
        self.assertLess(result["text_area_fraction"], 0.9)

        # Recognition confidence on clean synthetic text should be strong.
        self.assertGreater(result["mean_confidence"], 0.5)

        # Every returned block obeys the contract shape.
        for block in result["blocks"]:
            self.assertIn("text", block)
            self.assertIn("box", block)
            self.assertIn("confidence", block)
            self.assertEqual(len(block["box"]), 4)
            self.assertGreaterEqual(block["confidence"], 0.6)
            self.assertGreaterEqual(len(block["text"].strip()), 2)

    def test_det_only_matches_area_without_text(self):
        engine = PPOCREngine()
        full = engine.predict(self.fixture, min_confidence=0.6)
        det = engine.predict(self.fixture, det_only=True)

        self.assertNotIn("text", det)
        self.assertNotIn("blocks", det)
        self.assertIn("box_count", det)
        self.assertGreater(det["box_count"], 0)
        # det_only computes the same detection-derived area signal.
        self.assertAlmostEqual(
            det["text_area_fraction"], full["text_area_fraction"], places=6
        )

    def test_charset_mismatch_guard_refuses(self):
        """A truncated charset must make load refuse (guards a tier mismatch)."""
        model_dir = resolve_model_dir()
        real = OCRConfig(model_dir)
        # The real bundle's rec head has len(charset) + 2 classes (blank + space).
        true_width = len(real.charset) + 2

        truncated_dir = tempfile.mkdtemp(prefix="ocr-badcharset-")
        try:
            shutil.copy(
                os.path.join(model_dir, "config.json"),
                os.path.join(truncated_dir, "config.json"),
            )
            # Drop the last 100 charset entries -> width no longer lines up.
            with open(os.path.join(model_dir, "charset.txt"), encoding="utf-8") as f:
                lines = f.readlines()
            with open(
                os.path.join(truncated_dir, "charset.txt"), "w", encoding="utf-8"
            ) as f:
                f.writelines(lines[:-100])

            cfg = OCRConfig(truncated_dir)
            # Against the real recognition width, the truncated charset no longer
            # lines up -> load must refuse.
            with self.assertRaises(OCRConfigError):
                cfg.build_decode_charset(true_width)

            # And the untruncated charset is accepted (sanity: guard isn't blanket).
            self.assertIsNotNone(real.build_decode_charset(true_width))
        finally:
            shutil.rmtree(truncated_dir, ignore_errors=True)
