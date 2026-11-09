"""Tags and semantic-search embeddings with OpenCLIP ViT-B/32, on ONNX Runtime.

The model is LAION's ViT-B/32 trained on DataComp-XL
(``laion/CLIP-ViT-B-32-DataComp.XL-s13B-b90K``, MIT licence, 72.7 % ImageNet
zero-shot), exported by ``scripts/build_openclip_onnx.py`` as two graphs that
return the raw, unnormalised 512-d projections: ``visual.onnx`` (the image
tower) and ``textual.onnx`` (the text tower). It is the only image-text model
LibrePhotos runs: one image-tower run per photo gives its tags and its
semantic-search embedding.

Tagging embeds every thing of ``tags.txt`` once with the text tower (cached
in ``tag_embeddings.npy`` next to the model, with the sha256 of every prompt in
``tag_embeddings.sha256``, so a renamed, reordered or re-worded thing rebuilds
it). A thing's embedding is the mean of its prompts: the ``PROMPT_TEMPLATES``
ensemble around its name, or the prompts its line spells out
(``receipt = a photo of a printed paper receipt | ...``) where the bare word is
ambiguous ("glasses", "pan") or too weak a cue (document types, events).

A photo's things are the ones that win the softmax over all things, scaled by
the model's own logit scale. Raw CLIP cosines are not probabilities: matches
and noise sit close together and shift from photo to photo, so a cut on the
cosine keeps noise on a busy photo and drops real things on a plain one. The
softmax turns the scores into "how much more likely than the rest", which
adapts to each photo.

How sure the model has to be depends on the kind of thing, so ``tags.txt`` is
split into sections (``## activity max=1 min=0.5``), each with its own minimum
probability and its own cap per photo. People and photo types are reliable at
a few percent; activities, sports and plants are guessed from loose cues and
need near certainty; a cap of one scene stops "locker room, elevator, storage
room" on one hotel safe. The values were chosen on a judged sample of a real
library, every proposed thing graded good, vague or wrong by looking at the
photo (``tags.txt`` has the numbers).

The image tower's input is described by the bundle's ``preprocess.json``,
written at export from open_clip's pretrained config, so nothing here guesses
at it: a shortest-edge resize with torchvision's arithmetic (the long edge is
truncated, not rounded), a centre crop with rounded offsets, then the mean/std
normalisation. Tokens are the OpenAI CLIP BPE in open_clip's layout: start and
end of text, cut to the context length with the end token kept last, padded
with 0 (the text tower pools at the end token, so the padding is never read).
"""

from __future__ import annotations

import hashlib
import html
import json
import logging
import os
from collections import Counter
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Any

import numpy as np
import numpy.typing as npt
import onnxruntime as ort
from PIL import Image
from tokenizers import Tokenizer

from librephotos.env import data_models_root, env_str
from service.onnx_session import inference_session

# The tags sidecar's logger, which service/tags/main.py points at stdout through
# service._common.logger. Not that helper itself: scripts/build_openclip_onnx.py
# imports this module in a venv without Flask.
logger = logging.getLogger("tags")

MODEL_NAME = "openclip_vitb32"

# OPENCLIP_MODEL_DIR points somewhere else entirely (a local export, a test).
MODEL_DIR_ENV = "OPENCLIP_MODEL_DIR"
DEFAULT_MODEL_DIR = os.path.join(data_models_root(), MODEL_NAME)
MODEL_DIR = env_str(MODEL_DIR_ENV) or DEFAULT_MODEL_DIR
VISUAL_PATH = os.path.join(MODEL_DIR, "visual.onnx")
TEXTUAL_PATH = os.path.join(MODEL_DIR, "textual.onnx")
TOKENIZER_PATH = os.path.join(MODEL_DIR, "tokenizer.json")
PREPROCESS_PATH = os.path.join(MODEL_DIR, "preprocess.json")
EMBEDDINGS_CACHE = os.path.join(MODEL_DIR, "tag_embeddings.npy")

TAGS_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)), "tags.txt")
# The admin's own words, appended to tags.txt (#2764): custom_tags.txt in the
# model folder, or the file OPENCLIP_CUSTOM_TAGS names. Read on every load, so
# a change applies when the sidecar loads the model again.
CUSTOM_TAGS_ENV = "OPENCLIP_CUSTOM_TAGS"
DEFAULT_CUSTOM_TAGS_FILE = os.path.join(MODEL_DIR, "custom_tags.txt")
CUSTOM_TAGS_FILE = env_str(CUSTOM_TAGS_ENV) or DEFAULT_CUSTOM_TAGS_FILE

# The prompts of a thing that spells out none: averaging the embeddings of
# several phrasings is steadier than any one of them.
PROMPT_TEMPLATES = (
    "a photo of {tag}.",
    "a picture of {tag}.",
    "an image of {tag}.",
    "a close-up photo of {tag}.",
    "a cropped photo of {tag}.",
    "a good photo of {tag}.",
    "a bright photo of {tag}.",
    "a dark photo of {tag}.",
)
TEXT_BATCH_SIZE = 64
# Images per image-tower run when a request brings several (re-embedding).
IMAGE_BATCH_SIZE = 16
EMBEDDING_DIM = 512

START_TOKEN = "<|startoftext|>"
END_TOKEN = "<|endoftext|>"
PAD_TOKEN_ID = 0

# A floor under every section's own minimum, and the most things per photo.
DEFAULT_MIN_PROBABILITY = 0.005
DEFAULT_MAX_TAGS = 5
# The section of a thing listed before any "## " line: the admin's custom
# words, unless their file starts sections of its own.
OTHER_SECTION = "other"
OTHER_SECTION_MAX = 2
OTHER_SECTION_MIN = 0.03

_RESAMPLING = {
    "bicubic": Image.Resampling.BICUBIC,
    "bilinear": Image.Resampling.BILINEAR,
}


class PreprocessError(ValueError):
    """preprocess.json describes an input this code cannot produce."""


class Preprocess:
    """What the image tower expects, and the text tower's context and scale."""

    def __init__(
        self,
        size: int,
        mean: Sequence[float],
        std: Sequence[float],
        interpolation: str = "bicubic",
        resize_mode: str = "shortest",
        logit_scale: float = 100.0,
        context_length: int = 77,
    ) -> None:
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
    def from_dict(cls, data: dict[str, Any]) -> Preprocess:
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
    def from_file(cls, path: str | None = None) -> Preprocess:
        with open(path or PREPROCESS_PATH, encoding="utf-8") as f:
            return cls.from_dict(json.load(f))


def resized_size(width: int, height: int, size: int) -> tuple[int, int]:
    """The shortest-edge resize of torchvision's ``Resize(int)``.

    The short edge becomes ``size`` and the long edge
    ``int(size * long / short)``: truncated, not rounded, as torchvision does.
    """
    if width <= height:
        return size, int(size * height / width)
    return int(size * width / height), size


def crop_box(width: int, height: int, size: int) -> tuple[int, int, int, int]:
    """The centre crop of torchvision's ``CenterCrop``: offsets are rounded."""
    left = int(round((width - size) / 2.0))
    top = int(round((height - size) / 2.0))
    return left, top, left + size, top + size


def prepare_image(
    image: Image.Image, preprocess: Preprocess
) -> npt.NDArray[np.float32]:
    """RGB, resize, centre crop, normalise: a (1, 3, size, size) float32 batch."""
    image = image.convert("RGB")
    size = preprocess.size
    width, height = resized_size(*image.size, size)
    image = image.resize((width, height), _RESAMPLING[preprocess.interpolation])
    image = image.crop(crop_box(width, height, size))

    arr = np.asarray(image, dtype=np.float32) / 255.0
    arr = (arr - preprocess.mean) / preprocess.std
    return np.ascontiguousarray(arr.transpose(2, 0, 1))[np.newaxis, :]


def _l2_normalize(embeddings: npt.NDArray[np.floating]) -> npt.NDArray[np.floating]:
    norms = np.linalg.norm(embeddings, axis=-1, keepdims=True)
    return embeddings / np.maximum(norms, 1e-8)


def _softmax(scores: npt.NDArray[np.floating]) -> npt.NDArray[np.floating]:
    shifted = scores - scores.max(axis=-1, keepdims=True)
    exp = np.exp(shifted)
    return exp / exp.sum(axis=-1, keepdims=True)


class TagFileError(ValueError):
    """A line of a tag file this parser cannot read."""


@dataclass(frozen=True)
class TagSection:
    """A kind of thing: how sure the model must be, and how many per photo."""

    name: str
    max_tags: int = OTHER_SECTION_MAX
    min_probability: float = OTHER_SECTION_MIN


@dataclass(frozen=True)
class TagEntry:
    """A thing: the word it is filed under and the prompts that describe it."""

    name: str
    prompts: tuple[str, ...]
    section: str


@dataclass(frozen=True)
class TagList:
    entries: tuple[TagEntry, ...] = ()
    sections: tuple[TagSection, ...] = ()

    @property
    def names(self) -> list[str]:
        return [entry.name for entry in self.entries]

    def section(self, name: str) -> TagSection:
        for section in self.sections:
            if section.name == name:
                return section
        return TagSection(name)


def _parse_section(line: str) -> TagSection:
    """``## <name> [max=<n>] [min=<probability>]``"""
    name, *options = line[3:].split()
    values: dict[str, str] = {}
    for option in options:
        key, sep, value = option.partition("=")
        if not sep or key not in ("max", "min"):
            raise TagFileError(f"unknown section option {option!r} in {line!r}")
        values[key] = value
    try:
        return TagSection(
            name,
            max_tags=int(values.get("max", OTHER_SECTION_MAX)),
            min_probability=float(values.get("min", OTHER_SECTION_MIN)),
        )
    except ValueError as error:
        raise TagFileError(f"bad section line {line!r}: {error}") from error


def _parse_entry(line: str, section: str) -> TagEntry:
    """``name`` (the prompt templates) or ``name = prompt | prompt``."""
    name, sep, spelled = line.partition("=")
    name = name.strip()
    if not sep:
        return TagEntry(
            name, tuple(t.format(tag=name) for t in PROMPT_TEMPLATES), section
        )
    prompts = tuple(p.strip() for p in spelled.split("|") if p.strip())
    if not name or not prompts:
        raise TagFileError(f"a prompt line needs a name and a prompt: {line!r}")
    return TagEntry(name, prompts, section)


def parse_tag_lines(lines: Iterable[str]) -> TagList:
    """The things of a tag file: one per line, blank and ``#`` lines skipped,
    ``## `` lines starting a section (see tags.txt)."""
    entries: list[TagEntry] = []
    sections: dict[str, TagSection] = {OTHER_SECTION: TagSection(OTHER_SECTION)}
    current = OTHER_SECTION
    for raw in lines:
        line = raw.strip()
        if line.startswith("## "):
            section = _parse_section(line)
            sections[section.name] = section
            current = section.name
        elif line and not line.startswith("#"):
            entries.append(_parse_entry(line, current))
    return TagList(tuple(entries), tuple(sections.values()))


def read_tag_file(path: str) -> TagList:
    with open(path, encoding="utf-8") as f:
        return parse_tag_lines(f)


def read_custom_tags(path: str) -> TagList:
    """The admin's own things; none when the file is missing or unreadable.

    A broken custom file must not stop tagging with the built-in list, so it
    is logged and skipped rather than raised.
    """
    try:
        return read_tag_file(path)
    except FileNotFoundError:
        return TagList()
    except (OSError, UnicodeDecodeError, TagFileError) as error:
        logger.warning(
            "%s: cannot read custom tags from %s: %s", MODEL_NAME, path, error
        )
        return TagList()


def merge_tags(builtin: TagList, custom: TagList) -> TagList:
    """The built-in things, then each custom thing the list does not have yet.

    Duplicates are found case-insensitively, so "Dog" next to the built-in
    "dog" is dropped; the first spelling wins. So does the first definition
    of a section: a custom file cannot loosen a built-in section.
    """
    entries = list(builtin.entries)
    seen = {entry.name.casefold() for entry in entries}
    for entry in custom.entries:
        if entry.name.casefold() not in seen:
            seen.add(entry.name.casefold())
            entries.append(entry)
    sections = {section.name: section for section in builtin.sections}
    for section in custom.sections:
        sections.setdefault(section.name, section)
    return TagList(tuple(entries), tuple(sections.values()))


def tag_list_hash(entries: Sequence[TagEntry]) -> str:
    """The sha256 of the prompts the tag embeddings are built from, in order.

    Covers every prompt of every thing, so a renamed, reordered or re-worded
    thing changes it even when the number of things stays the same. Sections
    only steer the selection and are left out.
    """
    digest = hashlib.sha256()
    for entry in entries:
        for prompt in entry.prompts:
            digest.update(prompt.encode("utf-8"))
            digest.update(b"\n")
        digest.update(b"\x00")
    return digest.hexdigest()


def _cache_hash_path() -> str:
    """Where the tag-list hash of the embedding cache is kept: next to it."""
    return os.path.splitext(EMBEDDINGS_CACHE)[0] + ".sha256"


def _read_cache_hash() -> str | None:
    """The tag-list hash the cache was built for; None for a cache without one."""
    try:
        with open(_cache_hash_path(), encoding="utf-8") as f:
            return f.read().strip()
    except FileNotFoundError:
        return None


def _hash_mismatch_reason(cached_hash: str | None, tags_hash: str) -> str | None:
    if cached_hash is None:
        return "cache has no tag-list hash"
    if cached_hash != tags_hash:
        return "tag list changed since the cache was built"
    return None


def _stale_cache_reason(
    cache: npt.NDArray[np.generic],
    tag_count: int,
    cached_hash: str | None,
    tags_hash: str,
) -> str | None:
    """Why a cached tag-embedding array cannot be used, or None if it can.

    ``tags_hash`` is the hash of the current tag list, ``cached_hash`` the one
    the cache was built for: the cache serves that very list only.
    """
    if cache.ndim != 2:
        return f"cache has wrong shape {cache.shape}"
    if cache.shape[0] != tag_count:
        return f"cache has {cache.shape[0]} tags but the tag list has {tag_count}"
    if cache.shape[1] != EMBEDDING_DIM:
        return f"cache has dim={cache.shape[1]}, not {EMBEDDING_DIM}"
    return _hash_mismatch_reason(cached_hash, tags_hash)


class ClipTokenizer:
    """The CLIP BPE, laid out as open_clip's ``tokenize`` lays it out."""

    def __init__(self, path: str, context_length: int) -> None:
        self.tokenizer = Tokenizer.from_file(path)
        # Our own padding and truncation below; never the file's.
        self.tokenizer.no_padding()
        self.tokenizer.no_truncation()
        self.context_length = context_length
        start_id = self.tokenizer.token_to_id(START_TOKEN)
        end_id = self.tokenizer.token_to_id(END_TOKEN)
        # A CLIP tokenizer file always has both; without them no prompt can be
        # laid out, so refuse the file here rather than fail on the first text.
        assert start_id is not None and end_id is not None, (
            "tokenizer file has no start or end token"
        )
        self.start_id = start_id
        self.end_id = end_id

    def __call__(self, texts: Sequence[str]) -> npt.NDArray[np.int64]:
        """(n, context_length) int64 ids."""
        rows: list[list[int]] = []
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
    def __init__(self) -> None:
        self.vision_session: ort.InferenceSession | None = None
        self.text_session: ort.InferenceSession | None = None
        self.tokenizer: ClipTokenizer | None = None
        self.preprocess: Preprocess | None = None
        self.tag_list: TagList | None = None
        self.tag_embeddings: npt.NDArray[np.floating] | None = None
        self.is_loaded = False

    def load(self) -> None:
        """Load the image tower, the tag list and the (cached) tag embeddings."""
        self._load_vision()
        tag_list = self._load_tags()
        self.tag_list = tag_list
        self._load_or_build_tag_embeddings(tag_list.entries)
        self.is_loaded = True

    @staticmethod
    def _load_tags() -> TagList:
        """tags.txt, then the admin's custom things it does not have yet."""
        builtin = read_tag_file(TAGS_FILE)
        custom = read_custom_tags(CUSTOM_TAGS_FILE)
        tag_list = merge_tags(builtin, custom)
        if custom.entries:
            logger.info(
                "%s: added %s of %s custom tags from %s (the rest were already listed)",
                MODEL_NAME,
                len(tag_list.entries) - len(builtin.entries),
                len(custom.entries),
                CUSTOM_TAGS_FILE,
            )
        return tag_list

    def unload(self) -> None:
        self.vision_session = None
        self.text_session = None
        self.tokenizer = None
        self.preprocess = None
        self.tag_list = None
        self.tag_embeddings = None
        self.is_loaded = False

    def _load_preprocess(self) -> Preprocess:
        if self.preprocess is None:
            self.preprocess = Preprocess.from_file(PREPROCESS_PATH)
        return self.preprocess

    def _load_vision(self) -> ort.InferenceSession:
        self._load_preprocess()
        if self.vision_session is None:
            self.vision_session = inference_session(VISUAL_PATH)
        return self.vision_session

    # ------------------------------------------------------------------ text
    def _tokenize(self, texts: Sequence[str]) -> npt.NDArray[np.int64]:
        if self.tokenizer is None:
            self.tokenizer = ClipTokenizer(
                TOKENIZER_PATH, self._load_preprocess().context_length
            )
        return self.tokenizer(texts)

    def _run_text(
        self, session: ort.InferenceSession, texts: Sequence[str]
    ) -> npt.NDArray[np.float32]:
        input_name = session.get_inputs()[0].name
        (raw,) = session.run(None, {input_name: self._tokenize(texts)})
        return raw.astype(np.float32)

    def _build_tag_embeddings(self, entries: Sequence[TagEntry]) -> None:
        """Embed every thing's prompts with the text tower, average them per
        thing and cache the result."""
        logger.info("%s: building tag embeddings (first run only)...", MODEL_NAME)
        # A session of its own unless queries already loaded the text tower:
        # it is dropped again once the tags are embedded.
        session = self.text_session or inference_session(TEXTUAL_PATH)
        prompts = [prompt for entry in entries for prompt in entry.prompts]
        owners = np.repeat(
            np.arange(len(entries)), [len(entry.prompts) for entry in entries]
        )
        prompt_embeddings = np.concatenate(
            [
                _l2_normalize(
                    self._run_text(session, prompts[start : start + TEXT_BATCH_SIZE])
                )
                for start in range(0, len(prompts), TEXT_BATCH_SIZE)
            ],
            axis=0,
        )
        del session

        sums = np.zeros((len(entries), prompt_embeddings.shape[1]), np.float32)
        np.add.at(sums, owners, prompt_embeddings)
        self.tag_embeddings = _l2_normalize(sums)
        os.makedirs(os.path.dirname(EMBEDDINGS_CACHE), exist_ok=True)
        np.save(EMBEDDINGS_CACHE, self.tag_embeddings)
        # Written after the array: a cache whose hash is missing is rebuilt.
        with open(_cache_hash_path(), "w", encoding="utf-8") as f:
            f.write(tag_list_hash(entries))
        logger.info("%s: cached %s tag embeddings", MODEL_NAME, len(entries))

    def _load_or_build_tag_embeddings(self, entries: Sequence[TagEntry]) -> None:
        if not os.path.exists(EMBEDDINGS_CACHE):
            self._build_tag_embeddings(entries)
            return

        cache = np.load(EMBEDDINGS_CACHE)
        reason = _stale_cache_reason(
            cache, len(entries), _read_cache_hash(), tag_list_hash(entries)
        )
        if reason is not None:
            logger.info("%s: %s, rebuilding...", MODEL_NAME, reason)
            os.remove(EMBEDDINGS_CACHE)
            self._build_tag_embeddings(entries)
            return

        self.tag_embeddings = cache

    def embed_text_raw(self, text: str) -> npt.NDArray[np.float32]:
        """A search query through the text tower, unnormalised, shape (dim,).

        The text tower is a session of its own, loaded with the first query
        and kept until unload.
        """
        if self.text_session is None:
            self.text_session = inference_session(TEXTUAL_PATH)
        return self._run_text(self.text_session, [text])[0]

    # ----------------------------------------------------------------- image
    def _run_vision(
        self, pixel_values: npt.NDArray[np.float32]
    ) -> npt.NDArray[np.float32]:
        session = self._load_vision()
        input_name = session.get_inputs()[0].name
        (raw,) = session.run(None, {input_name: pixel_values})
        return raw.astype(np.float32)

    def embed_image_raw(self, image_path: str) -> npt.NDArray[np.float32]:
        """The image tower's output as it is, shape (1, dim).

        Unnormalised, as semantic search stores it: the similarity index ranks
        by inner product, and the search thresholds are calibrated on these
        raw values.
        """
        preprocess = self._load_preprocess()
        with Image.open(image_path) as image:
            pixel_values = prepare_image(image, preprocess)
        return self._run_vision(pixel_values)

    def embed_images_raw(
        self, image_paths: Sequence[str]
    ) -> list[npt.NDArray[np.float32] | None]:
        """One raw embedding (dim,) per path, in order; None where unreadable.

        Keeping the slot of a bad image lets the caller line the results up
        with the photos it asked about. Readable images go through the image
        tower IMAGE_BATCH_SIZE at a time.
        """
        preprocess = self._load_preprocess()
        results: list[npt.NDArray[np.float32] | None] = [None] * len(image_paths)
        pending: list[tuple[int, npt.NDArray[np.float32]]] = []
        for index, path in enumerate(image_paths):
            try:
                with Image.open(path) as image:
                    pending.append((index, prepare_image(image, preprocess)))
            except (OSError, ValueError) as error:
                # PIL.UnidentifiedImageError is an OSError; so is a missing file.
                logger.warning(
                    "%s: skipping unreadable image %s: %s", MODEL_NAME, path, error
                )

        for start in range(0, len(pending), IMAGE_BATCH_SIZE):
            batch = pending[start : start + IMAGE_BATCH_SIZE]
            raw = self._run_vision(np.concatenate([pixels for _, pixels in batch]))
            for (index, _), embedding in zip(batch, raw):
                results[index] = embedding
        return results

    # ------------------------------------------------------------------ tags
    def tags_for(
        self,
        raw_embedding: npt.ArrayLike,
        threshold: float = DEFAULT_MIN_PROBABILITY,
        max_tags: int = DEFAULT_MAX_TAGS,
    ) -> list[str]:
        """The most likely things for a raw image embedding, most likely first.

        Probabilities come from the softmax over all things at the model's
        logit scale, not raw cosines (see the module docstring). A thing is
        kept when it clears ``threshold`` and its section's own minimum, while
        its section has room left and the photo has fewer than ``max_tags``.
        """
        if not self.is_loaded:
            self.load()
        # load() sets all three; is_loaded is only ever True after it.
        assert (
            self.tag_list is not None
            and self.tag_embeddings is not None
            and self.preprocess is not None
        )
        image = _l2_normalize(
            np.asarray(raw_embedding, dtype=np.float32).reshape(1, -1)
        )
        similarities = (image @ self.tag_embeddings.T)[0]
        probabilities = _softmax(self.preprocess.logit_scale * similarities)

        tags: list[str] = []
        per_section: Counter[str] = Counter()
        for idx in np.argsort(probabilities)[::-1]:
            probability = probabilities[idx]
            if probability < threshold or len(tags) >= max_tags:
                break
            entry = self.tag_list.entries[idx]
            section = self.tag_list.section(entry.section)
            if (
                probability < section.min_probability
                or per_section[section.name] >= section.max_tags
            ):
                continue
            per_section[section.name] += 1
            tags.append(entry.name)
        return tags

    def predict(
        self,
        image_path: str,
        threshold: float = DEFAULT_MIN_PROBABILITY,
        max_tags: int = DEFAULT_MAX_TAGS,
        with_embedding: bool = False,
    ) -> dict[str, object]:
        """``{"tags": [...]}`` for a photo, most likely first; with
        ``with_embedding`` also ``"embedding"``, the raw image embedding of the
        same run, which semantic search stores: one image-tower run serves both.
        """
        if not self.is_loaded:
            self.load()
        raw = self.embed_image_raw(image_path)
        result: dict[str, object] = {"tags": self.tags_for(raw[0], threshold, max_tags)}
        if with_embedding:
            result["embedding"] = raw[0].tolist()
        return result
