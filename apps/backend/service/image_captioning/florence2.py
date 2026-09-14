"""Image captioning with Microsoft's Florence-2 (base, fine-tuned), on ONNX Runtime.

Florence-2 is an encoder-decoder model: a DaViT vision encoder turns the
photo into 577 image tokens, the task prompt is embedded and appended, a BART
encoder reads the lot, and a BART decoder writes the caption one token at a
time. The export from Hugging Face (onnx-community/Florence-2-base-ft) ships
that as four graphs, which is what the four sessions below correspond to.

The decoder graph is the "merged" export: a single graph that serves both the
first step (no past, ``use_cache_branch=False``) and every later step
(``use_cache_branch=True``, fed the key/value cache it produced last time).
The encoder-side cache entries only come out of the first step and are
carried along unchanged afterwards.

Decoding is greedy. Beam search buys little for one-sentence captions and
costs its width in decoder passes.
"""

import os

import numpy as np
import onnxruntime as ort
from PIL import Image
from tokenizers import Tokenizer

MODELS_ROOT = os.path.join("/", "protected_media", "data_models")

# The <CAPTION> task token expands to this prompt inside Florence2Processor.
CAPTION_PROMPT = "What does the image describe?"

IMAGE_SIZE = 768
IMAGE_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
IMAGE_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)

DECODER_START_TOKEN_ID = 2  # </s>, as in BART
EOS_TOKEN_ID = 2
DEFAULT_MAX_NEW_TOKENS = 40

SESSION_FILES = {
    "vision": "vision_encoder.onnx",
    "embed": "embed_tokens.onnx",
    "encoder": "encoder_model.onnx",
    "decoder": "decoder_model_merged.onnx",
}


def prepare_image(image, size=IMAGE_SIZE):
    """Plain resize to size x size (no crop), ImageNet-normalised NCHW float32."""
    image = image.convert("RGB").resize((size, size), Image.BICUBIC)
    arr = np.asarray(image, dtype=np.float32) / 255.0
    arr = (arr - IMAGE_MEAN) / IMAGE_STD
    return np.ascontiguousarray(arr.transpose(2, 0, 1))[np.newaxis, :]


def _cache_layout(decoder_session):
    """(layers, heads, head_dim) read off the decoder's past_key_values inputs."""
    layers = set()
    heads = head_dim = None
    for inp in decoder_session.get_inputs():
        if not inp.name.startswith("past_key_values."):
            continue
        layers.add(inp.name.split(".")[1])
        # shape is [batch, heads, past_len, head_dim]; the dims that matter
        # are concrete ints in the export.
        heads, head_dim = inp.shape[1], inp.shape[3]
    if not layers or not isinstance(heads, int) or not isinstance(head_dim, int):
        raise RuntimeError("decoder_model_merged.onnx has no usable KV-cache inputs")
    return len(layers), heads, head_dim


class Florence2Captioner:
    def __init__(self, model_dir):
        self.model_dir = model_dir
        self.sessions = None
        self.tokenizer = None
        self.is_loaded = False

    def load(self):
        self.sessions = {
            key: ort.InferenceSession(
                os.path.join(self.model_dir, filename),
                providers=["CPUExecutionProvider"],
            )
            for key, filename in SESSION_FILES.items()
        }
        self.tokenizer = Tokenizer.from_file(
            os.path.join(self.model_dir, "tokenizer.json")
        )
        self.layers, self.heads, self.head_dim = _cache_layout(self.sessions["decoder"])
        self.decoder_input_names = {
            i.name for i in self.sessions["decoder"].get_inputs()
        }
        self.decoder_output_names = [
            o.name for o in self.sessions["decoder"].get_outputs()
        ]
        self.is_loaded = True

    def unload(self):
        self.sessions = None
        self.tokenizer = None
        self.is_loaded = False

    # -------------------------------------------------------------- pipeline
    def _embed_tokens(self, token_ids):
        return self.sessions["embed"].run(
            None, {"input_ids": np.asarray(token_ids, dtype=np.int64)}
        )[0]

    def _encode(self, image_path):
        """Encoder hidden states and their attention mask for one photo."""
        pixel_values = prepare_image(Image.open(image_path))
        image_features = self.sessions["vision"].run(
            None, {"pixel_values": pixel_values}
        )[0]

        prompt_ids = self.tokenizer.encode(CAPTION_PROMPT).ids
        prompt_embeds = self._embed_tokens([prompt_ids])

        inputs_embeds = np.concatenate([image_features, prompt_embeds], axis=1).astype(
            np.float32
        )
        attention_mask = np.ones(inputs_embeds.shape[:2], dtype=np.int64)
        encoder_hidden_states = self.sessions["encoder"].run(
            None, {"inputs_embeds": inputs_embeds, "attention_mask": attention_mask}
        )[0]
        return encoder_hidden_states, attention_mask

    def _empty_cache(self):
        past = {}
        for layer in range(self.layers):
            for side in ("decoder", "encoder"):
                for kind in ("key", "value"):
                    past[f"past_key_values.{layer}.{side}.{kind}"] = np.zeros(
                        (1, self.heads, 0, self.head_dim), dtype=np.float32
                    )
        return past

    def _decode(self, encoder_hidden_states, attention_mask, max_new_tokens):
        """Greedy decoding; returns the generated ids without the start token."""
        decoder = self.sessions["decoder"]
        past = self._empty_cache()
        generated = []
        last_token = DECODER_START_TOKEN_ID

        for step in range(max_new_tokens):
            feed = {
                "encoder_attention_mask": attention_mask,
                "encoder_hidden_states": encoder_hidden_states,
                "inputs_embeds": self._embed_tokens([[last_token]]).astype(np.float32),
                "use_cache_branch": np.array([step > 0]),
            }
            feed.update(
                {k: v for k, v in past.items() if k in self.decoder_input_names}
            )
            outputs = dict(zip(self.decoder_output_names, decoder.run(None, feed)))

            for name, value in outputs.items():
                if not name.startswith("present."):
                    continue
                # Encoder-side cache is only meaningful from the first step;
                # later steps return placeholders for it.
                if ".decoder." in name or step == 0:
                    past[name.replace("present.", "past_key_values.")] = value

            last_token = int(outputs["logits"][0, -1].argmax())
            if last_token == EOS_TOKEN_ID:
                break
            generated.append(last_token)

        return generated

    def caption(self, image_path, max_new_tokens=DEFAULT_MAX_NEW_TOKENS):
        if not self.is_loaded:
            self.load()
        encoder_hidden_states, attention_mask = self._encode(image_path)
        token_ids = self._decode(encoder_hidden_states, attention_mask, max_new_tokens)
        return self.tokenizer.decode(token_ids, skip_special_tokens=True).strip()


def model_dir_for(model_name):
    return os.path.join(MODELS_ROOT, model_name)
