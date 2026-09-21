"""Tests for ``service.clip_embeddings.clip_onnx.ClipEmbeddings``.

No model is loaded: ``ort.InferenceSession`` and the tokenizer are faked.
What is pinned:

  * The result keeps one slot per requested path, ``None`` where the image
    could not be opened, so the caller can match embeddings to photos by
    position. A bad image never sinks the batch.
  * Images are batched 32 at a time through the vision tower.
  * The sessions are loaded lazily and reloaded when a different model
    directory is asked for.
  * Text is tokenised with the model's own tokenizer.json and truncated to
    the 77-token CLIP context.
"""

from unittest.mock import MagicMock, patch

import numpy as np
from django.test import SimpleTestCase
from PIL import Image

from service.clip_embeddings import clip_onnx as clip_module
from service.clip_embeddings.clip_onnx import ClipEmbeddings, prepare_image


class _IO:
    def __init__(self, name):
        self.name = name


class FakeSession:
    def __init__(self, name):
        self.input_name = name
        self.calls = []

    def get_inputs(self):
        return [_IO(self.input_name)]

    def run(self, _o, feed):
        value = feed[self.input_name]
        self.calls.append(value)
        # One 3-d embedding per row: (n, 3), with the row index in the first slot.
        out = np.zeros((value.shape[0], 3), np.float32)
        out[:, 0] = np.arange(value.shape[0]) + 1
        return [out]


class ClipEmbeddingsTest(SimpleTestCase):
    def setUp(self):
        self.sessions = {}

        def make_session(path, providers=None):
            self.assertEqual(providers, ["CPUExecutionProvider"])
            kind = "pixel_values" if path.endswith("vision_model.onnx") else "input_ids"
            session = FakeSession(kind)
            self.sessions.setdefault(kind, []).append(session)
            return session

        tokenizer = MagicMock()
        tokenizer.encode.side_effect = lambda text: MagicMock(
            ids=list(range(len(text)))
        )
        for p in (
            patch.object(clip_module.ort, "InferenceSession", side_effect=make_session),
            patch.object(
                clip_module, "Tokenizer", MagicMock(from_file=lambda _p: tokenizer)
            ),
        ):
            p.start()
            self.addCleanup(p.stop)
        self.clip = ClipEmbeddings()

    def _opens(self, mapping):
        """Patch Image.open so paths map to images or raise."""

        def fake_open(path):
            value = mapping[path]
            if isinstance(value, Exception):
                raise value
            return value

        return patch.object(clip_module.Image, "open", side_effect=fake_open)

    def test_keeps_a_slot_per_path_and_none_for_unreadable_images(self):
        good = Image.new("RGB", (50, 40))
        with self._opens(
            {"/a.jpg": good, "/b.jpg": OSError("truncated"), "/c.jpg": good}
        ):
            result = self.clip.encode_images(
                ["/a.jpg", "/b.jpg", "/c.jpg"], "/models/clip"
            )

        self.assertEqual(len(result), 3)
        self.assertIsNone(result[1])
        self.assertEqual(result[0].tolist(), [1.0, 0.0, 0.0])
        self.assertEqual(result[2].tolist(), [2.0, 0.0, 0.0])
        (batch,) = self.sessions["pixel_values"][0].calls
        self.assertEqual(batch.shape, (2, 3, 224, 224))

    def test_images_are_batched_by_32(self):
        good = Image.new("RGB", (30, 30))
        paths = [f"/{i}.jpg" for i in range(70)]
        with self._opens({p: good for p in paths}):
            result = self.clip.encode_images(paths, "/models/clip")

        sizes = [c.shape[0] for c in self.sessions["pixel_values"][0].calls]
        self.assertEqual(sizes, [32, 32, 6])
        self.assertEqual(len(result), 70)
        self.assertEqual(result[69].tolist(), [6.0, 0.0, 0.0])

    def test_sessions_load_lazily_and_follow_the_model_dir(self):
        self.assertFalse(self.clip.is_loaded)
        self.clip.encode_text("hello", "/models/a")
        self.assertTrue(self.clip.is_loaded)
        self.clip.encode_text("hello", "/models/a")
        self.assertEqual(len(self.sessions["input_ids"]), 1)

        self.clip.encode_text("hello", "/models/b")
        self.assertEqual(len(self.sessions["input_ids"]), 2)
        self.assertEqual(self.clip.model_dir, "/models/b")

    def test_text_is_truncated_to_the_clip_context(self):
        self.clip.encode_text("x" * 200, "/models/clip")
        (ids,) = self.sessions["input_ids"][0].calls
        self.assertEqual(ids.shape, (1, 77))
        self.assertEqual(ids.dtype, np.int64)

    def test_unload(self):
        self.clip.encode_text("hello", "/models/a")
        self.clip.unload()
        self.assertFalse(self.clip.is_loaded)
        self.assertIsNone(self.clip.model_dir)


class PrepareImageTest(SimpleTestCase):
    def test_centre_crop_and_clip_normalisation(self):
        arr = prepare_image(Image.new("RGB", (448, 224), color=(255, 255, 255)))
        self.assertEqual(arr.shape, (3, 224, 224))
        expected = (1.0 - clip_module.IMAGE_MEAN) / clip_module.IMAGE_STD
        np.testing.assert_allclose(arr[:, 0, 0], expected, atol=1e-5)
