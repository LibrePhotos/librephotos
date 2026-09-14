"""Zero-shot photo tagging with Apple's MobileCLIP-S2, run through ONNX Runtime.

Same idea as the SigLIP 2 tagger next door: embed every tag of ``tags.txt``
once with the text tower, embed each photo with the image tower, and keep the
tags whose embeddings sit closest to the photo's. MobileCLIP-S2 is the
lightweight option: about 125 ms per photo on a six-core desktop CPU and well
under 400 MB of RAM, which is the envelope Places365 used to fill, with a
free-text vocabulary instead of 365 fixed scene classes.

MobileCLIP is a CLIP model, so its raw cosine similarities are not
probabilities: matches land around 0.2 to 0.3 and unrelated tags around 0.1,
and the gap between them is small. Cutting on a raw cosine therefore keeps
noise on a busy photo and drops real tags on a plain one. The cut is made
instead on the softmax over all tags, scaled by CLIP's logit scale of 100,
which turns the scores into "how much more likely than the rest" and adapts
to each photo on its own.
"""

import os

import numpy as np
import onnxruntime as ort
from PIL import Image
from tokenizers import Tokenizer

MOBILECLIP_MODEL_DIR = os.path.join(
    "/", "protected_media", "data_models", "mobileclip_s2"
)
MOBILECLIP_VISION_PATH = os.path.join(MOBILECLIP_MODEL_DIR, "vision_model.onnx")
MOBILECLIP_TEXT_PATH = os.path.join(MOBILECLIP_MODEL_DIR, "text_model.onnx")
MOBILECLIP_TOKENIZER_PATH = os.path.join(MOBILECLIP_MODEL_DIR, "tokenizer.json")
MOBILECLIP_EMBEDDINGS_CACHE = os.path.join(MOBILECLIP_MODEL_DIR, "tag_embeddings.npy")

TAGS_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)), "tags.txt")

# The image tower takes a 256x256 crop of the shortest-edge-resized photo,
# scaled to 0..1 without mean/std normalisation (see the model's
# preprocessor_config.json). The text tower was exported with a fixed
# 77-token context, so every prompt is padded to exactly that length.
IMAGE_SIZE = 256
CONTEXT_LENGTH = 77
PAD_TOKEN_ID = 0
LOGIT_SCALE = 100.0
TEXT_BATCH_SIZE = 64
PROMPT_TEMPLATE = "a photo of {tag}"

DEFAULT_MIN_PROBABILITY = 0.02
DEFAULT_MAX_TAGS = 10


def _l2_normalize(embeddings):
    norms = np.linalg.norm(embeddings, axis=-1, keepdims=True)
    return embeddings / np.maximum(norms, 1e-8)


def _softmax(scores):
    shifted = scores - scores.max()
    exp = np.exp(shifted)
    return exp / exp.sum()


def _stale_cache_reason(cache, tag_count):
    """Why a cached tag-embedding array cannot be used, or None if it can."""
    if cache.ndim != 2:
        return f"cache has wrong shape {cache.shape}"
    if cache.shape[0] != tag_count:
        return f"cache has {cache.shape[0]} tags but tags.txt has {tag_count}"
    return None


def prepare_image(image, size=IMAGE_SIZE):
    """Shortest-edge resize, centre crop, scale to 0..1, NCHW float32."""
    image = image.convert("RGB")
    width, height = image.size
    scale = size / min(width, height)
    image = image.resize(
        (max(size, round(width * scale)), max(size, round(height * scale))),
        Image.BILINEAR,
    )
    width, height = image.size
    left = (width - size) // 2
    top = (height - size) // 2
    image = image.crop((left, top, left + size, top + size))

    arr = np.asarray(image, dtype=np.float32) / 255.0
    return np.ascontiguousarray(arr.transpose(2, 0, 1))[np.newaxis, :]


class MobileCLIP:
    def __init__(self):
        self.vision_session = None
        self.tokenizer = None
        self.tags = None
        self.tag_embeddings = None
        self.is_loaded = False

    def load(self):
        """Load the image tower, the tag list and the (cached) tag embeddings."""
        self.vision_session = ort.InferenceSession(
            MOBILECLIP_VISION_PATH, providers=["CPUExecutionProvider"]
        )

        with open(TAGS_FILE, "r", encoding="utf-8") as f:
            self.tags = [line.strip() for line in f if line.strip()]

        self._load_or_build_tag_embeddings()
        self.is_loaded = True

    def unload(self):
        self.vision_session = None
        self.tokenizer = None
        self.tags = None
        self.tag_embeddings = None
        self.is_loaded = False

    # ------------------------------------------------------------------ text
    def _load_tokenizer(self):
        if self.tokenizer is None:
            self.tokenizer = Tokenizer.from_file(MOBILECLIP_TOKENIZER_PATH)

    def _tokenize(self, texts):
        """CLIP BPE ids padded to the fixed context length: (n, 77) int64."""
        self._load_tokenizer()
        rows = []
        for text in texts:
            ids = self.tokenizer.encode(text).ids[:CONTEXT_LENGTH]
            rows.append(ids + [PAD_TOKEN_ID] * (CONTEXT_LENGTH - len(ids)))
        return np.array(rows, dtype=np.int64)

    def _build_tag_embeddings(self):
        """Embed every prompted tag with the text tower and cache the result."""
        print("mobileclip: building tag embeddings (first run only)...")
        text_session = ort.InferenceSession(
            MOBILECLIP_TEXT_PATH, providers=["CPUExecutionProvider"]
        )
        input_name = text_session.get_inputs()[0].name
        prompts = [PROMPT_TEMPLATE.format(tag=tag) for tag in self.tags]

        embeddings = []
        for start in range(0, len(prompts), TEXT_BATCH_SIZE):
            batch = prompts[start : start + TEXT_BATCH_SIZE]
            (raw,) = text_session.run(None, {input_name: self._tokenize(batch)})
            embeddings.append(_l2_normalize(raw))
        del text_session

        self.tag_embeddings = np.concatenate(embeddings, axis=0)
        os.makedirs(os.path.dirname(MOBILECLIP_EMBEDDINGS_CACHE), exist_ok=True)
        np.save(MOBILECLIP_EMBEDDINGS_CACHE, self.tag_embeddings)
        print(f"mobileclip: cached {len(self.tags)} tag embeddings")

    def _load_or_build_tag_embeddings(self):
        if not os.path.exists(MOBILECLIP_EMBEDDINGS_CACHE):
            self._build_tag_embeddings()
            return

        cache = np.load(MOBILECLIP_EMBEDDINGS_CACHE)
        reason = _stale_cache_reason(cache, len(self.tags))
        if reason is not None:
            print(f"mobileclip: {reason}, rebuilding...")
            os.remove(MOBILECLIP_EMBEDDINGS_CACHE)
            self._build_tag_embeddings()
            return

        self.tag_embeddings = cache

    # ----------------------------------------------------------------- image
    def embed_image(self, image_path):
        """L2-normalised image embedding, shape (1, dim)."""
        pixel_values = prepare_image(Image.open(image_path))
        input_name = self.vision_session.get_inputs()[0].name
        (raw,) = self.vision_session.run(None, {input_name: pixel_values})
        return _l2_normalize(raw)

    def predict(
        self, image_path, threshold=DEFAULT_MIN_PROBABILITY, max_tags=DEFAULT_MAX_TAGS
    ):
        """The most likely tags for a photo.

        ``threshold`` is a probability under the softmax over all tags, not a
        raw cosine similarity (see the module docstring). Returns
        ``{"tags": [...]}`` ordered from most to least likely.
        """
        if not self.is_loaded:
            self.load()

        image_embedding = self.embed_image(image_path)
        similarities = (image_embedding @ self.tag_embeddings.T)[0]
        probabilities = _softmax(LOGIT_SCALE * similarities)

        return {"tags": self._top_tags(probabilities, threshold, max_tags)}

    def _top_tags(self, probabilities, threshold, max_tags):
        tags = []
        for idx in np.argsort(probabilities)[::-1]:
            if probabilities[idx] < threshold or len(tags) >= max_tags:
                break
            tags.append(self.tags[idx])
        return tags
