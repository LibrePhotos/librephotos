#!/usr/bin/env python3
"""Export OpenCLIP ViT-B/32 (DataComp-XL) to ONNX for LibrePhotos' tags and search.

Checked in for reproducibility and run **by hand** by a maintainer to (re)build
the ``openclip_vitb32`` bundle that ``api/ml_models.py`` downloads. It is not
imported by the running server and adds nothing to ``requirements.txt``: torch
and open_clip exist only in the throwaway venv this runs in, e.g.::

    py -3.11 -m venv openclip-export
    openclip-export/Scripts/pip install torch --index-url https://download.pytorch.org/whl/cpu
    openclip-export/Scripts/pip install open_clip_torch onnx onnxruntime tokenizers pillow numpy
    openclip-export/Scripts/python scripts/build_openclip_onnx.py \\
        --output-dir out --images ../../deploy/e2e/photos /path/to/more/photos

It:

  1. Downloads ``laion/CLIP-ViT-B-32-DataComp.XL-s13B-b90K`` at a pinned
     revision (weights, ``open_clip_config.json``, ``tokenizer.json``) and
     checks the sha256 of every file against ``PINNED_SHA256``.
  2. Reads the preprocessing (image size, resize mode, interpolation, mean,
     std) from open_clip's pretrained config for ``datacomp_xl_s13b_b90k``,
     checks it against the repo's ``open_clip_config.json`` and against the
     transform open_clip builds, and the logit scale from the weights; all of
     it goes to ``preprocess.json``, which the runtime reads.
  3. Exports the image and the text tower as separate fp32 graphs (opset 17,
     dynamic batch) returning the raw projections, as ``encode_image`` /
     ``encode_text`` do.
  4. Checks the export against PyTorch on ~50 images and ~50 prompts, through
     the runtime's own preprocessing and tokenizer
     (``service/tags/openclip/openclip.py``): cosine >= 0.9999 or it fails.
  5. Quantises the text tower to int8 (dynamic) and keeps it only if its
     recall@10 against fp32 is >= 0.98 on the query set; the image tower stays
     fp32.
  6. Writes ``LICENSE`` (MIT), ``README.md`` (provenance, this command, the
     parity numbers) and ``SHA256SUMS``, and prints the ``ML_MODELS`` pins and
     the upload command.

``--golden`` prints the preprocessing golden values pinned in
``api/tests/ml_services/test_openclip_tagger.py`` instead.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import platform
import shutil
import sys
from pathlib import Path

import numpy as np

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

ARCH = "ViT-B-32"
PRETRAINED_TAG = "datacomp_xl_s13b_b90k"
HF_REPO = "laion/CLIP-ViT-B-32-DataComp.XL-s13B-b90K"
HF_REVISION = "f0e2ffa09cbadab3db6a261ec1ec56407ce42912"
WEIGHTS_FILE = "open_clip_model.safetensors"
BUNDLE_NAME = "openclip_vitb32"
MIRROR_REPO = "derneuere/librephotos_models"
OPSET = 17

# Upstream files at HF_REVISION. A mismatch aborts the build.
PINNED_SHA256 = {
    WEIGHTS_FILE: "3c00043509d2e3f35ec62bd85a643a393883dcda624d8208d034cc390c708297",
    "tokenizer.json": "d8b124290bc4bcd18cd3f72747f525e2a1d8c266cf3089e52da38ee417564ac5",
}

PARITY_IMAGES = 50
PARITY_PROMPTS = 50
MIN_COSINE = 0.9999
MIN_INT8_RECALL = 0.98
RECALL_AT = 10
MAX_RANKING_IMAGES = 600

# Natural search queries for the int8 recall check, next to every tag prompt.
SEARCH_QUERIES = [
    "a dog on the beach",
    "a cat sleeping on a sofa",
    "birthday cake with candles",
    "children playing in the snow",
    "a family dinner",
    "sunset over the sea",
    "a mountain lake",
    "a city street at night",
    "a red car",
    "a bicycle",
    "a train station",
    "an airplane in the sky",
    "a wedding",
    "a person hiking",
    "a selfie",
    "a group photo",
    "a baby",
    "a receipt",
    "a printed document page",
    "a screenshot of a phone",
    "handwritten notes",
    "a whiteboard",
    "a menu in a restaurant",
    "food on a plate",
    "a cup of coffee",
    "a glass of wine",
    "a christmas tree",
    "fireworks",
    "a concert",
    "a football match",
    "a swimming pool",
    "a tent in the forest",
    "autumn leaves",
    "flowers in a garden",
    "a horse",
    "a bird",
    "an astronaut",
    "the surface of the moon",
    "galaxies in deep space",
    "a rocket on a launch pad",
    "a black and white portrait of a man",
    "friends playing poker at a table",
    "a man with a camera on a tripod",
    "a surgical face mask",
    "a color wheel",
    "old coins",
    "a brick wall",
    "a chinese pagoda",
    "a temple in tokyo",
    "a castle",
    "a bridge over a river",
    "a waterfall",
    "a desert",
    "snowy mountains",
    "a boat on a lake",
    "a market stall",
    "a museum",
    "a library with books",
    "a computer on a desk",
    "a smartphone",
    "keys on a table",
    "a passport",
    "a business card",
    "a ticket",
    "a map",
    "a painting",
    "a sculpture",
    "graffiti",
    "a street sign",
    "an event poster",
    "opening hours on a door",
    "a blurry photo",
    "a photo taken at night",
    "a panorama",
    "a close-up of a flower",
    "a portrait of a woman smiling",
    "two people hugging",
    "a kid on a swing",
    "a picnic",
    "a barbecue",
    "a kitchen",
    "a living room",
    "a bedroom",
    "a bathroom",
    "a garden",
    "a parking lot",
    "a highway",
    "a farm with cows",
    "a zoo",
    "an aquarium",
    "a snowman",
    "a skier",
    "a surfer",
    "a runner",
    "a yoga class",
    "a dentist",
    "a hospital",
    "a classroom",
    "a graduation ceremony",
    "a dog playing with a ball in a park on a sunny afternoon while "
    "children watch from a bench and a man walks by with an umbrella "
    "although it is not raining and the sky is perfectly blue all day",
]

# Text the tokenizer check covers beyond the prompts: accents, scripts,
# emoji, odd whitespace, HTML entities (open_clip unescapes them).
TOKENIZER_EDGE_CASES = [
    "Straße ☀ 東京",
    "100% #1; semi",
    "  multiple   spaces\tand\nnewlines ",
    "CAFÉ naïve résumé",
    "emoji 😀🎉 test",
    "&amp; html &lt;b&gt; &amp;amp;",
]

IMAGE_SUFFIXES = (".jpg", ".jpeg", ".png", ".webp", ".bmp")

OPENAI_CLIP_NOTICE = """\
The tokenizer vocabulary (tokenizer.json) is OpenAI's CLIP byte-pair encoding:

MIT License

Copyright (c) 2021 OpenAI

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
"""


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def fail(message: str):
    print(f"ERROR: {message}", file=sys.stderr)
    sys.exit(1)


# --------------------------------------------------------------------------- #
# Inputs
# --------------------------------------------------------------------------- #
def readable(path: Path) -> bool:
    from PIL import Image

    try:
        with Image.open(path) as image:
            image.convert("RGB")
        return True
    except (OSError, ValueError):
        return False


def collect_images(dirs: list[str]) -> list[Path]:
    paths = []
    for directory in dirs:
        root = Path(directory)
        paths += [
            p
            for p in root.rglob("*")
            if p.is_file() and p.suffix.lower() in IMAGE_SUFFIXES
        ]
    return [p for p in sorted(set(paths)) if readable(p)]


def spread(items: list, count: int) -> list:
    """``count`` items spread evenly over ``items`` (all of them if fewer)."""
    if len(items) <= count:
        return list(items)
    step = len(items) / count
    return [items[int(i * step)] for i in range(count)]


def tag_prompts() -> list[str]:
    from service.tags.openclip.openclip import PROMPT_TEMPLATE, TAGS_FILE

    with open(TAGS_FILE, encoding="utf-8") as f:
        tags = [line.strip() for line in f if line.strip()]
    return [PROMPT_TEMPLATE.format(tag=tag) for tag in tags]


def download_upstream(work: Path) -> dict[str, Path]:
    from huggingface_hub import hf_hub_download

    files = {}
    for name in (WEIGHTS_FILE, "open_clip_config.json", "tokenizer.json"):
        path = Path(
            hf_hub_download(HF_REPO, name, revision=HF_REVISION, cache_dir=str(work))
        )
        pin = PINNED_SHA256.get(name)
        if pin is not None and sha256_of(path) != pin:
            fail(f"{name} at {HF_REVISION} does not match its sha256 pin")
        files[name] = path
    return files


# --------------------------------------------------------------------------- #
# Model and preprocessing
# --------------------------------------------------------------------------- #
def load_model(weights: Path, repo_config: Path):
    import open_clip

    pretrained = open_clip.get_pretrained_cfg(ARCH, PRETRAINED_TAG)
    if pretrained.get("hf_hub", "").rstrip("/") != HF_REPO:
        fail(f"open_clip maps {PRETRAINED_TAG} to {pretrained.get('hf_hub')!r}")
    model_cfg = open_clip.get_model_config(ARCH)

    preprocess_cfg = {
        "image_size": model_cfg["vision_cfg"]["image_size"],
        "mean": list(pretrained["mean"]),
        "std": list(pretrained["std"]),
        "interpolation": pretrained.get("interpolation", "bicubic"),
        "resize_mode": pretrained.get("resize_mode", "shortest"),
        "context_length": model_cfg["text_cfg"]["context_length"],
    }

    with open(repo_config, encoding="utf-8") as f:
        repo = json.load(f)
    for key in ("mean", "std"):
        if not np.allclose(repo["preprocess_cfg"][key], preprocess_cfg[key]):
            fail(f"open_clip_config.json disagrees with open_clip on {key}")
    if repo["model_cfg"] != model_cfg:
        fail("open_clip_config.json model_cfg differs from open_clip's ViT-B-32")

    model, _, transform = open_clip.create_model_and_transforms(
        ARCH,
        pretrained=str(weights),
        image_mean=tuple(preprocess_cfg["mean"]),
        image_std=tuple(preprocess_cfg["std"]),
        image_interpolation=preprocess_cfg["interpolation"],
        image_resize_mode=preprocess_cfg["resize_mode"],
    )
    model.eval()
    check_transform(transform, preprocess_cfg)
    preprocess_cfg["logit_scale"] = float(model.logit_scale.exp().item())
    tokenizer = open_clip.get_tokenizer(ARCH)
    return model, transform, tokenizer, preprocess_cfg


def check_transform(transform, cfg):
    """The transform open_clip built is the one preprocess.json describes."""
    from torchvision import transforms as T

    steps = transform.transforms
    resize = next(s for s in steps if isinstance(s, T.Resize))
    crop = next(s for s in steps if isinstance(s, T.CenterCrop))
    normalize = next(s for s in steps if isinstance(s, T.Normalize))
    size = cfg["image_size"]
    if resize.size not in (size, [size], (size,)):
        fail(f"resize to {resize.size}, expected the short edge to {size}")
    if resize.interpolation.value != cfg["interpolation"]:
        fail(f"resize interpolation {resize.interpolation.value}")
    if list(crop.size) != [size, size]:
        fail(f"centre crop {crop.size}")
    if not (
        np.allclose(normalize.mean, cfg["mean"])
        and np.allclose(normalize.std, cfg["std"])
    ):
        fail("Normalize mean/std differ from the pretrained config")


# --------------------------------------------------------------------------- #
# Export
# --------------------------------------------------------------------------- #
def export_towers(model, cfg, out: Path):
    import torch

    class Visual(torch.nn.Module):
        def __init__(self, clip):
            super().__init__()
            self.clip = clip

        def forward(self, pixel_values):
            return self.clip.encode_image(pixel_values)

    class Textual(torch.nn.Module):
        def __init__(self, clip):
            super().__init__()
            self.clip = clip

        def forward(self, input_ids):
            return self.clip.encode_text(input_ids)

    size = cfg["image_size"]
    # nn.MultiheadAttention's inference fast path is one fused op that has no
    # ONNX export; the regular path exports to plain MatMul/Softmax.
    torch.backends.mha.set_fastpath_enabled(False)
    with torch.no_grad():
        torch.onnx.export(
            Visual(model),
            (torch.randn(2, 3, size, size),),
            str(out / "visual.onnx"),
            dynamo=False,
            opset_version=OPSET,
            input_names=["pixel_values"],
            output_names=["image_embeds"],
            dynamic_axes={"pixel_values": {0: "batch"}, "image_embeds": {0: "batch"}},
            do_constant_folding=True,
        )
        torch.onnx.export(
            Textual(model),
            (torch.randint(1, 49000, (2, cfg["context_length"]), dtype=torch.long),),
            str(out / "textual_fp32.onnx"),
            dynamo=False,
            opset_version=OPSET,
            input_names=["input_ids"],
            output_names=["text_embeds"],
            dynamic_axes={"input_ids": {0: "batch"}, "text_embeds": {0: "batch"}},
            do_constant_folding=True,
        )

    import onnx

    for name in ("visual.onnx", "textual_fp32.onnx"):
        graph = onnx.load(str(out / name))
        onnx.checker.check_model(graph)
        opset = max(
            o.version for o in graph.opset_import if o.domain in ("", "ai.onnx")
        )
        batch = graph.graph.input[0].type.tensor_type.shape.dim[0]
        if opset < OPSET or not batch.dim_param:
            fail(f"{name}: opset {opset}, batch dim {batch}")


def session(path: Path):
    import onnxruntime as ort

    return ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])


def run_session(sess, array):
    return sess.run(None, {sess.get_inputs()[0].name: array})[0].astype(np.float32)


def cosines(a, b):
    a = a / np.linalg.norm(a, axis=1, keepdims=True)
    b = b / np.linalg.norm(b, axis=1, keepdims=True)
    return (a * b).sum(axis=1)


# --------------------------------------------------------------------------- #
# Checks
# --------------------------------------------------------------------------- #
def check_tokenizer(tokenizer_json: Path, open_clip_tokenizer, prompts, context):
    """Ids from tokenizer.json, laid out by the runtime, against open_clip's."""
    from service.tags.openclip.openclip import ClipTokenizer

    ours = ClipTokenizer(str(tokenizer_json), context)(prompts)
    theirs = open_clip_tokenizer(prompts).numpy()
    return int((ours != theirs).any(axis=1).sum())


def parity(model, transform, oc_tokenizer, cfg, out, images, prompts, tokenizer_json):
    import torch
    from PIL import Image

    from service.tags.openclip.openclip import ClipTokenizer, Preprocess, prepare_image

    preprocess = Preprocess.from_dict(cfg)
    visual = session(out / "visual.onnx")
    textual = session(out / "textual_fp32.onnx")

    reference, same_input, runtime = [], [], []
    pixel_diff = 0.0
    for path in images:
        with Image.open(path) as image:
            theirs = transform(image).unsqueeze(0)
            ours = prepare_image(image, preprocess)
        pixel_diff = max(pixel_diff, float(np.abs(theirs.numpy() - ours).max()))
        with torch.no_grad():
            reference.append(model.encode_image(theirs).numpy()[0])
        same_input.append(run_session(visual, theirs.numpy())[0])
        runtime.append(run_session(visual, ours)[0])
    reference = np.array(reference)
    image_model = cosines(reference, np.array(same_input))
    image_pipeline = cosines(reference, np.array(runtime))

    with torch.no_grad():
        text_reference = model.encode_text(oc_tokenizer(prompts)).numpy()
    ids = ClipTokenizer(str(tokenizer_json), cfg["context_length"])(prompts)
    text_pipeline = cosines(text_reference, run_session(textual, ids))

    return {
        "images": len(images),
        "prompts": len(prompts),
        "image_model_min_cosine": float(image_model.min()),
        "image_pipeline_min_cosine": float(image_pipeline.min()),
        "max_pixel_difference": pixel_diff,
        "text_min_cosine": float(text_pipeline.min()),
        "image_norm_mean": float(np.linalg.norm(reference, axis=1).mean()),
        "text_norm_mean": float(np.linalg.norm(text_reference, axis=1).mean()),
    }


def quantize_text(out: Path) -> Path:
    from onnxruntime.quantization import QuantType, quantize_dynamic
    from onnxruntime.quantization.shape_inference import quant_pre_process

    prepared = out / "textual_prep.onnx"
    # ORT's symbolic shape inference cannot follow the exported Reshape of the
    # attention heads; ONNX's own shape inference and the optimiser can.
    quant_pre_process(
        str(out / "textual_fp32.onnx"), str(prepared), skip_symbolic_shape=True
    )
    target = out / "textual_int8.onnx"
    quantize_dynamic(str(prepared), str(target), weight_type=QuantType.QInt8)
    prepared.unlink()
    return target


def embed_images(out: Path, images, cfg):
    from PIL import Image

    from service.tags.openclip.openclip import Preprocess, prepare_image

    preprocess = Preprocess.from_dict(cfg)
    visual = session(out / "visual.onnx")
    rows = []
    for path in images:
        with Image.open(path) as image:
            rows.append(run_session(visual, prepare_image(image, preprocess))[0])
    return np.array(rows)


def embed_texts(graph: Path, tokenizer_json: Path, cfg, texts):
    from service.tags.openclip.openclip import ClipTokenizer

    tokenize = ClipTokenizer(str(tokenizer_json), cfg["context_length"])
    sess = session(graph)
    return np.concatenate(
        [
            run_session(sess, tokenize(texts[i : i + 64]))
            for i in range(0, len(texts), 64)
        ]
    )


def recall_at(image_embeddings, fp32, quantized, k=RECALL_AT):
    """Mean share of fp32's top k (by inner product, as the index ranks) that
    the quantised text embeddings also put in their top k."""
    k = min(k, len(image_embeddings))
    top_fp32 = np.argsort(-(fp32 @ image_embeddings.T), axis=1)[:, :k]
    top_quantized = np.argsort(-(quantized @ image_embeddings.T), axis=1)[:, :k]
    return float(
        np.mean([len(set(a) & set(b)) / k for a, b in zip(top_fp32, top_quantized)])
    )


def tag_agreement(image_embeddings, fp32_tags, quantized_tags, cfg, threshold=0.02):
    """Mean Jaccard of the tags each text tower gives every image."""

    def tags(tag_embeddings):
        image = image_embeddings / np.linalg.norm(
            image_embeddings, axis=1, keepdims=True
        )
        tag = tag_embeddings / np.linalg.norm(tag_embeddings, axis=1, keepdims=True)
        logits = cfg["logit_scale"] * (image @ tag.T)
        logits -= logits.max(axis=1, keepdims=True)
        probabilities = np.exp(logits)
        probabilities /= probabilities.sum(axis=1, keepdims=True)
        return [set(np.where(row >= threshold)[0]) for row in probabilities]

    scores = []
    for a, b in zip(tags(fp32_tags), tags(quantized_tags)):
        union = a | b
        scores.append(len(a & b) / len(union) if union else 1.0)
    return float(np.mean(scores))


# --------------------------------------------------------------------------- #
# Golden values for the unit test
# --------------------------------------------------------------------------- #
def golden_image(width, height):
    """The deterministic test image the unit test rebuilds."""
    from PIL import Image

    y, x = np.mgrid[0:height, 0:width]
    arr = np.stack(
        [(x * 7 + y * 3) % 256, (x * y) % 256, (x ^ y) % 256], axis=-1
    ).astype(np.uint8)
    return Image.fromarray(arr, "RGB")


GOLDEN_SIZES = ((320, 200), (199, 301), (100, 60), (224, 224))
GOLDEN_PIXELS = ((0, 0, 0), (1, 17, 203), (2, 111, 111), (0, 223, 5), (2, 64, 190))


def print_golden(transform):
    for width, height in GOLDEN_SIZES:
        tensor = transform(golden_image(width, height)).numpy()
        values = [round(float(tensor[c, y, x]), 6) for c, y, x in GOLDEN_PIXELS]
        sums = [round(float(tensor[c].sum()), 3) for c in range(3)]
        print(f"    (({width}, {height}), {values}, {sums}),")


# --------------------------------------------------------------------------- #
# Bundle
# --------------------------------------------------------------------------- #
def write_license(bundle: Path):
    import open_clip  # noqa: F401  (the distribution below must be installed)

    dist = importlib.metadata.distribution("open_clip_torch")
    license_text = next(
        (
            f.locate().read_text(encoding="utf-8")
            for f in dist.files
            if f.name == "LICENSE"
        ),
        None,
    )
    if license_text is None:
        fail("open_clip_torch ships no LICENSE file")
    (bundle / "LICENSE").write_text(
        "OpenCLIP ViT-B/32 trained on DataComp-XL "
        f"({HF_REPO}), MIT licence.\n\n"
        "The weights were trained by LAION with OpenCLIP; OpenCLIP's licence:\n\n"
        f"{license_text.strip()}\n\n"
        "----------------------------------------------------------------------\n\n"
        f"{OPENAI_CLIP_NOTICE}",
        encoding="utf-8",
        newline="\n",
    )


def versions():
    names = ("torch", "open_clip_torch", "onnx", "onnxruntime", "numpy", "pillow")
    return {name: importlib.metadata.version(name) for name in names}


def write_readme(bundle, cfg, checks, command, text_precision):
    p, q = checks["parity"], checks["int8"]
    lines = [
        "# OpenCLIP ViT-B/32 (DataComp-XL) for LibrePhotos",
        "",
        "Image and text towers of LAION's OpenCLIP ViT-B/32 trained on DataComp-XL",
        "(13B samples seen, 72.7 % ImageNet zero-shot), exported to ONNX for",
        "LibrePhotos' tags, semantic search and similar photos. MIT licence (see",
        "LICENSE).",
        "",
        "## Provenance",
        "",
        f"- Source: https://huggingface.co/{HF_REPO} at revision `{HF_REVISION}`",
        f"- Weights: `{WEIGHTS_FILE}`, sha256 `{PINNED_SHA256[WEIGHTS_FILE]}`",
        f"- open_clip: `{ARCH}` / `{PRETRAINED_TAG}`",
        f"- tokenizer.json: from the same repo and revision (OpenAI CLIP BPE); "
        f"token ids identical to open_clip's tokenizer on {checks['tokenizer_prompts']} "
        "prompts. Same vocabulary and merges as the OpenAI CLIP ViT-B/32 "
        "tokenizer.json LibrePhotos used before, which gives the same ids",
        "- Built with: "
        + ", ".join(f"{k} {v}" for k, v in versions().items())
        + f", Python {platform.python_version()}",
        "",
        "## Files",
        "",
        f"- `visual.onnx`: image tower, fp32, opset {OPSET}, input `pixel_values` "
        f"(batch, 3, {cfg['image_size']}, {cfg['image_size']}), output `image_embeds` "
        "(batch, 512), the raw projection (`encode_image`, not normalised)",
        f"- `textual.onnx`: text tower, {text_precision}, opset {OPSET}, input "
        f"`input_ids` int64 (batch, {cfg['context_length']}), output `text_embeds` "
        "(batch, 512), raw (`encode_text`)",
        "- `tokenizer.json`: CLIP BPE; the runtime lays ids out as open_clip does "
        "(start, text, end; cut to the context with the end token last; pad 0)",
        "- `preprocess.json`: shortest-edge resize (torchvision arithmetic: the long "
        "edge is truncated), centre crop (rounded offsets), mean/std, and the "
        "logit scale",
        "",
        "## Export",
        "",
        "```",
        command,
        "```",
        "",
        "## Checks",
        "",
        f"Against PyTorch on {p['images']} images and {p['prompts']} prompts, "
        "through LibrePhotos' own preprocessing and tokenizer:",
        "",
        f"- image tower, same input: min cosine {p['image_model_min_cosine']:.7f}",
        f"- image pipeline (runtime preprocessing): min cosine "
        f"{p['image_pipeline_min_cosine']:.7f}, max pixel difference "
        f"{p['max_pixel_difference']:.2e}",
        f"- text tower (fp32): min cosine {p['text_min_cosine']:.7f}",
        f"- mean raw norms: image {p['image_norm_mean']:.3f}, text "
        f"{p['text_norm_mean']:.3f}; logit scale {cfg['logit_scale']:.4f}",
        "",
        f"int8 text tower (dynamic quantisation) against fp32, ranking "
        f"{q['ranking_images']} images:",
        "",
        f"- recall@{RECALL_AT}, {q['search_queries']} search queries: "
        f"{q['recall_search']:.4f}",
        f"- recall@{RECALL_AT}, {q['tag_queries']} tag prompts: {q['recall_tags']:.4f}",
        f"- tag agreement (mean Jaccard at p >= 0.02): {q['tag_jaccard']:.4f}",
        f"- size: {q['fp32_mb']:.1f} MB fp32 -> {q['int8_mb']:.1f} MB int8",
        f"- shipped: **{text_precision}** (int8 needs recall@{RECALL_AT} >= "
        f"{MIN_INT8_RECALL} on both query sets)",
        "",
    ]
    (bundle / "README.md").write_text("\n".join(lines), encoding="utf-8", newline="\n")


def write_checksums(bundle: Path):
    sums = {
        path.name: sha256_of(path)
        for path in sorted(bundle.iterdir())
        if path.is_file() and path.name != "SHA256SUMS"
    }
    (bundle / "SHA256SUMS").write_text(
        "".join(f"{digest}  {name}\n" for name, digest in sums.items()),
        encoding="utf-8",
        newline="\n",
    )
    return sums


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument(
        "--images",
        nargs="+",
        default=[str(BACKEND.parents[1] / "deploy" / "e2e" / "photos")],
        help="directories of photos for the parity and recall checks",
    )
    parser.add_argument(
        "--golden", action="store_true", help="print the preprocessing golden values"
    )
    args = parser.parse_args(argv)

    work = args.output_dir / "_work"
    bundle = args.output_dir / BUNDLE_NAME
    work.mkdir(parents=True, exist_ok=True)

    upstream = download_upstream(work)
    model, transform, oc_tokenizer, cfg = load_model(
        upstream[WEIGHTS_FILE], upstream["open_clip_config.json"]
    )
    if args.golden:
        print_golden(transform)
        return

    images = collect_images(args.images)
    if len(images) < 10:
        fail(f"only {len(images)} images under {args.images}; give it more")
    prompts_all = tag_prompts()
    parity_prompts = spread(prompts_all, PARITY_PROMPTS - 10) + SEARCH_QUERIES[-10:]

    mismatches = check_tokenizer(
        upstream["tokenizer.json"],
        oc_tokenizer,
        prompts_all + SEARCH_QUERIES + TOKENIZER_EDGE_CASES,
        cfg["context_length"],
    )
    if mismatches:
        fail(f"tokenizer.json disagrees with open_clip on {mismatches} prompts")

    if bundle.exists():
        shutil.rmtree(bundle)
    bundle.mkdir(parents=True)
    export_towers(model, cfg, bundle)

    checks = {
        "tokenizer_prompts": len(prompts_all)
        + len(SEARCH_QUERIES)
        + len(TOKENIZER_EDGE_CASES)
    }
    checks["parity"] = parity(
        model,
        transform,
        oc_tokenizer,
        cfg,
        bundle,
        spread(images, PARITY_IMAGES),
        parity_prompts,
        upstream["tokenizer.json"],
    )
    print(json.dumps(checks["parity"], indent=1))
    for key in (
        "image_model_min_cosine",
        "image_pipeline_min_cosine",
        "text_min_cosine",
    ):
        if checks["parity"][key] < MIN_COSINE:
            fail(f"{key} {checks['parity'][key]:.6f} < {MIN_COSINE}")

    quantized = quantize_text(bundle)
    ranking = spread(images, MAX_RANKING_IMAGES)
    image_embeddings = embed_images(bundle, ranking, cfg)
    fp32_graph = bundle / "textual_fp32.onnx"
    tok = upstream["tokenizer.json"]
    search_fp32 = embed_texts(fp32_graph, tok, cfg, SEARCH_QUERIES)
    search_int8 = embed_texts(quantized, tok, cfg, SEARCH_QUERIES)
    tags_fp32 = embed_texts(fp32_graph, tok, cfg, prompts_all)
    tags_int8 = embed_texts(quantized, tok, cfg, prompts_all)
    checks["int8"] = {
        "ranking_images": len(ranking),
        "search_queries": len(SEARCH_QUERIES),
        "tag_queries": len(prompts_all),
        "recall_search": recall_at(image_embeddings, search_fp32, search_int8),
        "recall_tags": recall_at(image_embeddings, tags_fp32, tags_int8),
        "tag_jaccard": tag_agreement(image_embeddings, tags_fp32, tags_int8, cfg),
        "fp32_mb": fp32_graph.stat().st_size / 1e6,
        "int8_mb": quantized.stat().st_size / 1e6,
    }
    print(json.dumps(checks["int8"], indent=1))
    use_int8 = min(checks["int8"]["recall_search"], checks["int8"]["recall_tags"]) >= (
        MIN_INT8_RECALL
    )
    text_precision = "int8" if use_int8 else "fp32"
    (quantized if use_int8 else fp32_graph).rename(bundle / "textual.onnx")
    for leftover in (quantized, fp32_graph):
        leftover.unlink(missing_ok=True)

    cfg["text_precision"] = text_precision
    cfg["source"] = f"{HF_REPO}@{HF_REVISION}"
    (bundle / "preprocess.json").write_text(
        json.dumps(cfg, indent=2) + "\n", encoding="utf-8", newline="\n"
    )
    shutil.copyfile(upstream["tokenizer.json"], bundle / "tokenizer.json")
    write_license(bundle)
    # Local paths stay out of the README, which is published with the model.
    command = (
        "python scripts/build_openclip_onnx.py --output-dir <out> "
        f"--images <photo dirs: {len(images)} images>"
    )
    write_readme(bundle, cfg, checks, command, text_precision)
    (args.output_dir / "checks.json").write_text(json.dumps(checks, indent=1))
    sums = write_checksums(bundle)

    print("\nML_MODELS pins (api/ml_models.py):")
    for name, digest in sums.items():
        print(f'    "{BUNDLE_NAME}/{name}": "{digest}",')
    print("\nUpload:")
    print(
        f"huggingface-cli upload {MIRROR_REPO} {bundle} {BUNDLE_NAME} "
        f'--commit-message "Add {BUNDLE_NAME} (OpenCLIP ViT-B/32 DataComp-XL, ONNX)"'
    )


if __name__ == "__main__":
    main()
