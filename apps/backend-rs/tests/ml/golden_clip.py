"""Goldens for lp_ml::clip (service/clip_embeddings/clip_onnx.py).

    python golden_clip.py

Writes ml-goldens/clip/images.json (one ``encode_images`` call over every
default image plus a missing path, so the batching of 32 and the ``None``
slot are what the sidecar does) and ml-goldens/clip/text.json (queries,
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


if __name__ == "__main__":
    main()
