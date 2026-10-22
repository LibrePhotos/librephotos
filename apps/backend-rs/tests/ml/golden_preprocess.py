"""Goldens for lp_ml::preprocess and lp_ml::tokenize (the shared helpers).

    python golden_preprocess.py

Writes ml-goldens/preprocess/resize.json: for each image the Pillow-decoded
RGB source (as a lossless PNG under ml-goldens/_decoded/, so Rust resizes
exactly the same pixels) and what Pillow / OpenCV make of it:

  pil_bicubic_crop224   CLIP prepare_image before normalising (shortest edge
                        224 with round(), BICUBIC, centre crop)
  pil_bilinear_crop256  MobileCLIP's (BILINEAR, 256)
  pil_bicubic_224x224   SigLIP 2's direct resize
  pil_bilinear_odd      an odd downscale (LFM2-VL style)
  pil_lanczos_odd       Image.LANCZOS to the same size
  cv2_linear_odd        cv2.resize INTER_LINEAR, non-integer factors
  cv2_linear_up         cv2.resize INTER_LINEAR upscale
  cv2_area_odd          cv2.resize INTER_AREA
  clip_tensor           the full CLIP tensor (first images only)

and ml-goldens/preprocess/tokenize.json: token ids of a few queries for every
tokenizer.json under data_models.
"""

import hashlib

import golden_common as gc

gc.setup()

import cv2  # noqa: E402
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

CLIP_MEAN = np.array([0.48145466, 0.4578275, 0.40821073], dtype=np.float32)
CLIP_STD = np.array([0.26862954, 0.26130258, 0.27577711], dtype=np.float32)


def shortest_edge_crop(image, size, resample):
    width, height = image.size
    scale = size / min(width, height)
    image = image.resize(
        (max(size, round(width * scale)), max(size, round(height * scale))), resample
    )
    width, height = image.size
    left = (width - size) // 2
    top = (height - size) // 2
    return image.crop((left, top, left + size, top + size))


def odd_size(w, h, cap=160):
    s = min(cap / max(w, h), 0.37)
    return max(1, int(w * s) + 3), max(1, int(h * s) + 1)


def images():
    fixture = gc.fixture_images()
    originals = [p for p in fixture if "thumbnails_big" not in p.parts][:12]
    thumbs = [p for p in fixture if "thumbnails_big" in p.parts][:6]
    return originals + thumbs + gc.generated_images()


def resize_cases():
    decoded_dir = gc.GOLDENS / "_decoded"
    decoded_dir.mkdir(parents=True, exist_ok=True)
    cases = []
    for i, path in enumerate(images()):
        with Image.open(path) as im:
            rgb = im.convert("RGB")
        a = np.asarray(rgb)
        cid = gc.case_id(path)
        png = decoded_dir / (hashlib.sha1(cid.encode()).hexdigest()[:16] + ".png")
        rgb.save(png)
        w, h = rgb.size
        ow, oh = odd_size(w, h)
        uw, uh = min(w * 2 + 1, 97), min(h * 2 + 3, 71)
        out = {
            "decoded_sha256": hashlib.sha256(a.tobytes()).hexdigest(),
            "width": w,
            "height": h,
            "pil_bicubic_crop224": gc.arr(np.asarray(shortest_edge_crop(rgb, 224, Image.BICUBIC))),
            "pil_bilinear_crop256": gc.arr(np.asarray(shortest_edge_crop(rgb, 256, Image.BILINEAR))),
            "pil_bicubic_224x224": gc.arr(np.asarray(rgb.resize((224, 224), Image.BICUBIC))),
            "pil_bilinear_odd": gc.arr(np.asarray(rgb.resize((ow, oh), Image.BILINEAR))),
            "pil_lanczos_odd": gc.arr(np.asarray(rgb.resize((ow, oh), Image.LANCZOS))),
            "cv2_linear_odd": gc.arr(cv2.resize(a, (ow, oh))),
            "cv2_linear_up": gc.arr(cv2.resize(a[: min(h, 40), : min(w, 50)], (uw, uh))),
            "cv2_area_odd": gc.arr(cv2.resize(a, (ow, oh), interpolation=cv2.INTER_AREA)),
        }
        if w >= 4 and h >= 4:
            hw, hh = w // 2, h // 2
            src = np.ascontiguousarray(a[: hh * 2, : hw * 2])
            out["cv2_linear_half"] = gc.arr(cv2.resize(src, (hw, hh)))
        if i < 3:
            crop = np.asarray(shortest_edge_crop(rgb, 224, Image.BICUBIC), dtype=np.float32) / 255.0
            t = ((crop - CLIP_MEAN) / CLIP_STD).transpose(2, 0, 1)
            out["clip_tensor"] = gc.arr(np.ascontiguousarray(t))
        cases.append(
            gc.case(
                path,
                {"image": str(path), "decoded_png": str(png), "odd": [ow, oh], "up": [uw, uh]},
                out,
            )
        )
    gc.write("preprocess", "resize", cases, meta={"cv2_simd": cv2.useOptimized()})


QUERIES = [
    "a dog on the beach",
    "Sonnenuntergang über den Bergen",
    "東京タワー at night",
    "",
    "a photo of " + "very " * 40 + "long query",
]


def tokenize_cases():
    from tokenizers import Tokenizer

    cases = []
    for tok_path in sorted(gc.data_models().rglob("tokenizer.json")):
        tok = Tokenizer.from_file(str(tok_path))
        model = tok_path.parent.name
        for q in QUERIES:
            ids = tok.encode(q).ids
            cases.append(
                gc.case(
                    f"{model}:{q[:24]}",
                    {"tokenizer": str(tok_path), "model": model, "text": q},
                    {"ids": ids},
                )
            )
    gc.write("preprocess", "tokenize", cases)


if __name__ == "__main__":
    resize_cases()
    tokenize_cases()
