"""Goldens for lp_ml::similarity (image_similarity/retrieval_index.py).

    python golden_similarity.py      # after golden_clip.py

Builds a RetrievalIndex (FAISS IndexFlatIP) the way a rebuild does (paged,
begin/commit, hashes in sorted order) from real CLIP embeddings (the
clip/images golden) plus synthetic vectors around them (near-duplicates and
exact duplicates for ties), then records ``search_similar`` for image
queries (threshold 90, the photo detail; and 27) and the text-query
embeddings of clip/text (threshold 27, several n).

Writes ml-goldens/similarity/search.json: meta holds the index (hashes +
embeddings in insertion order); each case is one search.
"""

import base64
import json
import tempfile

import numpy as np

import golden_common as gc

gc.setup("image_similarity")

from retrieval_index import RetrievalIndex  # noqa: E402

PAGE = 250


def load(name):
    doc = json.loads((gc.GOLDENS / "clip" / f"{name}.json").read_text(encoding="utf-8"))
    return doc["cases"]


def f32(a):
    return np.frombuffer(base64.b64decode(a["b64"]), dtype="<f4").reshape(a["shape"])


def main():
    rng = np.random.default_rng(20260930)
    real = [f32(c["output"]["embedding"]) for c in load("images") if c["output"]["embedding"]]
    vectors = list(real)
    # Near-duplicates of the real ones (scores around the 90 threshold) and
    # exact duplicates (ties).
    for base in real:
        for scale in (0.02, 0.05, 0.1, 0.2):
            noise = rng.normal(0, 1, base.shape).astype(np.float32)
            noise *= np.linalg.norm(base) * scale / np.linalg.norm(noise)
            vectors.append((base + noise).astype(np.float32))
    vectors += [real[0].copy(), real[0].copy(), real[5].copy()]
    # Unrelated random ones at a CLIP-like magnitude.
    for _ in range(1500):
        v = rng.normal(0, 1, 512).astype(np.float32)
        vectors.append((v * 10.5 / np.linalg.norm(v)).astype(np.float32))

    hashes = [f"{i:032x}{7}" for i in rng.permutation(len(vectors))]
    order = sorted(range(len(vectors)), key=lambda i: hashes[i])
    hashes = [hashes[i] for i in order]
    vectors = [vectors[i] for i in order]

    index = RetrievalIndex(store_dir=tempfile.mkdtemp())
    user = 7
    pages = max(1, -(-len(vectors) // PAGE))
    for p in range(pages):
        lo, hi = p * PAGE, (p + 1) * PAGE
        if p == 0:
            index.begin_rebuild(user)
        index.add_to_rebuild(user, hashes[lo:hi], [v.tolist() for v in vectors[lo:hi]])
    size = index.commit_rebuild(user)
    assert size == len(vectors)

    cases = []
    queries = [(f"img{i}", real[i]) for i in range(len(real))]
    queries += [(f"near{i}", vectors[i]) for i in range(0, len(vectors), 97)]
    for qid, q in queries:
        for n, thr in ((None, 90), (100, 27), (10, 90), (5, 27)):
            res = index.search_similar(user, q.tolist(), 100 if n is None else n, thr)
            out = {"result": res}
            if n is None:
                # FAISS's raw top-100 inner products, for a bitwise check.
                dist, ids = index.indices[user].search(np.array([q], dtype=np.float32), 100)
                out["faiss_ids"] = gc.arr(ids[0].astype(np.int64))
                out["faiss_dist"] = gc.arr(dist[0])
            cases.append(
                gc.case(
                    f"{qid}_n{n}_t{thr}",
                    {"embedding": gc.arr(q), "n": n, "threshold": thr},
                    out,
                )
            )
    for c in load("text"):
        q = f32(c["output"]["embedding"])
        for n, thr in ((100, 27), (20, 27), (100, 20), (3, 0)):
            res = index.search_similar(user, q.tolist(), n, thr)
            cases.append(
                gc.case(
                    f"text_{c['id']}_n{n}_t{thr}",
                    {"embedding": gc.arr(q), "n": n, "threshold": thr},
                    {"result": res},
                )
            )
    nonempty = sum(1 for c in cases if c["output"]["result"])
    print(f"{len(cases)} searches, {nonempty} with hits")
    gc.write(
        "similarity",
        "search",
        cases,
        meta={
            "user_id": user,
            "hashes": hashes,
            "embeddings": gc.arr(np.stack(vectors)),
            "page": PAGE,
        },
    )


if __name__ == "__main__":
    main()
