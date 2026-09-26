"""Image captioning with Liquid AI's LFM2.5-VL-450M, on ONNX Runtime.

A small vision-language model: a SigLIP2 NaFlex image tower feeding a 450M
parameter LFM2 language model. Unlike a fixed captioner it takes a prompt, so
the caption can be steered with what LibrePhotos already knows about the
photo, a recognised person's name or the place it was taken.

The export (onnx-community/LFM2.5-VL-450M-ONNX) is three graphs: the vision
encoder (patches in, projected image tokens out), the token embedding, and a
merged decoder with a KV cache plus the short convolution state the LFM2
layers keep. Decoding is greedy.

Preprocessing follows transformers' Lfm2VlImageProcessor for the single-tile
case: smart-resize to a multiple of 32 within 64 to 256 image tokens,
normalise with mean/std 0.5, cut into 16x16 patches flattened as (ph, pw, C).
Large photos are always resized to one tile rather than split into several,
which keeps a caption at 256 image tokens at most: that is the setting the
model was benchmarked at, a thumbnail carries no detail a tiling would find,
and it bounds both the time and the memory a caption can take.
"""

import math
import os

import numpy as np
from PIL import Image
from tokenizers import Tokenizer

from service.onnx_session import inference_session

# The sidecars never load Django, so the data root comes in as BASE_DATA (see
# api.services._service_environment). Unset, this is the Docker layout under /.
MODELS_ROOT = os.path.join(
    os.environ.get("BASE_DATA", os.sep), "protected_media", "data_models"
)
MODEL_NAME = "lfm2_vl_450m"
MODEL_DIR = os.path.join(MODELS_ROOT, MODEL_NAME)

SESSION_FILES = {
    "vision": "vision_encoder_q4.onnx",
    "embed": "embed_tokens_q4.onnx",
    "decoder": "decoder_model_merged_q4.onnx",
}

PATCH_SIZE = 16
DOWNSAMPLE = 2
RESIZE_FACTOR = PATCH_SIZE * DOWNSAMPLE
MIN_IMAGE_TOKENS, MAX_IMAGE_TOKENS = 64, 256
MIN_PIXELS = MIN_IMAGE_TOKENS * RESIZE_FACTOR * RESIZE_FACTOR
MAX_PIXELS = MAX_IMAGE_TOKENS * RESIZE_FACTOR * RESIZE_FACTOR
IMAGE_MEAN = 0.5
IMAGE_STD = 0.5

# Special tokens of the LFM2 tokenizer.
BOS_TOKEN = "<|startoftext|>"
IMAGE_START, IMAGE_END, IMAGE_TOKEN = "<|image_start|>", "<|image_end|>", "<image>"
IMAGE_TOKEN_ID = 396
IM_END_ID = 7  # <|im_end|>, the end of an assistant turn

DEFAULT_PROMPT = "Describe this image in a short, natural image caption."
DEFAULT_MAX_NEW_TOKENS = 64


def smart_resize(height, width):
    """The (height, width) to resize to: multiples of 32 within the token budget."""
    h_bar = max(RESIZE_FACTOR, round(height / RESIZE_FACTOR) * RESIZE_FACTOR)
    w_bar = max(RESIZE_FACTOR, round(width / RESIZE_FACTOR) * RESIZE_FACTOR)
    if h_bar * w_bar > MAX_PIXELS:
        beta = math.sqrt(height * width / MAX_PIXELS)
        h_bar = max(
            RESIZE_FACTOR, math.floor(height / beta / RESIZE_FACTOR) * RESIZE_FACTOR
        )
        w_bar = max(
            RESIZE_FACTOR, math.floor(width / beta / RESIZE_FACTOR) * RESIZE_FACTOR
        )
    elif h_bar * w_bar < MIN_PIXELS:
        beta = math.sqrt(MIN_PIXELS / (height * width))
        h_bar = math.ceil(height * beta / RESIZE_FACTOR) * RESIZE_FACTOR
        w_bar = math.ceil(width * beta / RESIZE_FACTOR) * RESIZE_FACTOR
    return h_bar, w_bar


def prepare_image(image):
    """(pixel_values, spatial_shapes, pixel_attention_mask) for one image."""
    image = image.convert("RGB")
    width, height = image.size
    new_h, new_w = smart_resize(height, width)
    image = image.resize((new_w, new_h), Image.BILINEAR)

    arr = (np.asarray(image, dtype=np.float32) / 255.0 - IMAGE_MEAN) / IMAGE_STD
    patches_h, patches_w = new_h // PATCH_SIZE, new_w // PATCH_SIZE
    patches = (
        arr.reshape(patches_h, PATCH_SIZE, patches_w, PATCH_SIZE, 3)
        .transpose(0, 2, 1, 3, 4)
        .reshape(1, patches_h * patches_w, PATCH_SIZE * PATCH_SIZE * 3)
    )
    return (
        np.ascontiguousarray(patches, dtype=np.float32),
        np.array([[patches_h, patches_w]], dtype=np.int64),
        np.ones((1, patches_h * patches_w), dtype=np.int64),
    )


def clean_caption(text):
    """Strip the quotation marks the model likes to wrap a caption in."""
    text = text.strip()
    if len(text) >= 2 and text[0] == text[-1] and text[0] in "\"'":
        text = text[1:-1].strip()
    return text


class Lfm2VlCaptioner:
    def __init__(self, model_dir=MODEL_DIR):
        self.model_dir = model_dir
        self.sessions = None
        self.tokenizer = None
        self.is_loaded = False

    def load(self):
        self.sessions = {
            key: inference_session(os.path.join(self.model_dir, filename))
            for key, filename in SESSION_FILES.items()
        }
        self.tokenizer = Tokenizer.from_file(
            os.path.join(self.model_dir, "tokenizer.json")
        )
        decoder = self.sessions["decoder"]
        self.decoder_inputs = {i.name: i for i in decoder.get_inputs()}
        self.decoder_output_names = [o.name for o in decoder.get_outputs()]
        # The export keeps its cache in float16; a fp32 export would say so.
        any_kv = next(
            i
            for n, i in self.decoder_inputs.items()
            if n.startswith("past_key_values.")
        )
        self.cache_dtype = np.float16 if "float16" in any_kv.type else np.float32
        self.is_loaded = True

    def unload(self):
        self.sessions = None
        self.tokenizer = None
        self.is_loaded = False

    # -------------------------------------------------------------- pipeline
    def _embed(self, token_ids):
        return self.sessions["embed"].run(
            None, {"input_ids": np.asarray(token_ids, dtype=np.int64)}
        )[0]

    def _image_features(self, image_path):
        pixel_values, spatial_shapes, mask = prepare_image(Image.open(image_path))
        return self.sessions["vision"].run(
            None,
            {
                "pixel_values": pixel_values,
                "pixel_attention_mask": mask,
                "spatial_shapes": spatial_shapes,
            },
        )[0]  # (image_tokens, hidden)

    def _prompt_embeddings(self, image_features, prompt):
        """The chat-formatted prompt with the image tokens swapped in."""
        n_image = image_features.shape[0]
        text = (
            f"{BOS_TOKEN}<|im_start|>user\n"
            f"{IMAGE_START}{IMAGE_TOKEN * n_image}{IMAGE_END}{prompt}<|im_end|>\n"
            "<|im_start|>assistant\n"
        )
        ids = self.tokenizer.encode(text, add_special_tokens=False).ids
        embeds = self._embed([ids]).astype(np.float32)
        slots = [i for i, t in enumerate(ids) if t == IMAGE_TOKEN_ID]
        if len(slots) != n_image:
            raise RuntimeError(
                f"prompt carries {len(slots)} image slots for {n_image} image tokens"
            )
        embeds[0, slots, :] = image_features
        return embeds

    def _empty_cache(self):
        cache = {}
        for name, inp in self.decoder_inputs.items():
            if name.startswith("past_conv."):
                cache[name] = np.zeros(
                    (1, inp.shape[1], inp.shape[2]), self.cache_dtype
                )
            elif name.startswith("past_key_values."):
                cache[name] = np.zeros(
                    (1, inp.shape[1], 0, inp.shape[3]), self.cache_dtype
                )
        return cache

    def _decode(self, embeds, max_new_tokens):
        """Greedy decoding from the prompt embeddings; returns the generated ids."""
        decoder = self.sessions["decoder"]
        cache = self._empty_cache()
        total = embeds.shape[1]
        generated = []
        current = embeds

        for _ in range(max_new_tokens):
            feed = {
                "inputs_embeds": current,
                "attention_mask": np.ones((1, total), dtype=np.int64),
            }
            if "num_logits_to_keep" in self.decoder_inputs:
                feed["num_logits_to_keep"] = np.array(1, dtype=np.int64)
            feed.update(cache)
            outputs = dict(zip(self.decoder_output_names, decoder.run(None, feed)))

            for name, value in outputs.items():
                if name.startswith("present_conv."):
                    cache[name.replace("present_conv.", "past_conv.")] = value
                elif name.startswith("present."):
                    cache[name.replace("present.", "past_key_values.")] = value

            next_token = int(
                np.asarray(outputs["logits"][0, -1], dtype=np.float32).argmax()
            )
            if next_token == IM_END_ID:
                break
            generated.append(next_token)
            current = self._embed([[next_token]]).astype(np.float32)
            total += 1

        return generated

    def caption(self, image_path, prompt=None, max_new_tokens=DEFAULT_MAX_NEW_TOKENS):
        if not self.is_loaded:
            self.load()
        prompt = prompt or DEFAULT_PROMPT
        embeds = self._prompt_embeddings(self._image_features(image_path), prompt)
        token_ids = self._decode(embeds, max_new_tokens)
        return clean_caption(self.tokenizer.decode(token_ids, skip_special_tokens=True))
