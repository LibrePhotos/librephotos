"""Tests for ``service.image_captioning.lfm2_vl.Lfm2VlCaptioner``.

The three ONNX graphs and the tokenizer are replaced by fakes that reproduce
their interface. What is pinned:

  * Preprocessing: smart-resize to multiples of 32 inside the 64 to 256 image
    token budget, 16x16 patches flattened as (ph, pw, C), spatial shape and
    an all-ones patch mask.
  * The prompt is the LFM2 chat format with one ``<image>`` placeholder per
    image token the vision tower returned, and those slots receive the image
    features.
  * The decoder is driven one token at a time with the conv and key/value
    caches fed back, stops at ``<|im_end|>``, and the caption loses the
    quotation marks the model likes to add.
"""

import os
import re
import tempfile
from unittest.mock import MagicMock, patch

import numpy as np
from django.test import SimpleTestCase
from PIL import Image

from service.image_captioning import lfm2_vl as lfm_module
from service.image_captioning.lfm2_vl import (
    Lfm2VlCaptioner,
    clean_caption,
    prepare_image,
    smart_resize,
)

HIDDEN = 8
SPECIAL = {
    "<|startoftext|>": 1,
    "<|im_start|>": 6,
    "<|im_end|>": 7,
    "<image>": 396,
    "<|image_start|>": 498,
    "<|image_end|>": 499,
}


class _IO:
    def __init__(self, name, shape, type_="tensor(float16)"):
        self.name = name
        self.shape = shape
        self.type = type_


class FakeVision:
    def __init__(self, n_tokens):
        self.n_tokens = n_tokens
        self.feeds = []

    def run(self, _o, feed):
        self.feeds.append(feed)
        feats = np.zeros((self.n_tokens, HIDDEN), np.float32)
        feats[:, 0] = 1.0  # marker so the slot substitution is checkable
        return [feats]


class FakeEmbed:
    def __init__(self):
        self.calls = []

    def run(self, _o, feed):
        ids = feed["input_ids"]
        self.calls.append(ids.tolist())
        out = np.zeros((ids.shape[0], ids.shape[1], HIDDEN), np.float32)
        out[..., 1] = ids
        return [out]


class FakeDecoder:
    """Two conv layers and two attention layers; emits a scripted token per step."""

    def __init__(self, script):
        self.script = list(script)
        self.calls = []

    def get_inputs(self):
        return [
            _IO(
                "inputs_embeds",
                ["batch_size", "sequence_length", HIDDEN],
                "tensor(float)",
            ),
            _IO(
                "attention_mask",
                ["batch_size", "total_sequence_length"],
                "tensor(int64)",
            ),
            _IO("num_logits_to_keep", [], "tensor(int64)"),
            _IO("past_conv.0", ["batch_size", HIDDEN, 3]),
            _IO("past_conv.1", ["batch_size", HIDDEN, 3]),
            _IO("past_key_values.2.key", ["batch_size", 2, "past_sequence_length", 4]),
            _IO(
                "past_key_values.2.value", ["batch_size", 2, "past_sequence_length", 4]
            ),
        ]

    def get_outputs(self):
        return [
            _IO("logits", None),
            _IO("present_conv.0", None),
            _IO("present_conv.1", None),
            _IO("present.2.key", None),
            _IO("present.2.value", None),
        ]

    def run(self, _o, feed):
        step = len(self.calls)
        self.calls.append(
            {k: (v.copy() if isinstance(v, np.ndarray) else v) for k, v in feed.items()}
        )
        token = self.script[step] if step < len(self.script) else 7
        logits = np.zeros((1, 1, 500), np.float16)
        logits[0, 0, token] = 1.0
        past_len = (
            feed["past_key_values.2.key"].shape[2] + feed["inputs_embeds"].shape[1]
        )
        return [
            logits,
            np.full((1, HIDDEN, 3), step, np.float16),
            np.full((1, HIDDEN, 3), step, np.float16),
            np.zeros((1, 2, past_len, 4), np.float16),
            np.zeros((1, 2, past_len, 4), np.float16),
        ]


class FakeTokenizer:
    """Special tokens by table, everything else one id per character."""

    def __init__(self):
        self.decoded = []

    def encode(self, text, add_special_tokens=False):
        pattern = "|".join(re.escape(s) for s in SPECIAL)
        ids = []
        for part in re.split(f"({pattern})", text):
            if part in SPECIAL:
                ids.append(SPECIAL[part])
            else:
                ids.extend(ord(c) for c in part)
        return MagicMock(ids=ids)

    def decode(self, ids, skip_special_tokens=True):
        self.decoded.append(list(ids))
        return "".join(chr(i) for i in ids)


class Lfm2VlCaptionerTest(SimpleTestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.vision = FakeVision(n_tokens=3)
        self.embed = FakeEmbed()
        self.decoder = FakeDecoder([ord(c) for c in '"a cat"'])
        self.tokenizer = FakeTokenizer()

        def make_session(path, providers=None):
            self.assertEqual(providers, ["CPUExecutionProvider"])
            self.assertTrue(path.startswith(self.tmp.name))
            return {
                "vision_encoder_q4f16.onnx": self.vision,
                "embed_tokens_q4f16.onnx": self.embed,
                "decoder_model_merged_q4f16.onnx": self.decoder,
            }[os.path.basename(path)]

        for p in (
            patch.object(lfm_module.ort, "InferenceSession", side_effect=make_session),
            patch.object(
                lfm_module, "Tokenizer", MagicMock(from_file=lambda _p: self.tokenizer)
            ),
            patch.object(
                lfm_module.Image, "open", return_value=Image.new("RGB", (640, 480))
            ),
        ):
            p.start()
            self.addCleanup(p.stop)

    def test_caption_is_decoded_greedily_and_cleaned(self):
        captioner = Lfm2VlCaptioner(self.tmp.name)
        self.assertEqual(captioner.caption("/photo.jpg"), "a cat")
        # 7 scripted characters + the <|im_end|> step
        self.assertEqual(len(self.decoder.calls), 8)
        self.assertTrue(captioner.is_loaded)

    def test_default_prompt_and_custom_prompt_reach_the_tokenizer(self):
        captioner = Lfm2VlCaptioner(self.tmp.name)
        captioner.caption("/photo.jpg")
        prompt_ids = self.embed.calls[0][0]
        text = "".join(
            chr(i)
            for i in prompt_ids
            if i > 1000 or 32 <= i < 500 and i not in SPECIAL.values()
        )
        self.assertIn(lfm_module.DEFAULT_PROMPT, text)

        self.embed.calls.clear()
        captioner.caption("/photo.jpg", prompt="Who is this?")
        text = "".join(
            chr(i)
            for i in self.embed.calls[0][0]
            if 32 <= i < 500 and i not in SPECIAL.values()
        )
        self.assertIn("Who is this?", text)
        self.assertNotIn(lfm_module.DEFAULT_PROMPT, text)

    def test_image_features_fill_one_slot_per_token(self):
        captioner = Lfm2VlCaptioner(self.tmp.name)
        captioner.caption("/photo.jpg")
        prompt_ids = self.embed.calls[0][0]
        self.assertEqual(prompt_ids.count(396), 3)
        # The <image> slots sit between image_start and image_end.
        start, end = prompt_ids.index(498), prompt_ids.index(499)
        self.assertEqual(prompt_ids[start + 1 : end], [396, 396, 396])
        first = self.decoder.calls[0]["inputs_embeds"]
        self.assertTrue((first[0, start + 1 : end, 0] == 1.0).all())
        self.assertEqual(first[0, start, 0], 0.0)

    def test_vision_tower_gets_patches_shape_and_mask(self):
        Lfm2VlCaptioner(self.tmp.name).caption("/photo.jpg")
        (feed,) = self.vision.feeds
        # 640x480 is already a multiple of 32 but over the 256-token budget
        # (300 tokens), so it is scaled down to 576x416 = 36x26 patches,
        # which the encoder pools to 18x13 = 234 image tokens.
        self.assertEqual(feed["spatial_shapes"].tolist(), [[26, 36]])
        self.assertEqual(feed["pixel_values"].shape, (1, 26 * 36, 768))
        self.assertEqual(feed["pixel_attention_mask"].shape, (1, 26 * 36))
        self.assertEqual(feed["pixel_values"].dtype, np.float32)

    def test_caches_are_fed_back_and_grow(self):
        Lfm2VlCaptioner(self.tmp.name).caption("/photo.jpg")
        first, second, third = self.decoder.calls[:3]
        self.assertEqual(first["past_key_values.2.key"].shape[2], 0)
        self.assertEqual(first["past_conv.0"].dtype, np.float16)
        self.assertEqual(
            second["past_key_values.2.key"].shape[2], first["inputs_embeds"].shape[1]
        )
        self.assertEqual(
            third["past_key_values.2.key"].shape[2], first["inputs_embeds"].shape[1] + 1
        )
        self.assertEqual(float(third["past_conv.1"][0, 0, 0]), 1.0)
        self.assertEqual(int(second["num_logits_to_keep"]), 1)
        self.assertEqual(
            second["attention_mask"].shape[1], first["inputs_embeds"].shape[1] + 1
        )

    def test_unload(self):
        captioner = Lfm2VlCaptioner(self.tmp.name)
        captioner.caption("/photo.jpg")
        captioner.unload()
        self.assertFalse(captioner.is_loaded)
        self.assertIsNone(captioner.sessions)


class PreprocessingTest(SimpleTestCase):
    def test_smart_resize_keeps_within_the_token_budget(self):
        self.assertEqual(smart_resize(480, 640), (416, 576))  # 300 -> 234 tokens
        self.assertEqual(smart_resize(100, 100), (256, 256))  # up to the 64-token floor
        h, w = smart_resize(3000, 4000)
        self.assertLessEqual(h * w, lfm_module.MAX_PIXELS)
        self.assertEqual((h % 32, w % 32), (0, 0))

    def test_patches_are_flattened_ph_pw_c(self):
        img = Image.new("RGB", (256, 256), color=(255, 0, 0))
        pv, shapes, mask = prepare_image(img)
        self.assertEqual(shapes.tolist(), [[16, 16]])
        self.assertEqual(pv.shape, (1, 256, 768))
        # every patch: R=1.0, G=B=-1.0 after mean/std 0.5, in (ph, pw, C) order
        self.assertAlmostEqual(float(pv[0, 0, 0]), 1.0)
        self.assertAlmostEqual(float(pv[0, 0, 1]), -1.0)
        self.assertAlmostEqual(float(pv[0, 0, 2]), -1.0)
        self.assertEqual(mask.sum(), 256)

    def test_clean_caption_strips_matching_quotes_only(self):
        self.assertEqual(clean_caption('"Grace at the lake."'), "Grace at the lake.")
        self.assertEqual(clean_caption("  'a dog'  "), "a dog")
        self.assertEqual(clean_caption('"unbalanced'), '"unbalanced')
        self.assertEqual(clean_caption("plain"), "plain")
