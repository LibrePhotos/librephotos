"""Tests for ``service.tags.openclip.openclip``: preprocessing, tokens, tagging.

No model is loaded: ``inference_session`` and the tokenizer are replaced by
fakes, ``preprocess.json`` and the tag file by temporary ones, and the
embedding cache lives in a temporary directory.

What is pinned:

  * Preprocessing matches open_clip's transform for the model exactly: the
    golden values below were printed by ``scripts/build_openclip_onnx.py
    --golden`` from open_clip's own transform (torchvision ``Resize`` to the
    short edge, ``CenterCrop``, ``ToTensor``, ``Normalize``), and the export's
    parity check measured a max pixel difference of 0 on 50 photos.
  * The geometry is torchvision's: the long edge is truncated, crop offsets
    are rounded.
  * Token ids are laid out as open_clip's ``tokenize``: start, text, end, cut
    to the context with the end token last, padded with 0; HTML entities are
    unescaped first.
  * Tags are cut on the softmax over all tags at the logit scale from
    ``preprocess.json``, most likely first, at most ``max_tags``.
  * The tag-embedding cache is rebuilt when its tag count or dimension is off.
  * The text tower is its own session, loaded with the first query.
"""

import json
import os
import tempfile
from unittest.mock import MagicMock, patch

import numpy as np
from django.test import SimpleTestCase
from PIL import Image

from service.tags.openclip import openclip as openclip_module
from service.tags.openclip.openclip import (
    ClipTokenizer,
    OpenCLIP,
    Preprocess,
    PreprocessError,
    crop_box,
    prepare_image,
    resized_size,
)

PREPROCESS = {
    "image_size": 224,
    "mean": [0.48145466, 0.4578275, 0.40821073],
    "std": [0.26862954, 0.26130258, 0.27577711],
    "interpolation": "bicubic",
    "resize_mode": "shortest",
    "context_length": 77,
    "logit_scale": 100.0,
}

# ((width, height), values at GOLDEN_PIXELS, per-channel sums), from
# open_clip's transform for ViT-B-32 / datacomp_xl_s13b_b90k.
GOLDEN_PIXELS = ((0, 0, 0), (1, 17, 203), (2, 111, 111), (0, 223, 5), (2, 64, 190))
GOLDEN = (
    (
        (320, 200),
        [0.587281, -1.256841, 2.074797, -1.456499, 1.676635],
        [3387.731, 6444.607, 22044.883],
    ),
    (
        (199, 301),
        [0.426698, 0.333983, 2.017917, -1.63168, 1.306913],
        [3556.474, 6880.553, 21145.977],
    ),
    (
        (100, 60),
        [0.193124, -1.181802, -0.840317, -0.814168, -0.243074],
        [-352.328, 5212.394, -39657.594],
    ),
    (
        (224, 224),
        [-1.792263, 0.093858, -1.48022, 1.010635, 2.131677],
        [3336.928, 6138.658, 15069.643],
    ),
)


def golden_image(width, height):
    """The deterministic image ``build_openclip_onnx.golden_image`` makes."""
    y, x = np.mgrid[0:height, 0:width]
    arr = np.stack(
        [(x * 7 + y * 3) % 256, (x * y) % 256, (x ^ y) % 256], axis=-1
    ).astype(np.uint8)
    return Image.fromarray(arr, "RGB")


class PreprocessParityTest(SimpleTestCase):
    def test_matches_open_clips_transform(self):
        preprocess = Preprocess.from_dict(PREPROCESS)
        for (width, height), values, sums in GOLDEN:
            with self.subTest(size=(width, height)):
                arr = prepare_image(golden_image(width, height), preprocess)
                self.assertEqual(arr.shape, (1, 3, 224, 224))
                self.assertEqual(arr.dtype, np.float32)
                got = [float(arr[0, c, y, x]) for c, y, x in GOLDEN_PIXELS]
                np.testing.assert_allclose(got, values, atol=1e-5)
                np.testing.assert_allclose(
                    [float(arr[0, c].sum(dtype=np.float64)) for c in range(3)],
                    sums,
                    rtol=1e-5,
                    atol=0.05,
                )

    def test_long_edge_is_truncated_not_rounded(self):
        # 224 * 333 / 200 = 372.96: torchvision makes it 372, round() 373.
        self.assertEqual(resized_size(333, 200, 224), (372, 224))
        self.assertEqual(resized_size(200, 333, 224), (224, 372))
        self.assertEqual(resized_size(224, 224, 224), (224, 224))

    def test_crop_offsets_are_rounded(self):
        self.assertEqual(crop_box(372, 224, 224), (74, 0, 298, 224))
        # (373 - 224) / 2 = 74.5 rounds to the even 74, as in torchvision.
        self.assertEqual(crop_box(373, 224, 224), (74, 0, 298, 224))
        self.assertEqual(crop_box(224, 375, 224), (0, 76, 224, 300))

    def test_small_and_grey_images_become_rgb_crops(self):
        preprocess = Preprocess.from_dict(PREPROCESS)
        arr = prepare_image(Image.new("L", (40, 60)), preprocess)
        self.assertEqual(arr.shape, (1, 3, 224, 224))

    def test_unsupported_preprocessing_is_refused(self):
        for change in (
            {"resize_mode": "longest"},
            {"interpolation": "nearest"},
            {"image_size": [224, 256]},
            {"mean": [0.5, 0.5]},
        ):
            with self.subTest(change=change), self.assertRaises(PreprocessError):
                Preprocess.from_dict({**PREPROCESS, **change})

    def test_square_size_as_a_pair_is_accepted(self):
        self.assertEqual(
            Preprocess.from_dict({**PREPROCESS, "image_size": [224, 224]}).size, 224
        )


class FakeEncoding:
    def __init__(self, ids):
        self.ids = ids


class FakeTokenizer:
    """One id per character, wrapped in start (1) and end (2) like the file's
    post-processor; ``bare`` leaves the special tokens out."""

    def __init__(self, bare=False):
        self.bare = bare
        self.seen = []

    def no_padding(self):
        pass

    def no_truncation(self):
        pass

    def token_to_id(self, token):
        return {openclip_module.START_TOKEN: 1, openclip_module.END_TOKEN: 2}[token]

    def encode(self, text):
        self.seen.append(text)
        body = [100 + ord(c) for c in text]
        return FakeEncoding(body if self.bare else [1, *body, 2])


def _tokenizer(fake, context=77):
    with patch.object(
        openclip_module, "Tokenizer", MagicMock(from_file=lambda _p: fake)
    ):
        return ClipTokenizer("tokenizer.json", context)


class ClipTokenizerTest(SimpleTestCase):
    def test_layout_is_open_clips(self):
        ids = _tokenizer(FakeTokenizer())(["ab"])
        self.assertEqual(ids.shape, (1, 77))
        self.assertEqual(ids.dtype, np.int64)
        self.assertEqual(list(ids[0, :5]), [1, 197, 198, 2, 0])
        self.assertEqual(int(ids[0, 4:].sum()), 0)

    def test_missing_special_tokens_are_added(self):
        ids = _tokenizer(FakeTokenizer(bare=True))(["ab"])
        self.assertEqual(list(ids[0, :4]), [1, 197, 198, 2])

    def test_long_text_is_cut_with_the_end_token_last(self):
        ids = _tokenizer(FakeTokenizer(), context=8)(["abcdefghijkl"])
        self.assertEqual(list(ids[0]), [1, 197, 198, 199, 200, 201, 202, 2])

    def test_html_entities_are_unescaped_like_open_clip(self):
        fake = FakeTokenizer()
        _tokenizer(fake)(["fish &amp;amp; chips"])
        self.assertEqual(fake.seen, ["fish & chips"])


class _IO:
    def __init__(self, name):
        self.name = name


class FakeSession:
    """Stands in for an onnxruntime InferenceSession; records what it was fed."""

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


def _unit(vectors):
    arr = np.array(vectors, dtype=np.float32)
    return arr / np.linalg.norm(arr, axis=-1, keepdims=True)


DIM = openclip_module.EMBEDDING_DIM


def _direction(*values):
    vector = np.zeros(DIM, np.float32)
    vector[: len(values)] = values
    return vector


class OpenCLIPTaggerTest(SimpleTestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        tags_file = os.path.join(self.tmp.name, "tags.txt")
        with open(tags_file, "w", encoding="utf-8") as f:
            f.write("beach\n\ndog\n  cat  \n")
        preprocess_file = os.path.join(self.tmp.name, "preprocess.json")
        with open(preprocess_file, "w", encoding="utf-8") as f:
            json.dump(PREPROCESS, f)
        self.cache = os.path.join(self.tmp.name, "cache", "tag_embeddings.npy")

        patches = [
            patch.object(openclip_module, "TAGS_FILE", tags_file),
            patch.object(openclip_module, "PREPROCESS_PATH", preprocess_file),
            patch.object(openclip_module, "EMBEDDINGS_CACHE", self.cache),
            patch.object(
                openclip_module,
                "Tokenizer",
                MagicMock(from_file=lambda _p: FakeTokenizer()),
            ),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

        # Text tower: one direction per tag (beach, dog, cat) for the three
        # tag prompts, all ones for anything else (a query).
        def text_output(feed):
            batch = len(feed["input_ids"])
            if batch == 3:
                return np.stack([_direction(1), _direction(0, 1), _direction(0, 0, 1)])
            return np.ones((batch, DIM), np.float32)

        self.text_session = FakeSession(text_output, "input_ids")
        self.vision_session = FakeSession(
            lambda feed: np.tile(_direction(9.0, 8.5), (len(feed["pixel_values"]), 1)),
            "pixel_values",
        )
        self.sessions_made = []

        def make_session(path):
            self.sessions_made.append(os.path.basename(path))
            return (
                self.text_session
                if path.endswith("textual.onnx")
                else self.vision_session
            )

        p = patch.object(openclip_module, "inference_session", side_effect=make_session)
        p.start()
        self.addCleanup(p.stop)

        p = patch.object(openclip_module.Image, "open", side_effect=self._open_image)
        p.start()
        self.addCleanup(p.stop)

    @staticmethod
    def _open_image(path):
        if "broken" in str(path):
            raise OSError("cannot identify image file")
        return Image.new("RGB", (300, 200))

    def test_load_reads_tags_and_builds_cache(self):
        tagger = OpenCLIP()
        tagger.load()

        self.assertEqual(tagger.tags, ["beach", "dog", "cat"])
        self.assertTrue(tagger.is_loaded)
        self.assertTrue(os.path.exists(self.cache))
        self.assertEqual(tagger.tag_embeddings.shape, (3, DIM))
        np.testing.assert_allclose(
            np.linalg.norm(tagger.tag_embeddings, axis=1), 1.0, atol=1e-6
        )
        (feed,) = self.text_session.calls
        self.assertEqual(feed["input_ids"].shape, (3, 77))
        # The tag-building session is not kept for queries.
        self.assertIsNone(tagger.text_session)

    def test_good_cache_is_used_without_touching_the_text_tower(self):
        os.makedirs(os.path.dirname(self.cache))
        np.save(self.cache, _unit(np.eye(3, DIM)))

        tagger = OpenCLIP()
        tagger.load()

        self.assertEqual(self.text_session.calls, [])
        self.assertNotIn("textual.onnx", self.sessions_made)

    def test_stale_caches_are_rebuilt(self):
        for stale in (np.eye(2, DIM), np.eye(3, 256)):
            with self.subTest(shape=stale.shape):
                os.makedirs(os.path.dirname(self.cache), exist_ok=True)
                np.save(self.cache, _unit(stale))
                self.text_session.calls.clear()

                tagger = OpenCLIP()
                tagger.load()

                self.assertEqual(len(self.text_session.calls), 1)
                self.assertEqual(tagger.tag_embeddings.shape, (3, DIM))

    def test_predict_cuts_on_probability_at_the_bundles_logit_scale(self):
        tagger = OpenCLIP()
        # Cosines: beach 0.727, dog 0.687, cat 0. At logit scale 100 dog
        # sits at about 1.7 %, so a 2 % cut keeps beach alone ...
        self.assertEqual(
            tagger.predict("/photo.jpg", threshold=0.02, max_tags=10),
            {"tags": ["beach"]},
        )
        # ... a 1 % cut admits dog as well, most likely first, and max_tags
        # stops the list before cat could ever appear.
        self.assertEqual(
            tagger.predict("/photo.jpg", threshold=0.01, max_tags=2),
            {"tags": ["beach", "dog"]},
        )

    def test_a_lower_logit_scale_spreads_the_probability(self):
        with open(openclip_module.PREPROCESS_PATH, "w", encoding="utf-8") as f:
            json.dump({**PREPROCESS, "logit_scale": 10.0}, f)
        tagger = OpenCLIP()
        # At scale 10 dog holds about 40 %, cat almost nothing.
        self.assertEqual(
            tagger.predict("/photo.jpg", threshold=0.2)["tags"], ["beach", "dog"]
        )

    def test_predict_feeds_one_224_crop_and_can_return_the_raw_embedding(self):
        tagger = OpenCLIP()
        result = tagger.predict("/photo.jpg", threshold=0.02, with_embedding=True)

        self.assertEqual(result["tags"], ["beach"])
        # Unnormalised, exactly the tower's output.
        np.testing.assert_allclose(result["embedding"][:3], [9.0, 8.5, 0.0])
        self.assertEqual(len(result["embedding"]), DIM)
        (feed,) = self.vision_session.calls
        self.assertEqual(feed["pixel_values"].shape, (1, 3, 224, 224))

    def test_images_are_embedded_in_batches_with_a_slot_per_path(self):
        tagger = OpenCLIP()
        paths = [f"/p{i}.jpg" for i in range(20)]
        paths[3] = "/broken.jpg"

        embeddings = tagger.embed_images_raw(paths)

        self.assertEqual(len(embeddings), 20)
        self.assertIsNone(embeddings[3])
        self.assertTrue(all(e is not None for i, e in enumerate(embeddings) if i != 3))
        self.assertEqual(
            [len(call["pixel_values"]) for call in self.vision_session.calls],
            [openclip_module.IMAGE_BATCH_SIZE, 19 - openclip_module.IMAGE_BATCH_SIZE],
        )
        # Embedding needs neither the tags nor the text tower.
        self.assertFalse(tagger.is_loaded)
        self.assertEqual(self.text_session.calls, [])

    def test_tags_for_an_embedding_of_a_batch(self):
        tagger = OpenCLIP()
        (embedding,) = tagger.embed_images_raw(["/p.jpg"])
        self.assertEqual(tagger.tags_for(embedding, threshold=0.02), ["beach"])
        # The default cut-off (0.75 %) admits dog at 1.7 % too.
        self.assertEqual(tagger.tags_for(embedding), ["beach", "dog"])

    def test_text_queries_use_their_own_session_and_keep_it(self):
        tagger = OpenCLIP()
        first = tagger.embed_text_raw("a dog")
        tagger.embed_text_raw("a cat")

        self.assertEqual(first.shape, (DIM,))
        np.testing.assert_allclose(first, 1.0)  # raw, not normalised
        self.assertEqual(self.sessions_made, ["textual.onnx"])
        self.assertEqual(
            [c["input_ids"].shape for c in self.text_session.calls], [(1, 77)] * 2
        )
        self.assertIs(tagger.text_session, self.text_session)
        tagger.unload()
        self.assertIsNone(tagger.text_session)
