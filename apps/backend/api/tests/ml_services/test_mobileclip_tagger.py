"""Tests for ``service.tags.mobileclip.mobileclip.MobileCLIP``.

No model is ever loaded: ``ort.InferenceSession`` and the tokenizer are
replaced by fakes, the tag file by an in-memory one, and the embedding cache
lives in a temporary directory.

What is pinned:

  * Text prompts are padded to exactly 77 ids with the pad id 0, because the
    exported text tower only accepts that length.
  * Tags are cut on the softmax probability over all tags (logit scale 100),
    not on the raw cosine, and come back most-likely first, at most
    ``max_tags`` of them.
  * A cache with the wrong tag count is rebuilt; a good one is used as is.
  * Images are shortest-edge resized and centre cropped to 256 and scaled to
    0..1 with no mean/std normalisation.
"""

import os
import tempfile
from unittest.mock import MagicMock, patch

import numpy as np
from django.test import SimpleTestCase
from PIL import Image

from service.tags.mobileclip import mobileclip as mobileclip_module
from service.tags.mobileclip.mobileclip import MobileCLIP, prepare_image

MODULE = "service.tags.mobileclip.mobileclip"


class _IO:
    def __init__(self, name):
        self.name = name


class FakeSession:
    """Stands in for an ort.InferenceSession; records what it was fed."""

    def __init__(self, output, input_name):
        self.output = output
        self.input_name = input_name
        self.calls = []

    def get_inputs(self):
        return [_IO(self.input_name)]

    def run(self, _outputs, feed):
        self.calls.append(feed)
        value = self.output(feed) if callable(self.output) else self.output
        return [value]


class FakeTokenizer:
    def encode(self, text):
        # One id per character keeps lengths distinct and deterministic.
        return MagicMock(ids=[ord(c) for c in text])


def _unit(vectors):
    arr = np.array(vectors, dtype=np.float32)
    return arr / np.linalg.norm(arr, axis=-1, keepdims=True)


class MobileCLIPTaggerTest(SimpleTestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        tags_file = os.path.join(self.tmp.name, "tags.txt")
        with open(tags_file, "w", encoding="utf-8") as f:
            f.write("beach\n\ndog\n  cat  \n")
        cache = os.path.join(self.tmp.name, "cache", "tag_embeddings.npy")

        patches = [
            patch.object(mobileclip_module, "TAGS_FILE", tags_file),
            patch.object(mobileclip_module, "MOBILECLIP_EMBEDDINGS_CACHE", cache),
            patch.object(
                mobileclip_module,
                "Tokenizer",
                MagicMock(from_file=lambda _p: FakeTokenizer()),
            ),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        self.cache = cache

        # Text tower: three orthogonal directions, one per tag, so the image
        # tower can point at whichever tag the test wants.
        self.text_session = FakeSession(
            lambda feed: (
                np.eye(len(feed["input_ids"]), 4, dtype=np.float32)
                if len(feed["input_ids"]) == 3
                else np.ones((len(feed["input_ids"]), 4), np.float32)
            ),
            "input_ids",
        )
        self.vision_session = FakeSession(
            np.array([[0.9, 0.85, 0.0, 0.0]], np.float32), "pixel_values"
        )

        def make_session(path, providers=None):
            self.assertEqual(providers, ["CPUExecutionProvider"])
            return (
                self.text_session
                if path.endswith("text_model.onnx")
                else self.vision_session
            )

        p = patch.object(
            mobileclip_module.ort, "InferenceSession", side_effect=make_session
        )
        p.start()
        self.addCleanup(p.stop)

    def test_load_reads_tags_and_builds_cache(self):
        tagger = MobileCLIP()
        tagger.load()

        self.assertEqual(tagger.tags, ["beach", "dog", "cat"])
        self.assertTrue(tagger.is_loaded)
        self.assertTrue(os.path.exists(self.cache))
        self.assertEqual(tagger.tag_embeddings.shape, (3, 4))
        np.testing.assert_allclose(
            np.linalg.norm(tagger.tag_embeddings, axis=1), 1.0, atol=1e-6
        )

    def test_prompts_are_padded_to_the_fixed_context(self):
        tagger = MobileCLIP()
        tagger.load()

        (feed,) = self.text_session.calls
        ids = feed["input_ids"]
        self.assertEqual(ids.shape, (3, 77))
        self.assertEqual(ids.dtype, np.int64)
        # "a photo of beach" is 16 characters; the rest is pad id 0.
        self.assertEqual(int((ids[0] != 0).sum()), len("a photo of beach"))

    def test_good_cache_is_used_without_touching_the_text_tower(self):
        os.makedirs(os.path.dirname(self.cache))
        np.save(self.cache, _unit([[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]]))

        tagger = MobileCLIP()
        tagger.load()

        self.assertEqual(self.text_session.calls, [])
        self.assertEqual(tagger.tag_embeddings.shape, (3, 4))

    def test_cache_with_wrong_tag_count_is_rebuilt(self):
        os.makedirs(os.path.dirname(self.cache))
        np.save(self.cache, _unit([[1, 0, 0, 0], [0, 1, 0, 0]]))

        tagger = MobileCLIP()
        tagger.load()

        self.assertEqual(len(self.text_session.calls), 1)
        self.assertEqual(tagger.tag_embeddings.shape, (3, 4))

    def test_predict_cuts_on_probability_and_orders_by_likelihood(self):
        tagger = MobileCLIP()
        with patch.object(
            mobileclip_module.Image, "open", return_value=Image.new("RGB", (300, 200))
        ):
            result = tagger.predict("/photo.jpg", threshold=0.02, max_tags=10)

        # Cosines: beach 0.727, dog 0.687, cat 0. After the x100 softmax
        # dog sits at about 1.7 %, so a 2 % cut keeps beach alone ...
        self.assertEqual(result, {"tags": ["beach"]})

        with patch.object(
            mobileclip_module.Image, "open", return_value=Image.new("RGB", (300, 200))
        ):
            # ... a 1 % cut admits dog as well, most likely first, and
            # max_tags stops the list before cat could ever appear.
            self.assertEqual(
                tagger.predict("/photo.jpg", threshold=0.01, max_tags=2),
                {"tags": ["beach", "dog"]},
            )

    def test_predict_loads_lazily_and_feeds_a_256_crop(self):
        tagger = MobileCLIP()
        self.assertFalse(tagger.is_loaded)
        with patch.object(
            mobileclip_module.Image, "open", return_value=Image.new("RGB", (640, 480))
        ):
            tagger.predict("/photo.jpg")
        self.assertTrue(tagger.is_loaded)
        (feed,) = self.vision_session.calls
        self.assertEqual(feed["pixel_values"].shape, (1, 3, 256, 256))
        self.assertEqual(feed["pixel_values"].dtype, np.float32)


class PrepareImageTest(SimpleTestCase):
    def test_centre_crop_and_zero_one_range(self):
        img = Image.new("RGB", (512, 256), color=(255, 0, 0))
        arr = prepare_image(img)
        self.assertEqual(arr.shape, (1, 3, 256, 256))
        self.assertAlmostEqual(float(arr[0, 0].max()), 1.0)
        self.assertAlmostEqual(float(arr[0, 1].max()), 0.0)

    def test_small_images_are_upscaled_to_the_crop_size(self):
        arr = prepare_image(Image.new("L", (40, 60)))
        self.assertEqual(arr.shape, (1, 3, 256, 256))
