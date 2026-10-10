"""Golden tests for OpenCLIP with the real model: tags, documents, search.

These run real ONNX inference and are skipped cleanly when the model bundle is
absent (so CI without the bundle stays green). Point OPENCLIP_MODEL_DIR at a
bundle (``scripts/build_openclip_onnx.py`` writes one) to run them.

The fixtures are made at test time with Pillow, as the OCR golden tests make
theirs: the synthetic receipt of ``test_ocr_engine_golden`` and a plain
landscape-like gradient.
"""

import json
import os
import shutil
import tempfile
from unittest.mock import patch

import numpy as np
from django.test import SimpleTestCase
from PIL import Image

from api.document_detection import STRONG_TAG_LABELS, classify_document
from api.tests.ocr.test_ocr_engine_golden import _render_receipt
from service.tags.openclip import openclip as openclip_module
from service.tags.openclip.openclip import OpenCLIP, Preprocess

BUNDLE_FILES = ("visual.onnx", "textual.onnx", "tokenizer.json", "preprocess.json")


def _model_dir():
    return os.environ.get(openclip_module.MODEL_DIR_ENV) or openclip_module.MODEL_DIR


def _bundle_available():
    return all(os.path.exists(os.path.join(_model_dir(), f)) for f in BUNDLE_FILES)


def _render_landscape(path):
    """A sky-over-grass gradient: no text, nothing document-like."""
    y = np.linspace(0, 1, 400)[:, None, None]
    sky = np.array([110, 170, 235]) * (1 - y) + np.array([60, 140, 60]) * y
    arr = np.repeat(sky, 600, axis=1).astype(np.uint8)
    Image.fromarray(arr, "RGB").save(path)


class OpenCLIPGoldenTests(SimpleTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls._tmp = tempfile.mkdtemp(prefix="openclip-golden-")
        cls.receipt = os.path.join(cls._tmp, "receipt.png")
        cls.landscape = os.path.join(cls._tmp, "landscape.png")

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls._tmp, ignore_errors=True)
        super().tearDownClass()

    def setUp(self):
        if not _bundle_available():
            self.skipTest(
                f"OpenCLIP bundle not found at {_model_dir()}; set "
                f"{openclip_module.MODEL_DIR_ENV} to run the golden tests."
            )
        if not os.path.exists(self.receipt) and not _render_receipt(self.receipt):
            self.skipTest("no usable TrueType font to render the receipt")
        if not os.path.exists(self.landscape):
            _render_landscape(self.landscape)

        model_dir = _model_dir()
        patches = {
            "VISUAL_PATH": os.path.join(model_dir, "visual.onnx"),
            "TEXTUAL_PATH": os.path.join(model_dir, "textual.onnx"),
            "TOKENIZER_PATH": os.path.join(model_dir, "tokenizer.json"),
            "PREPROCESS_PATH": os.path.join(model_dir, "preprocess.json"),
            # Never write the tag cache into somebody's model directory.
            "EMBEDDINGS_CACHE": os.path.join(self._tmp, "tag_embeddings.npy"),
        }
        for name, value in patches.items():
            patcher = patch.object(openclip_module, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    @classmethod
    def model(cls):
        if not hasattr(cls, "_model"):
            cls._model = OpenCLIP()
        return cls._model

    def test_the_bundle_preprocessing_is_the_one_the_runtime_expects(self):
        with open(openclip_module.PREPROCESS_PATH, encoding="utf-8") as f:
            raw = json.load(f)
        preprocess = Preprocess.from_dict(raw)
        self.assertEqual(preprocess.size, 224)
        self.assertEqual(preprocess.context_length, 77)
        self.assertEqual(preprocess.interpolation, "bicubic")
        self.assertAlmostEqual(preprocess.logit_scale, 100.0, places=3)

    def test_embeddings_are_raw_512_d(self):
        model = self.model()
        image = model.embed_image_raw(self.landscape)
        text = model.embed_text_raw("a receipt")
        self.assertEqual(image.shape, (1, 512))
        self.assertEqual(text.shape, (512,))
        # Unnormalised: the search thresholds are on this scale.
        self.assertGreater(float(np.linalg.norm(image)), 5.0)
        self.assertGreater(float(np.linalg.norm(text)), 5.0)

    def test_batched_and_single_embeddings_agree(self):
        model = self.model()
        batch = model.embed_images_raw([self.receipt, self.landscape])
        single = model.embed_image_raw(self.landscape)[0]
        np.testing.assert_allclose(batch[1], single, rtol=1e-4, atol=1e-4)

    def test_the_receipt_is_tagged_and_detected_as_a_document(self):
        tags = self.model().predict(self.receipt)["tags"]

        self.assertTrue(set(tags) & STRONG_TAG_LABELS, tags)
        # The OCR side of the same receipt: text but no currency symbol.
        ocr_text = "LIBREPHOTOS MARKET\n123 MAIN STREET\nTOTAL 12.34\nTHANK YOU"
        self.assertTrue(classify_document(ocr_text, 0.05, set(tags)))

    def test_the_landscape_is_not_a_document(self):
        tags = self.model().predict(self.landscape)["tags"]

        self.assertFalse(set(tags) & STRONG_TAG_LABELS, tags)
        self.assertFalse(classify_document("", 0.0, set(tags)))

    def test_search_ranks_the_matching_photo_first(self):
        model = self.model()
        receipt, landscape = model.embed_images_raw([self.receipt, self.landscape])
        for query, expected in (("a shopping receipt", 0), ("a blue sky", 1)):
            with self.subTest(query=query):
                text = model.embed_text_raw(query)
                scores = [float(text @ receipt), float(text @ landscape)]
                self.assertEqual(int(np.argmax(scores)), expected, scores)
