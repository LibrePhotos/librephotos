"""Goldens for lp_ml::caption (service/image_captioning/lfm2_vl.py).

    python golden_caption.py [--limit N] [--offset N] [--edge]

Writes ml-goldens/caption/lfm2_vl.json: per image the smart-resize target,
the prompt token ids, the generated token ids (greedy, max 64) and the
cleaned caption, plus the top-1/top-2 logit margin of every decoding step
(a divergence at a near-tie is rounding, not a porting bug). The first
images also carry the vision tower's output for a cosine check.

Images: the fixture's big thumbnails (WebP, what captions.generate reads),
its originals (JPEG decodes differ from Pillow by a few levels) and the
generated edge cases; a few are captioned again with the prompts
PhotoCaption._caption_prompt builds from the user's llm_settings.
"""

import argparse
import time

import golden_common as gc

gc.setup("service/image_captioning")

import numpy as np  # noqa: E402
from lfm2_vl import (  # noqa: E402
    DEFAULT_PROMPT,
    Lfm2VlCaptioner,
    prepare_image,
    smart_resize,
)
from PIL import Image  # noqa: E402

PERSON_PROMPT = (
    "Write a short, natural image caption. The person in the photo is named Anna. "
    "Use the name 'Anna' directly in the caption — do not say 'a person named'. "
    "Keep the caption casual and to the point, like a friend tagging a photo. "
    "This photo was taken at Berlin, Germany. Include relevant tags and keywords."
)
PLACE_PROMPT = "Write a short, natural image caption. This photo was taken at Lisbon, Portugal."
# JPEG originals decode a few levels off Pillow in Rust; a sample is enough.
ORIGINALS = 12


class Recorder:
    """Wraps the decoder session to keep each step's top-2 logit margin."""

    def __init__(self, session):
        self.session = session
        self.margins = []

    def __getattr__(self, name):
        return getattr(self.session, name)

    def run(self, names, feed):
        out = self.session.run(names, feed)
        logits = np.asarray(out[0][0, -1], dtype=np.float32)
        top = np.partition(logits, -2)[-2:]
        self.margins.append(float(top[1] - top[0]))
        return out


def images(limit, offset=0, edge=False):
    fixture = gc.fixture_images()
    thumbs = [p for p in fixture if "thumbnails_big" in p.parts]
    originals = [p for p in fixture if "thumbnails_big" not in p.parts]
    out = thumbs + gc.generated_images() + originals[:ORIGINALS]
    out = out[offset:]
    out = out[:limit] if limit else out
    if edge:
        # Modes and containers the fixture lacks (golden_caption_edge.py).
        from golden_caption_edge import edge_images

        out += edge_images()
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--offset", type=int, default=0, help="skip the first N images")
    ap.add_argument("--edge", action="store_true", help="add the edge-case images")
    args = ap.parse_args()

    cap = Lfm2VlCaptioner(str(gc.data_models() / "lfm2_vl_450m"))
    t0 = time.perf_counter()
    cap.load()
    load_secs = time.perf_counter() - t0
    rec = Recorder(cap.sessions["decoder"])
    cap.sessions["decoder"] = rec

    paths = images(args.limit, args.offset, args.edge)
    jobs = [(p, None) for p in paths]
    jobs += [(p, PERSON_PROMPT) for p in paths[:3]]
    jobs += [(p, PLACE_PROMPT) for p in paths[3:5]]

    decoded = {}
    inner_decode = cap._decode

    def decode(embeds, max_new_tokens):
        rec.margins = []
        decoded["ids"] = inner_decode(embeds, max_new_tokens)
        decoded["margins"] = rec.margins
        return decoded["ids"]

    cap._decode = decode

    cases = []
    total = 0.0
    for i, (path, prompt) in enumerate(jobs):
        with Image.open(path) as im:
            w, h = im.size
            pixel_values, spatial, _ = prepare_image(im)
        new_h, new_w = smart_resize(h, w)
        n_image = new_h * new_w // 1024
        text = prompt or DEFAULT_PROMPT
        t = time.perf_counter()
        caption = cap.caption(str(path), prompt)
        secs = time.perf_counter() - t
        total += secs
        prompt_ids = cap.tokenizer.encode(
            f"<|startoftext|><|im_start|>user\n<|image_start|>{'<image>' * n_image}"
            f"<|image_end|>{text}<|im_end|>\n<|im_start|>assistant\n",
            add_special_tokens=False,
        ).ids
        out = {
            "size": [w, h],
            "resized": [new_w, new_h],
            "spatial_shapes": spatial.tolist()[0],
            "pixel_sum": float(pixel_values.astype(np.float64).sum()),
            "image_tokens": int(n_image),
            "prompt_ids": prompt_ids,
            "token_ids": decoded["ids"],
            "margins": decoded["margins"],
            "caption": caption,
            "seconds": secs,
        }
        if i < 6:
            out["image_features"] = gc.arr(cap._image_features(str(path)).astype(np.float32))
        cid = gc.case_id(path) + ("" if prompt is None else f"#prompt{i}")
        cases.append(gc.case(cid, {"image": str(path), "prompt": prompt}, out))
        print(f"{i + 1}/{len(jobs)} {secs:.2f}s {len(decoded['ids'])} tok {cid}: {caption}", flush=True)

    gc.write(
        "caption",
        "lfm2_vl",
        cases,
        meta={
            "model": "lfm2_vl_450m",
            "load_seconds": load_secs,
            "mean_seconds": total / max(1, len(jobs)),
            "cache_dtype": np.dtype(cap.cache_dtype).name,
        },
    )


if __name__ == "__main__":
    main()
