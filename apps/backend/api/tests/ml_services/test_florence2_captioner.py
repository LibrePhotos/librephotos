"""Tests for ``service.image_captioning.florence2.Florence2Captioner``.

The four ONNX graphs are replaced by fakes that reproduce their interface:
input/output names, the KV-cache shapes the decoder advertises, and a
scripted sequence of argmax tokens. What is pinned:

  * The cache layout (layers, heads, head dim) is read off the decoder's
    ``past_key_values.*`` inputs rather than a config file.
  * Step 0 runs with ``use_cache_branch=False`` and empty caches; later
    steps pass ``True`` and feed back the decoder-side ``present.*`` outputs,
    while the encoder-side entries are kept from step 0.
  * Decoding is greedy, stops at EOS (id 2) or ``max_new_tokens``, and the
    EOS itself is not part of the caption.
  * The prompt embedded after the image features is the <CAPTION> task text.
"""

import os
import tempfile
from unittest.mock import MagicMock, patch

import numpy as np
from django.test import SimpleTestCase
from PIL import Image

from service.image_captioning import florence2 as florence2_module
from service.image_captioning.florence2 import Florence2Captioner, prepare_image

LAYERS, HEADS, HEAD_DIM, HIDDEN = 2, 3, 4, 12


class _IO:
    def __init__(self, name, shape):
        self.name = name
        self.shape = shape


def _io(name, shape):
    return _IO(name, shape)


class FakeVision:
    def get_inputs(self):
        return [_io("pixel_values", ["batch_size", 3, 768, 768])]

    def run(self, _o, feed):
        assert feed["pixel_values"].shape == (1, 3, 768, 768)
        return [np.zeros((1, 5, HIDDEN), np.float32)]


class FakeEmbed:
    def __init__(self):
        self.calls = []

    def run(self, _o, feed):
        ids = feed["input_ids"]
        self.calls.append(ids.tolist())
        out = np.zeros((ids.shape[0], ids.shape[1], HIDDEN), np.float32)
        out[..., 0] = ids
        return [out]


class FakeEncoder:
    def run(self, _o, feed):
        assert feed["inputs_embeds"].shape[1] == feed["attention_mask"].shape[1]
        return [feed["inputs_embeds"]]


class FakeDecoder:
    """Emits the scripted token ids one per step, then EOS forever."""

    def __init__(self, script):
        self.script = list(script)
        self.calls = []

    def get_inputs(self):
        names = [
            "encoder_attention_mask",
            "encoder_hidden_states",
            "inputs_embeds",
            "use_cache_branch",
        ]
        inputs = [_io(n, None) for n in names]
        for layer in range(LAYERS):
            for side in ("decoder", "encoder"):
                for kind in ("key", "value"):
                    inputs.append(
                        _io(
                            f"past_key_values.{layer}.{side}.{kind}",
                            ["batch_size", HEADS, "past_sequence_length", HEAD_DIM],
                        )
                    )
        return inputs

    def get_outputs(self):
        outputs = [_io("logits", None)]
        for layer in range(LAYERS):
            for side in ("decoder", "encoder"):
                for kind in ("key", "value"):
                    outputs.append(_io(f"present.{layer}.{side}.{kind}", None))
        return outputs

    def run(self, _o, feed):
        step = len(self.calls)
        self.calls.append(
            {k: (v.copy() if isinstance(v, np.ndarray) else v) for k, v in feed.items()}
        )
        token = self.script[step] if step < len(self.script) else 2
        logits = np.zeros((1, 1, 50), np.float32)
        logits[0, 0, token] = 1.0
        outs = [logits]
        for layer in range(LAYERS):
            for side in ("decoder", "encoder"):
                for _kind in ("key", "value"):
                    length = step + 1 if side == "decoder" else 5
                    outs.append(np.full((1, HEADS, length, HEAD_DIM), step, np.float32))
        return outs


class FakeTokenizer:
    def __init__(self):
        self.decoded = []

    def encode(self, text):
        assert text == florence2_module.CAPTION_PROMPT
        return MagicMock(ids=[0, 7, 8, 9, 2])

    def decode(self, ids, skip_special_tokens=True):
        self.decoded.append(list(ids))
        return " ".join(f"t{i}" for i in ids)


class Florence2CaptionerTest(SimpleTestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.decoder = FakeDecoder([11, 12, 13])
        self.embed = FakeEmbed()
        self.tokenizer = FakeTokenizer()

        def make_session(path, providers=None):
            self.assertEqual(providers, ["CPUExecutionProvider"])
            self.assertTrue(path.startswith(self.tmp.name))
            name = os.path.basename(path)
            return {
                "vision_encoder.onnx": FakeVision(),
                "embed_tokens.onnx": self.embed,
                "encoder_model.onnx": FakeEncoder(),
                "decoder_model_merged.onnx": self.decoder,
            }[name]

        for p in (
            patch.object(
                florence2_module.ort, "InferenceSession", side_effect=make_session
            ),
            patch.object(
                florence2_module,
                "Tokenizer",
                MagicMock(from_file=lambda _p: self.tokenizer),
            ),
        ):
            p.start()
            self.addCleanup(p.stop)

    def _caption(self, **kwargs):
        captioner = Florence2Captioner(self.tmp.name)
        with patch.object(
            florence2_module.Image, "open", return_value=Image.new("RGB", (640, 480))
        ):
            return captioner, captioner.caption("/photo.jpg", **kwargs)

    def test_cache_layout_comes_from_the_decoder_inputs(self):
        captioner = Florence2Captioner(self.tmp.name)
        captioner.load()
        self.assertEqual(
            (captioner.layers, captioner.heads, captioner.head_dim),
            (LAYERS, HEADS, HEAD_DIM),
        )

    def test_greedy_decoding_stops_at_eos_and_drops_it(self):
        _, caption = self._caption()
        self.assertEqual(caption, "t11 t12 t13")
        # 3 scripted tokens + the EOS step
        self.assertEqual(len(self.decoder.calls), 4)
        self.assertEqual(self.tokenizer.decoded, [[11, 12, 13]])

    def test_max_new_tokens_bounds_the_loop(self):
        _, caption = self._caption(max_new_tokens=2)
        self.assertEqual(caption, "t11 t12")
        self.assertEqual(len(self.decoder.calls), 2)

    def test_cache_branch_and_kv_cache_handoff(self):
        self._caption()
        first, second, third = self.decoder.calls[:3]

        self.assertFalse(bool(first["use_cache_branch"][0]))
        self.assertTrue(bool(second["use_cache_branch"][0]))
        # Step 0 sees empty caches.
        self.assertEqual(
            first["past_key_values.0.decoder.key"].shape, (1, HEADS, 0, HEAD_DIM)
        )
        # Later steps get the decoder cache the previous step produced ...
        self.assertEqual(
            second["past_key_values.0.decoder.key"].shape, (1, HEADS, 1, HEAD_DIM)
        )
        self.assertEqual(
            third["past_key_values.1.decoder.value"].shape, (1, HEADS, 2, HEAD_DIM)
        )
        self.assertEqual(
            float(third["past_key_values.1.decoder.value"][0, 0, 0, 0]), 1.0
        )
        # ... while the encoder cache stays the one from step 0.
        self.assertEqual(float(third["past_key_values.0.encoder.key"][0, 0, 0, 0]), 0.0)

    def test_decoder_is_fed_the_previous_token_starting_from_bos(self):
        self._caption()
        # First call embeds the prompt, then one call per decode step.
        self.assertEqual(self.embed.calls[0], [[0, 7, 8, 9, 2]])
        self.assertEqual(self.embed.calls[1:], [[[2]], [[11]], [[12]], [[13]]])

    def test_unload_forgets_the_sessions(self):
        captioner, _ = self._caption()
        self.assertTrue(captioner.is_loaded)
        captioner.unload()
        self.assertFalse(captioner.is_loaded)
        self.assertIsNone(captioner.sessions)


class PrepareImageTest(SimpleTestCase):
    def test_resizes_to_768_square_and_normalises(self):
        arr = prepare_image(Image.new("RGB", (100, 300), color=(255, 255, 255)))
        self.assertEqual(arr.shape, (1, 3, 768, 768))
        expected = (1.0 - florence2_module.IMAGE_MEAN) / florence2_module.IMAGE_STD
        np.testing.assert_allclose(arr[0, :, 0, 0], expected, atol=1e-5)


class ModelDirTest(SimpleTestCase):
    def test_model_dir_is_under_the_data_models_root(self):
        self.assertEqual(
            florence2_module.model_dir_for("florence2_base_int8"),
            os.path.join(florence2_module.MODELS_ROOT, "florence2_base_int8"),
        )
