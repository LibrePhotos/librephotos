#!/usr/bin/env python3
"""Calibrate OpenCLIP's search and similar-photo thresholds.

Run by hand, from ``apps/backend`` in the backend environment (ONNX Runtime,
no torch), against a model directory and a folder of photos::

    python scripts/calibrate_openclip.py --model-dir <data_models>/openclip_vitb32 \\
        --corpus <photos> \\
        [--reference previous_model.json] [--out calibration.json]

Each threshold of a new model is chosen so that it behaves like the model it
replaces, measured on the same photos:

``api.search.semantic.SEARCH_THRESHOLD``
    the inner product of a raw query and a raw image embedding that returns
    as many photos per query, on average, as the previous model did at its own
    threshold (``search_hits_per_query`` in the reference);
``api.search.semantic.SIMILAR_THRESHOLD``
    the same for photo-to-photo inner products (``similar_hits_per_photo``);

The reference JSON holds those numbers for the previous model(s), measured
the same way (``measure_search``). Without one, the script still reports
OpenCLIP's own numbers. ``LABELLED_QUERIES`` (the relevant
photos by file name, from the LibrePhotos ML test corpus) give precision and
recall of the ranking and of the thresholded results; queries whose photos are
not in the corpus are skipped.

The tag cut-offs are not calibrated here: each section of
``service/tags/tags.txt`` carries its own, chosen on a sample of photos whose
proposed things were graded by looking at them (see that file's header).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import numpy as np

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

IMAGE_SUFFIXES = (".jpg", ".jpeg", ".png", ".webp", ".bmp")

_V = [f"portrait_astronaut_{s}" for s in ("big", "bright", "flip", "orig", "padded")]
_H = [f"portrait_hanks_{s}" for s in ("big", "bright", "flip", "orig", "padded")]
_G = [
    f"group_t1_{s}"
    for s in ("big", "bright", "flip", "grey", "left", "orig", "padded", "right")
]
_SHAPES = [
    "admin_own_01",
    "IMG_20240301_120000_001",
    "IMG_20240301_120000_002",
    "IMG_20240301_120000_003",
    "IMG_20240301_120000_004",
    "dup_original",
    "dup_resized",
    "plain",
    "100% #1; semi",
    "Straße ☀ 東京",
    "DSC_0001",
    "Screenshot_20240115-093000",
    "xmp_photo",
    "manual_a",
    "manual_b",
    "hidden",
    "no_thumbnail",
    "no_timestamp",
    "trashed",
    "berlin_01",
    "berlin_02",
    "tokyo_01",
    "bob_own_01",
    "bob_own_02",
    "carol_own_01",
    "dave_own_01",
]
# Query -> file stems of the photos it should find.
LABELLED_QUERIES = {
    "a cat": ["scene_chelsea"],
    "a cup of coffee": ["scene_coffee"],
    "a horse": ["scene_horse"],
    "a rocket on a launch pad": ["scene_rocket"],
    "a red motorcycle": ["scene_motorcycle_left"],
    "an astronaut": _V,
    "galaxies in deep space": ["scene_hubble_deep_field"],
    "the surface of the moon": ["scene_moon"],
    "old coins": ["scene_coins"],
    "a brick wall": ["scene_brick"],
    "grass": ["scene_grass"],
    "a flower": ["scene_flower"],
    "a chinese pagoda": ["scene_china"],
    "a man with a camera on a tripod": ["cameraman", "cameraman_flip"],
    "friends playing poker at a table": _G,
    "a black and white portrait of a man": _H,
    "a surgical face mask": ["mask_black", "mask_blue", "mask_green", "mask_white"],
    "a color wheel": ["scene_color"],
    "a photo of the retina of an eye": ["scene_retina"],
    "tissue under a microscope": ["scene_ihc"],
    "a logo": ["scene_logo"],
    "a green street sign": ["text_sign_900x500"],
    "a shopping receipt": ["text_receipt_720x1100"],
    "a printed document page": [
        "text_document_1240x1754",
        "text_big_2600x1800",
        "text_page",
    ],
    "an event poster": ["text_poster_1400x900"],
    "handwritten notes": ["text_text"],
    "a blurry clock": ["scene_clock_motion"],
    "colorful abstract shapes": _SHAPES,
    "opening hours": ["text_columns_1200x700"],
    "faded grey label text": ["text_lowcontrast_900x400"],
}
# More everyday queries for the hit counts (no labels).
EXTRA_QUERIES = [
    "a dog",
    "a beach",
    "a group of people",
    "a red car",
    "a sign",
    "a receipt",
    "food on a plate",
    "a city street",
    "mountains",
    "a child",
    "a document",
    "a screenshot",
    "a sunset",
    "a building",
    "a portrait of a woman",
    "a tree",
    "a bicycle",
    "a birthday cake",
    "snow",
    "a car on a road",
]
# Variants of one source photo: similar-photo hits inside a family are right.
FAMILIES = (
    "portrait_astronaut",
    "portrait_hanks",
    "group_t1",
    "cameraman",
    "mask_",
    "e2e_",
    "card_",
    "dup_",
    "IMG_20240301_120000",
)


def collect(directory):
    from PIL import Image

    paths = []
    for path in sorted(Path(directory).rglob("*")):
        if not path.is_file() or path.suffix.lower() not in IMAGE_SUFFIXES:
            continue
        try:
            with Image.open(path) as image:
                image.convert("RGB")
        except OSError, ValueError:
            continue
        paths.append(path)
    return paths


def queries():
    return list(LABELLED_QUERIES) + EXTRA_QUERIES


def family(stem):
    return next((prefix for prefix in FAMILIES if stem.startswith(prefix)), stem)


# --------------------------------------------------------------------------- #
# Measurements (also used to measure the reference model the same way)
# --------------------------------------------------------------------------- #
def measure_search(
    images, stems, query_embeddings, search_threshold, similar_threshold
):
    """Hit counts and quality of raw inner-product search at given thresholds."""
    scores = query_embeddings @ images.T
    similar = images @ images.T
    np.fill_diagonal(similar, -np.inf)

    labelled = [
        (row, set(LABELLED_QUERIES[q]))
        for row, q in zip(scores, queries())
        if q in LABELLED_QUERIES and set(LABELLED_QUERIES[q]) & set(stems)
    ]
    p10, r20, mrr, precision, recall = [], [], [], [], []
    for row, relevant in labelled:
        relevant &= set(stems)
        ranked = [stems[i] for i in np.argsort(-row, kind="stable")]
        p10.append(sum(s in relevant for s in ranked[:10]) / 10)
        r20.append(len(relevant & set(ranked[:20])) / len(relevant))
        first = next(i for i, s in enumerate(ranked) if s in relevant)
        mrr.append(1 / (first + 1))
        hits = [stems[i] for i in np.where(row >= search_threshold)[0]]
        if hits:
            precision.append(sum(h in relevant for h in hits) / len(hits))
        recall.append(sum(h in relevant for h in hits) / len(relevant))

    pairs = same_family = 0
    for i, j in zip(*np.where(similar >= similar_threshold)):
        pairs += 1
        same_family += family(stems[i]) == family(stems[j])

    return {
        "photos": len(stems),
        "queries": len(scores),
        "labelled_queries": len(labelled),
        "image_norm_mean": round(float(np.linalg.norm(images, axis=1).mean()), 3),
        "text_norm_mean": round(
            float(np.linalg.norm(query_embeddings, axis=1).mean()), 3
        ),
        "P@10": round(float(np.mean(p10)), 3) if p10 else None,
        "R@20": round(float(np.mean(r20)), 3) if r20 else None,
        "MRR": round(float(np.mean(mrr)), 3) if mrr else None,
        "search_threshold": search_threshold,
        "search_hits_per_query": round(
            float((scores >= search_threshold).sum(1).mean()), 2
        ),
        "thresholded_precision": round(float(np.mean(precision)), 3)
        if precision
        else None,
        "thresholded_recall": round(float(np.mean(recall)), 3) if recall else None,
        "similar_threshold": similar_threshold,
        "similar_hits_per_photo": round(
            float((similar >= similar_threshold).sum(1).mean()), 2
        ),
        "similar_pairs": int(pairs),
        "similar_pairs_same_family": int(same_family),
    }


def threshold_for_hits(scores, target, exclude_diagonal=False):
    """The cut on ``scores`` whose mean hits per row is closest to ``target``."""
    scores = np.array(scores, dtype=np.float64)
    if exclude_diagonal:
        np.fill_diagonal(scores, -np.inf)
    candidates = np.unique(np.round(scores[np.isfinite(scores)], 2))
    return float(
        min(candidates, key=lambda t: abs((scores >= t).sum(1).mean() - target))
    )


# --------------------------------------------------------------------------- #
# OpenCLIP
# --------------------------------------------------------------------------- #
def openclip_embeddings(paths, texts):
    from service.tags.openclip.openclip import OpenCLIP

    model = OpenCLIP()
    images = model.embed_images_raw([str(p) for p in paths])
    keep = [i for i, e in enumerate(images) if e is not None]
    texts_emb = np.array([model.embed_text_raw(t) for t in texts])
    return (
        model,
        [paths[i] for i in keep],
        np.array([images[i] for i in keep]),
        texts_emb,
    )


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--model-dir", help="the openclip_vitb32 directory")
    parser.add_argument("--corpus", required=True, help="photos for search")
    parser.add_argument("--reference", help="the previous model's numbers (JSON)")
    parser.add_argument("--out", help="write the results here as JSON")
    args = parser.parse_args(argv)
    if args.model_dir:
        os.environ["OPENCLIP_MODEL_DIR"] = args.model_dir

    from api.search import semantic

    reference = json.loads(Path(args.reference).read_text()) if args.reference else {}

    model, paths, images, texts = openclip_embeddings(collect(args.corpus), queries())
    stems = [p.stem for p in paths]
    result = {
        "current": measure_search(
            images,
            stems,
            texts,
            semantic.SEARCH_THRESHOLD,
            semantic.SIMILAR_THRESHOLD,
        )
    }
    if "search_hits_per_query" in reference:
        search = threshold_for_hits(
            texts @ images.T, reference["search_hits_per_query"]
        )
        similar = threshold_for_hits(
            images @ images.T,
            reference["similar_hits_per_photo"],
            exclude_diagonal=True,
        )
        result["calibrated"] = measure_search(images, stems, texts, search, similar)

    result["reference"] = reference

    text = json.dumps(result, indent=1, ensure_ascii=False)
    print(text)
    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")


if __name__ == "__main__":
    main()
