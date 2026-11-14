"""Goldens for lp_ml::tags (port of service/tags: MobileCLIP-S2 and SigLIP 2).

    python golden_tags.py [mobileclip_s2|siglip2 ...]

Imports the taggers directly (no sidecar). Loading a tagger builds its
tag_embeddings.npy in the model dir when missing, exactly as the sidecar does
on first use. Writes ml-goldens/tags/:

  <model>.json   per image: the sidecar's tags, the L2-normalised image
                 embedding and the full score vector (softmax probabilities
                 for MobileCLIP, raw cosine for SigLIP 2)
  text.json      per model: the token ids of every "a photo of {tag}" prompt
                 and the tag embeddings (the cache the Rust side rebuilds)

and ml-goldens/_decoded/tags/<case id>.png: every JPEG as Pillow decodes it
(``--decoded`` writes only these). lp_ml decodes JPEG with zune-jpeg, up to
8 levels off libjpeg-turbo, so the Rust test also runs the model on Pillow's
pixels to separate model parity from decoder differences.

Runs in UTF-8 mode: siglip2.py opens tags.txt with the locale encoding, which
is cp1252 on Windows and garbles "quinceañera"; Linux (production) reads UTF-8.
"""

import os
import subprocess
import sys

if not sys.flags.utf8_mode:
    sys.exit(subprocess.call([sys.executable, "-X", "utf8", *sys.argv]))

import golden_common as gc  # noqa: E402

gc.setup("service/tags")

import numpy as np  # noqa: E402
from mobileclip import mobileclip as mc  # noqa: E402
from siglip2 import siglip2 as sg  # noqa: E402

MODELS = {
    "mobileclip_s2": (mc.MobileCLIP, 0.02),
    "siglip2": (sg.SigLIP2, 0.05),
}


def scores(model, tagger, path):
    """The score vector predict() ranks, recomputed the same way."""
    if model == "mobileclip_s2":
        emb = tagger.embed_image(path)
        sims = (emb @ tagger.tag_embeddings.T)[0]
        return emb[0], mc._softmax(mc.LOGIT_SCALE * sims)
    from PIL import Image

    pixel_values = tagger.prepare_image(Image.open(path))
    name = tagger.vision_session.get_inputs()[0].name
    raw = tagger.vision_session.run(None, {name: pixel_values})
    emb = sg._l2_normalize(sg._select_pooled_output(raw, 1))
    return emb[0], (emb @ tagger.tag_embeddings.T)[0]


# Tokenizer edge cases beyond the prompts (SigLIP 2's sentencepiece BPE).
EXTRA_TEXTS = [
    "",
    "a",
    "a photo of quinceañera",
    "Hello  World",
    "  leading and trailing  ",
    "tab\tand\nnewline",
    "東京タワー at night",
    "emoji 🎉🐱 party",
    "Zürich Straße, Ærø, naïve café",
    "<start_of_turn>user",
    "UPPER lower 12345 3.14159",
    "a" * 80,
]


def token_ids(model, tagger, prompts):
    if model == "mobileclip_s2":
        return tagger._tokenize(prompts)
    ids, _mask = tagger._tokenize(prompts)
    return ids


def decoded_path(path):
    return gc.GOLDENS / "_decoded" / "tags" / (gc.case_id(path).replace("/", "__") + ".png")


def write_decoded(images):
    from PIL import Image

    for path in images:
        if path.suffix.lower() in (".jpg", ".jpeg"):
            out = decoded_path(path)
            out.parent.mkdir(parents=True, exist_ok=True)
            Image.open(path).convert("RGB").save(out)


def main(models):
    images = gc.default_images()
    write_decoded(images)
    text_cases = []
    for model in models:
        cls, threshold = MODELS[model]
        tagger = cls()
        tagger.load()
        prompts = [f"a photo of {t}" for t in tagger.tags]
        cases = []
        for path in images:
            try:
                tags = tagger.predict(str(path), threshold=threshold, max_tags=10)
                emb, sc = scores(model, tagger, str(path))
                out = {"tags": tags, "embedding": gc.arr(emb), "scores": gc.arr(sc)}
            except Exception as e:  # the sidecar answers 500
                out = {"error": f"{type(e).__name__}: {e}"}
            cases.append(gc.case(path, {"image": str(path)}, out))
        gc.write(
            "tags",
            model,
            cases,
            meta={
                "model": model,
                "threshold": threshold,
                "tag_count": len(tagger.tags),
            },
        )
        text_cases.append(
            gc.case(
                model,
                {"prompts": prompts, "extra_texts": EXTRA_TEXTS},
                {
                    "input_ids": gc.arr(token_ids(model, tagger, prompts)),
                    "extra_ids": gc.arr(token_ids(model, tagger, EXTRA_TEXTS)),
                    "tag_embeddings": gc.arr(np.asarray(tagger.tag_embeddings)),
                },
            )
        )
    gc.write("tags", "text", text_cases)


if __name__ == "__main__":
    if sys.argv[1:] == ["--decoded"]:
        write_decoded(gc.default_images())
    else:
        main(sys.argv[1:] or list(MODELS))
