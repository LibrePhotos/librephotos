"""Tags and semantic-search embeddings with OpenCLIP ViT-B/32, on ONNX Runtime.

The model is LAION's ViT-B/32 trained on DataComp-XL
(``laion/CLIP-ViT-B-32-DataComp.XL-s13B-b90K``, MIT licence, 72.7 % ImageNet
zero-shot), exported by ``scripts/build_openclip_onnx.py`` as two graphs that
return the raw, unnormalised 512-d projections: ``visual.onnx`` (the image
tower) and ``textual.onnx`` (the text tower). It is the only image-text model
LibrePhotos runs: one image-tower run per photo gives its tags and its
semantic-search embedding.

Tagging embeds every tag of ``tags.txt`` once with the text tower (cached in
``tag_embeddings.npy`` next to the model) and keeps the tags that win the
softmax over all tags, scaled by the model's own logit scale. Raw CLIP cosines
are not probabilities: matches and noise sit close together and shift from
photo to photo, so a cut on the cosine keeps noise on a busy photo and drops
real tags on a plain one. The softmax turns the scores into "how much more
likely than the rest", which adapts to each photo.

The image tower's input is described by the bundle's ``preprocess.json``,
written at export from open_clip's pretrained config, so nothing here guesses
at it: a shortest-edge resize with torchvision's arithmetic (the long edge is
truncated, not rounded), a centre crop with rounded offsets, then the mean/std
normalisation. Tokens are the OpenAI CLIP BPE in open_clip's layout: start and
end of text, cut to the context length with the end token kept last, padded
with 0 (the text tower pools at the end token, so the padding is never read).
"""

import html
import json
import os

import numpy as np
from PIL import Image
from tokenizers import Tokenizer

from service.onnx_session import inference_session

MODEL_NAME = "openclip_vitb32"

# The sidecars never load Django, so the data root comes in as BASE_DATA (see
# api.services._service_environment). Unset, this is the Docker layout under /.
# OPENCLIP_MODEL_DIR points somewhere else entirely (a local export, a test).
MODEL_DIR_ENV = "OPENCLIP_MODEL_DIR"
DEFAULT_MODEL_DIR = os.path.join(
    os.environ.get("BASE_DATA", os.sep), "protected_media", "data_models", MODEL_NAME
)
MODEL_DIR = os.environ.get(MODEL_DIR_ENV) or DEFAULT_MODEL_DIR
VISUAL_PATH = os.path.join(MODEL_DIR, "visual.onnx")
TEXTUAL_PATH = os.path.join(MODEL_DIR, "textual.onnx")
TOKENIZER_PATH = os.path.join(MODEL_DIR, "tokenizer.json")
PREPROCESS_PATH = os.path.join(MODEL_DIR, "preprocess.json")
EMBEDDINGS_CACHE = os.path.join(MODEL_DIR, "tag_embeddings.npy")

TAGS_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)), "tags.txt")

PROMPT_TEMPLATE = "a photo of {tag}"
TEXT_BATCH_SIZE = 64
# Images per image-tower run when a request brings several (re-embedding).
IMAGE_BATCH_SIZE = 16
EMBEDDING_DIM = 512

START_TOKEN = "<|startoftext|>"
END_TOKEN = "<|endoftext|>"
PAD_TOKEN_ID = 0

# Calibrated on the e2e sample library to keep tags per photo where the
# previous tagger had them (scripts/calibrate_openclip.py).
DEFAULT_MIN_PROBABILITY = 0.0075
DEFAULT_MAX_TAGS = 10

_RESAMPLING = {"bicubic": Image.BICUBIC, "bilinear": Image.BILINEAR}


class PreprocessError(ValueError):
    """preprocess.json describes an input this code cannot produce."""


class Preprocess:
    """What the image tower expects, and the text tower's context and scale."""

    def __init__(
        self,
        size,
        mean,
        std,
        interpolation="bicubic",
        resize_mode="shortest",
        logit_scale=100.0,
        context_length=77,
    ):
        if resize_mode != "shortest":
            raise PreprocessError(f"unsupported resize_mode {resize_mode!r}")
        if interpolation not in _RESAMPLING:
            raise PreprocessError(f"unsupported interpolation {interpolation!r}")
        if len(mean) != 3 or len(std) != 3:
            raise PreprocessError("mean and std need one value per RGB channel")
        self.size = int(size)
        self.mean = np.array(mean, dtype=np.float32)
        self.std = np.array(std, dtype=np.float32)
        self.interpolation = interpolation
        self.resize_mode = resize_mode
        self.logit_scale = float(logit_scale)
        self.context_length = int(context_length)

    @classmethod
    def from_dict(cls, data):
        size = data["image_size"]
        if isinstance(size, (list, tuple)):
            if len(size) != 2 or size[0] != size[1]:
                raise PreprocessError(f"only square crops are supported, not {size}")
            size = size[0]
        return cls(
            size=size,
            mean=data["mean"],
            std=data["std"],
            interpolation=data.get("interpolation", "bicubic"),
            resize_mode=data.get("resize_mode", "shortest"),
            logit_scale=data["logit_scale"],
            context_length=data.get("context_length", 77),
        )

    @classmethod
    def from_file(cls, path=None):
        with open(path or PREPROCESS_PATH, encoding="utf-8") as f:
            return cls.from_dict(json.load(f))


def resized_size(width, height, size):
    """The shortest-edge resize of torchvision's ``Resize(int)``.

    The short edge becomes ``size`` and the long edge
    ``int(size * long / short)``: truncated, not rounded, as torchvision does.
    """
    if width <= height:
        return size, int(size * height / width)
    return int(size * width / height), size


def crop_box(width, height, size):
    """The centre crop of torchvision's ``CenterCrop``: offsets are rounded."""
    left = int(round((width - size) / 2.0))
    top = int(round((height - size) / 2.0))
    return left, top, left + size, top + size


def prepare_image(image, preprocess):
    """RGB, resize, centre crop, normalise: a (1, 3, size, size) float32 batch."""
    image = image.convert("RGB")
    size = preprocess.size
    width, height = resized_size(*image.size, size)
    image = image.resize((width, height), _RESAMPLING[preprocess.interpolation])
    image = image.crop(crop_box(width, height, size))

    arr = np.asarray(image, dtype=np.float32) / 255.0
    arr = (arr - preprocess.mean) / preprocess.std
    return np.ascontiguousarray(arr.transpose(2, 0, 1))[np.newaxis, :]


def _l2_normalize(embeddings):
    norms = np.linalg.norm(embeddings, axis=-1, keepdims=True)
    return embeddings / np.maximum(norms, 1e-8)


def _softmax(scores):
    shifted = scores - scores.max(axis=-1, keepdims=True)
    exp = np.exp(shifted)
    return exp / exp.sum(axis=-1, keepdims=True)


def _stale_cache_reason(cache, tag_count):
    """Why a cached tag-embedding array cannot be used, or None if it can."""
    if cache.ndim != 2:
        return f"cache has wrong shape {cache.shape}"
    if cache.shape[0] != tag_count:
        return f"cache has {cache.shape[0]} tags but tags.txt has {tag_count}"
    if cache.shape[1] != EMBEDDING_DIM:
        return f"cache has dim={cache.shape[1]}, not {EMBEDDING_DIM}"
    return None


class ClipTokenizer:
    """The CLIP BPE, laid out as open_clip's ``tokenize`` lays it out."""

    def __init__(self, path, context_length):
        self.tokenizer = Tokenizer.from_file(path)
        # Our own padding and truncation below; never the file's.
        self.tokenizer.no_padding()
        self.tokenizer.no_truncation()
        self.context_length = context_length
        self.start_id = self.tokenizer.token_to_id(START_TOKEN)
        self.end_id = self.tokenizer.token_to_id(END_TOKEN)

    def __call__(self, texts):
        """(n, context_length) int64 ids."""
        rows = []
        for text in texts:
            # open_clip unescapes HTML entities (twice) before the BPE; the
            # tokenizer file's normaliser does the rest of its cleaning.
            text = html.unescape(html.unescape(text))
            ids = list(self.tokenizer.encode(text).ids)
            # The tokenizer's post-processor adds both special tokens; add
            # whichever a file without one left out.
            if not ids or ids[0] != self.start_id:
                ids.insert(0, self.start_id)
            if ids[-1] != self.end_id:
                ids.append(self.end_id)
            if len(ids) > self.context_length:
                ids = ids[: self.context_length]
                ids[-1] = self.end_id
            rows.append(ids + [PAD_TOKEN_ID] * (self.context_length - len(ids)))
        return np.array(rows, dtype=np.int64)


class OpenCLIP:
    def __init__(self):
        self.vision_session = None
        self.text_session = None
        self.tokenizer = None
        self.preprocess = None
        self.tags = None
        self.tag_embeddings = None
        self.is_loaded = False

    def load(self):
        """Load the image tower, the tag list and the (cached) tag embeddings."""
        self._load_vision()
        with open(TAGS_FILE, "r", encoding="utf-8") as f:
            self.tags = [line.strip() for line in f if line.strip()]
        self._load_or_build_tag_embeddings()
        self.is_loaded = True

    def unload(self):
        self.vision_session = None
        self.text_session = None
        self.tokenizer = None
        self.preprocess = None
        self.tags = None
        self.tag_embeddings = None
        self.is_loaded = False

    def _load_preprocess(self):
        if self.preprocess is None:
            self.preprocess = Preprocess.from_file(PREPROCESS_PATH)
        return self.preprocess

    def _load_vision(self):
        self._load_preprocess()
        if self.vision_session is None:
            self.vision_session = inference_session(VISUAL_PATH)

    # ------------------------------------------------------------------ text
    def _tokenize(self, texts):
        if self.tokenizer is None:
            self.tokenizer = ClipTokenizer(
                TOKENIZER_PATH, self._load_preprocess().context_length
            )
        return self.tokenizer(texts)

    def _run_text(self, session, texts):
        input_name = session.get_inputs()[0].name
        (raw,) = session.run(None, {input_name: self._tokenize(texts)})
        return raw.astype(np.float32)

    def _build_tag_embeddings(self):
        """Embed every prompted tag with the text tower and cache the result."""
        print(f"{MODEL_NAME}: building tag embeddings (first run only)...")
        # A session of its own unless queries already loaded the text tower:
        # it is dropped again once the tags are embedded.
        session = self.text_session or inference_session(TEXTUAL_PATH)
        prompts = [PROMPT_TEMPLATE.format(tag=tag) for tag in self.tags]
        embeddings = [
            _l2_normalize(
                self._run_text(session, prompts[start : start + TEXT_BATCH_SIZE])
            )
            for start in range(0, len(prompts), TEXT_BATCH_SIZE)
        ]
        del session

        self.tag_embeddings = np.concatenate(embeddings, axis=0)
        os.makedirs(os.path.dirname(EMBEDDINGS_CACHE), exist_ok=True)
        np.save(EMBEDDINGS_CACHE, self.tag_embeddings)
        print(f"{MODEL_NAME}: cached {len(self.tags)} tag embeddings")

    def _load_or_build_tag_embeddings(self):
        if not os.path.exists(EMBEDDINGS_CACHE):
            self._build_tag_embeddings()
            return

        cache = np.load(EMBEDDINGS_CACHE)
        reason = _stale_cache_reason(cache, len(self.tags))
        if reason is not None:
            print(f"{MODEL_NAME}: {reason}, rebuilding...")
            os.remove(EMBEDDINGS_CACHE)
            self._build_tag_embeddings()
            return

        self.tag_embeddings = cache

    def embed_text_raw(self, text):
        """A search query through the text tower, unnormalised, shape (dim,).

        The text tower is a session of its own, loaded with the first query
        and kept until unload.
        """
        if self.text_session is None:
            self.text_session = inference_session(TEXTUAL_PATH)
        return self._run_text(self.text_session, [text])[0]

    # ----------------------------------------------------------------- image
    def _run_vision(self, pixel_values):
        self._load_vision()
        input_name = self.vision_session.get_inputs()[0].name
        (raw,) = self.vision_session.run(None, {input_name: pixel_values})
        return raw.astype(np.float32)

    def embed_image_raw(self, image_path):
        """The image tower's output as it is, shape (1, dim).

        Unnormalised, as semantic search stores it: the similarity index ranks
        by inner product, and the search thresholds are calibrated on these
        raw values.
        """
        preprocess = self._load_preprocess()
        with Image.open(image_path) as image:
            pixel_values = prepare_image(image, preprocess)
        return self._run_vision(pixel_values)

    def embed_images_raw(self, image_paths):
        """One raw embedding (dim,) per path, in order; None where unreadable.

        Keeping the slot of a bad image lets the caller line the results up
        with the photos it asked about. Readable images go through the image
        tower IMAGE_BATCH_SIZE at a time.
        """
        preprocess = self._load_preprocess()
        results = [None] * len(image_paths)
        pending = []
        for index, path in enumerate(image_paths):
            try:
                with Image.open(path) as image:
                    pending.append((index, prepare_image(image, preprocess)))
            except (OSError, ValueError) as error:
                # PIL.UnidentifiedImageError is an OSError; so is a missing file.
                print(f"{MODEL_NAME}: skipping unreadable image {path}: {error}")

        for start in range(0, len(pending), IMAGE_BATCH_SIZE):
            batch = pending[start : start + IMAGE_BATCH_SIZE]
            raw = self._run_vision(np.concatenate([pixels for _, pixels in batch]))
            for (index, _), embedding in zip(batch, raw):
                results[index] = embedding
        return results

    # ------------------------------------------------------------------ tags
    def tags_for(
        self,
        raw_embedding,
        threshold=DEFAULT_MIN_PROBABILITY,
        max_tags=DEFAULT_MAX_TAGS,
    ):
        """The most likely tags for a raw image embedding, most likely first.

        ``threshold`` is a probability under the softmax over all tags at the
        model's logit scale, not a raw cosine (see the module docstring).
        """
        if not self.is_loaded:
            self.load()
        image = _l2_normalize(
            np.asarray(raw_embedding, dtype=np.float32).reshape(1, -1)
        )
        similarities = (image @ self.tag_embeddings.T)[0]
        probabilities = _softmax(self.preprocess.logit_scale * similarities)

        tags = []
        for idx in np.argsort(probabilities)[::-1]:
            if probabilities[idx] < threshold or len(tags) >= max_tags:
                break
            tags.append(self.tags[idx])
        return tags

    def predict(
        self,
        image_path,
        threshold=DEFAULT_MIN_PROBABILITY,
        max_tags=DEFAULT_MAX_TAGS,
        with_embedding=False,
    ):
        """``{"tags": [...]}`` for a photo, most likely first; with
        ``with_embedding`` also ``"embedding"``, the raw image embedding of the
        same run, which semantic search stores: one image-tower run serves both.
        """
        if not self.is_loaded:
            self.load()
        raw = self.embed_image_raw(image_path)
        result = {"tags": self.tags_for(raw[0], threshold, max_tags)}
        if with_embedding:
            result["embedding"] = raw[0].tolist()
        return result
