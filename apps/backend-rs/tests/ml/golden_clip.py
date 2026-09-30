"""Goldens for lp_ml::clip (service/clip_embeddings/clip_onnx.py).

    python golden_clip.py

Writes ml-goldens/clip/images.json (one ``encode_images`` call over every
default image plus a missing path, so the batching of 32 and the ``None``
slot are what the sidecar does), ml-goldens/clip/edge.json (damaged,
16-bit, CMYK, palette, EXIF-rotated, animated, tiny/huge images: which ones
Pillow reads, and their embeddings) and ml-goldens/clip/text.json (queries,
including one longer than the 77-token context).
"""

import numpy as np

import golden_common as gc

gc.setup("service/clip_embeddings")

from clip_onnx import ClipEmbeddings  # noqa: E402

QUERIES = [
    "dog",
    "a photo of a cat sleeping on a sofa",
    "Sunset at the beach",
    "people at a birthday party with a cake",
    "snow mountain",
    "",
    "Grüße aus München, 日本の桜",
    "receipt",
    " ".join(["a very long query about a red bicycle in the rain"] * 12),
]


# Edge-case images other areas generated (shared under _images/), plus ours.
EDGE_SETS = ("tags_edge", "caption_edge", "faces_edge", "clip_edge")


def clip_edge_images():
    """Damaged files and bit depths the other edge sets leave out."""
    import io

    import cv2
    from PIL import Image

    d = gc.GOLDENS / "_images" / "clip_edge"
    d.mkdir(parents=True, exist_ok=True)
    x = np.linspace(0, 65535, 96, dtype=np.float64)
    y = np.linspace(0, 65535, 64, dtype=np.float64)
    r = np.tile(x, (64, 1))
    g = np.tile(y[:, None], (1, 96))
    rgb16 = np.stack([r, g, (r + g) / 2], -1).astype(np.uint16)
    buf = io.BytesIO()
    Image.fromarray((rgb16 >> 8).astype(np.uint8), "RGB").save(buf, "PNG")
    png = buf.getvalue()
    buf = io.BytesIO()
    Image.fromarray((rgb16 >> 8).astype(np.uint8), "RGB").save(buf, "JPEG", quality=90)
    jpeg = buf.getvalue()
    files = {
        "png_cut_in_iend.png": png[:-6],
        "png_cut_in_data.png": png[: len(png) // 2],
        "jpeg_cut_2.jpg": jpeg[:-2],
        "jpeg_trailing_junk.jpg": jpeg + b"\x00" * 64,
        "zero_bytes.jpg": b"",
        "text_named.png": b"this is not an image",
        "rgb16_96x64.png": cv2.imencode(".png", rgb16[:, :, ::-1].copy())[1].tobytes(),
        "rgba16_96x64.png": cv2.imencode(
            ".png",
            np.dstack([rgb16[:, :, ::-1], np.full((64, 96), 30000, np.uint16)]),
        )[1].tobytes(),
        "gray16_hi_96x64.png": cv2.imencode(".png", rgb16[:, :, 0].copy())[1].tobytes(),
    }
    for name, data in files.items():
        p = d / name
        if not p.exists():
            p.write_bytes(data)
    big = d / "big_6000x4000.jpg"
    if not big.exists():
        Image.fromarray((rgb16 >> 8).astype(np.uint8), "RGB").resize(
            (6000, 4000), Image.BILINEAR
        ).save(big, "JPEG", quality=80)


def edge(clip, model):
    clip_edge_images()
    paths = []
    for name in EDGE_SETS:
        d = gc.GOLDENS / "_images" / name
        if d.is_dir():
            paths += sorted(p for p in d.iterdir() if p.is_file() and p.suffix != ".md")
    embeddings = clip.encode_images([str(p) for p in paths], model)
    cases = []
    for path, emb in zip(paths, embeddings):
        out = {"embedding": None, "magnitude": None}
        if emb is not None:
            out = {"embedding": gc.arr(emb), "magnitude": float(np.linalg.norm(emb))}
        cases.append(gc.case(path, {"image": str(path)}, out))
    gc.write("clip", "edge", cases, meta={"model": "clip_vit_b32", "batch": len(paths)})


def main():
    clip = ClipEmbeddings()
    model = str(gc.data_models() / "clip_vit_b32")
    images = gc.default_images()
    paths = [str(p) for p in images]
    missing = str(gc.GOLDENS / "_images" / "does_not_exist.jpg")
    embeddings = clip.encode_images(paths + [missing], model)

    cases = []
    for path, emb in zip(images + [missing], embeddings):
        out = {"embedding": None, "magnitude": None}
        if emb is not None:
            out = {"embedding": gc.arr(emb), "magnitude": float(np.linalg.norm(emb))}
        cases.append(gc.case(path if not isinstance(path, str) else "missing", {"image": str(path)}, out))
    gc.write(
        "clip",
        "images",
        cases,
        meta={"model": "clip_vit_b32", "batch": len(paths) + 1},
    )

    cases = []
    for i, q in enumerate(QUERIES):
        ids = clip.tokenizer.encode(q).ids[:77]
        emb = clip.encode_text(q, model)
        cases.append(
            gc.case(
                f"q{i}",
                {"query": q},
                {
                    "ids": gc.arr(np.array(ids, dtype=np.int64)),
                    "embedding": gc.arr(emb),
                    "magnitude": float(np.linalg.norm(emb)),
                },
            )
        )
    gc.write("clip", "text", cases, meta={"model": "clip_vit_b32"})
    edge(clip, model)


if __name__ == "__main__":
    main()
