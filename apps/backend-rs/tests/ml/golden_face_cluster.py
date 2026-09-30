"""Goldens for the in-process face_cluster port (HDBSCAN, MLPClassifier, PCA).

Calls the face_cluster sidecar's routes through Flask's test client (nothing
listens on a port) and its helpers directly:

    cluster.json   /cluster on synthetic identities + the fixture's faces
    train.json     /train (both MLPClassifiers) with held-out truth
    mlp.json       fit_mlp: n_iter_ and predict_proba on fixed inputs
    pca.json       /pca coordinates
    timing.json    wall time of the sidecar code on 5k faces (for the report)

The fixture's encodings are read from fixture_faces.psv next to the goldens
(``id|owner|person|deleted|hex`` exported from a clone of lp_fixture).
"""

import sys
import time

import numpy as np

import golden_common as gc

gc.setup("../backend-rs/sidecars/face_cluster")

import main  # noqa: E402  (the face_cluster sidecar)

client = main.app.test_client()


def hexed(v):
    return np.asarray(v, dtype=np.float64).tobytes().hex()


def identities(seed, n_ids, dim, sizes, spread, noise=0, normalize=True):
    """Points around ``n_ids`` random centers (L2-normalised like ArcFace
    embeddings), sizes drawn from ``sizes``, plus uniform noise points.
    Returns points, the true identity (-1 noise), in shuffled order."""
    rng = np.random.default_rng(seed)
    centers = rng.normal(0, 1, size=(n_ids, dim))
    centers /= np.linalg.norm(centers, axis=1, keepdims=True)
    points, truth = [], []
    for i, c in enumerate(centers):
        for _ in range(int(rng.integers(sizes[0], sizes[1] + 1))):
            p = c + rng.normal(0, spread / np.sqrt(dim), size=dim)
            if normalize:
                p /= np.linalg.norm(p)
            points.append(p)
            truth.append(i)
    for _ in range(noise):
        p = rng.normal(0, 1, size=dim)
        if normalize:
            p /= np.linalg.norm(p)
        points.append(p)
        truth.append(-1)
    order = rng.permutation(len(points))
    return np.array([points[i] for i in order]), [truth[i] for i in order]


def min_cluster_size(n, user=0):
    """face_classify.resolve_min_cluster_size."""
    if user not in (0, 1, None):
        return user
    return 16 if n > 100000 else 8 if n > 10000 else 4 if n > 1000 else 2


def cluster_case(cid, X, truth, mcs=None, ms=1, eps=0.05):
    X = np.asarray(X, dtype=np.float64)
    mcs = mcs if mcs is not None else min_cluster_size(len(X))
    body = {
        "faces": [{"id": i + 1, "encoding": hexed(p)} for i, p in enumerate(X)],
        "min_cluster_size": mcs,
        "min_samples": ms,
        "cluster_selection_epsilon": eps,
    }
    res = client.post("/cluster", json=body)
    out = res.get_json()
    output = {"status": res.status_code}
    if res.status_code == 200:
        output["labels"] = out["labels"]
    else:
        output["error"] = out["error"]
    print(f"cluster {cid}: n={len(X)} -> {res.status_code} "
          f"{len(set(out.get('labels', []))) if res.status_code == 200 else out}")
    return gc.case(
        cid,
        {
            "encodings": gc.arr(X.reshape(len(X), -1) if len(X) else np.zeros((0, 1))),
            "truth": list(truth),
            "min_cluster_size": mcs,
            "min_samples": ms,
            "cluster_selection_epsilon": eps,
        },
        output,
    )


def fixture_faces():
    path = gc.GOLDENS / "face_cluster" / "fixture_faces.psv"
    rows = []
    for line in path.read_text().splitlines():
        fid, owner, person, deleted, enc = line.split("|")
        rows.append((int(fid), int(owner), int(person), deleted == "t", enc))
    return rows


def gen_cluster():
    cases = []
    X, t = identities(1, 4, 512, (18, 18), 0.5, noise=6)
    for eps in (0.05, 0.0, 0.5, 1.0):
        cases.append(cluster_case(f"blobs512_eps{eps}", X, t, eps=eps))
    cases.append(cluster_case("blobs512_ms3_mcs4", X, t, mcs=4, ms=3, eps=0.0))
    cases.append(cluster_case("blobs512_ms5_mcs3_eps0.3", X, t, mcs=3, ms=5, eps=0.3))

    X, t = identities(2, 25, 512, (1, 30), 0.9, noise=40)
    cases.append(cluster_case("ids25_default", X, t))
    cases.append(cluster_case("ids25_mcs5_ms2", X, t, mcs=5, ms=2, eps=0.1))

    X, t = identities(3, 12, 128, (3, 25), 1.2, noise=20, normalize=False)
    cases.append(cluster_case("dim128_overlap", X, t))
    cases.append(cluster_case("dim128_overlap_eps0", X, t, eps=0.0))

    # Exact duplicates (zero distances, infinite lambdas).
    X, t = identities(4, 5, 512, (4, 8), 0.4, noise=3)
    dup = np.concatenate([X, X[:10], X[:3]])
    cases.append(cluster_case("duplicates", dup, t + t[:10] + t[:3]))

    X, t = identities(5, 60, 512, (5, 40), 0.8, noise=150)
    cases.append(cluster_case("ids60_1500", X, t))

    cases.append(cluster_case("zeros_3", np.zeros((3, 8)), [0, 0, 0]))
    cases.append(cluster_case("zeros_2", np.zeros((2, 8)), [0, 0]))
    cases.append(cluster_case("single", np.ones((1, 8)), [0]))

    faces = fixture_faces()
    for owner in sorted({f[1] for f in faces}):
        mine = [f for f in faces if f[1] == owner]
        X = np.array([main.decode(f[4]) for f in mine])
        cases.append(cluster_case(f"fixture_owner{owner}", X, [f[2] for f in mine]))
    X = np.array([main.decode(f[4]) for f in faces])
    cases.append(cluster_case("fixture_all", X, [f[2] for f in faces]))
    gc.write("face_cluster", "cluster", cases)


def train_case(cid, known, clusters, unknown, truth):
    """known: [(person, vec)], clusters: [(person, vec)], unknown: [(id, vec)];
    truth: {id: person} for the held-out faces of labelled persons."""
    body = {
        "known": [{"person_id": int(p), "encoding": hexed(v)} for p, v in known],
        "clusters": [{"person_id": int(p), "encoding": hexed(v)} for p, v in clusters],
        "unknown": [{"id": int(i), "encoding": hexed(v)} for i, v in unknown],
    }
    t0 = time.perf_counter()
    res = client.post("/train", json=body)
    secs = time.perf_counter() - t0
    out = res.get_json()
    output = {"status": res.status_code, "seconds": secs}
    if res.status_code == 200:
        output["predictions"] = out["predictions"]
        hits = [
            p["classification_person_id"] == truth[p["id"]]
            for p in out["predictions"]
            if p["id"] in truth
        ]
        output["accuracy"] = float(np.mean(hits)) if hits else None
    else:
        output["error"] = out["error"]
    print(f"train {cid}: {res.status_code} {secs:.2f}s acc={output.get('accuracy')} "
          f"{out.get('error', '')}")

    def mat(pairs):
        return gc.arr(np.array([v for _, v in pairs])) if pairs else None

    return gc.case(
        cid,
        {
            "known": {"ids": [int(p) for p, _ in known], "encodings": mat(known)},
            "clusters": {"ids": [int(p) for p, _ in clusters], "encodings": mat(clusters)},
            "unknown": {"ids": [int(i) for i, _ in unknown], "encodings": mat(unknown)},
            "truth": {str(k): int(v) for k, v in truth.items()},
        },
        output,
    )


def split(seed, n_ids, n_labelled, dim=512, sizes=(6, 30), spread=0.9, noise=20,
          label_frac=0.5, person_base=100):
    """The first ``n_labelled`` identities are persons with ``label_frac`` of
    their faces labelled (the rest held out); the others become cluster
    centroids (persons 1000+) and unknown faces."""
    X, t = identities(seed, n_ids, dim, sizes, spread, noise=noise)
    known, clusters, unknown, truth = [], [], [], {}
    by_id = {}
    for i, (p, ident) in enumerate(zip(X, t)):
        by_id.setdefault(ident, []).append((i + 1, p))
    for ident, members in sorted(by_id.items()):
        if ident == -1:
            unknown += members
        elif ident < n_labelled:
            cut = max(1, int(len(members) * label_frac))
            known += [(person_base + ident, p) for _, p in members[:cut]]
            unknown += members[cut:]
            truth.update({fid: person_base + ident for fid, _ in members[cut:]})
        else:
            mean = np.mean(a=[p for _, p in members], axis=0, dtype=np.float64)
            clusters.append((1000 + ident, mean))
            unknown += members
    return known, clusters, unknown, truth


def gen_train():
    cases = [
        train_case("ids12_labelled6", *split(11, 12, 6)),
        train_case("ids40_labelled25", *split(12, 40, 25, spread=1.1, noise=60)),
        train_case("binary_no_clusters", *split(13, 2, 2, noise=5)),
        train_case("one_person_with_clusters", *split(14, 5, 1)),
        train_case("one_person_only", *split(15, 1, 1, noise=4)),
        train_case("no_labels_clusters_only", *split(16, 6, 0)),
        train_case("dim128", *split(17, 10, 5, dim=128, spread=1.3)),
        train_case("large_1k_known", *split(18, 60, 50, sizes=(10, 40), spread=1.0,
                                            noise=100, label_frac=0.6)),
        train_case("empty", [], [], [], {}),
    ]
    gc.write("face_cluster", "train", cases)


def gen_mlp():
    cases = []
    for cid, (seed, n_ids, dim, sizes, spread) in {
        "c3": (21, 3, 32, (5, 15), 1.0),
        "c2": (22, 2, 64, (20, 40), 1.5),
        "c1": (23, 1, 16, (5, 5), 1.0),
        "c20_512": (24, 20, 512, (5, 30), 1.2),
    }.items():
        X, t = identities(seed, n_ids, dim, sizes, spread)
        y = np.array([10 + i for i in t])
        clf = main.fit_mlp(X, y)
        Xt, _ = identities(seed + 100, n_ids, dim, sizes, spread)
        cases.append(gc.case(
            cid,
            {"x": gc.arr(X), "y": [int(v) for v in y], "x_test": gc.arr(Xt)},
            {
                "classes": [int(c) for c in clf.classes_],
                "n_iter": int(clf.n_iter_),
                "loss": float(clf.loss_),
                "proba": gc.arr(clf.predict_proba(Xt)),
                "coef0": gc.arr(clf.coefs_[0]),
            },
        ))
        print(f"mlp {cid}: n_iter={clf.n_iter_} loss={clf.loss_:.6f}")
    # The initial weights alone (one epoch would already train them).
    rs = np.random.RandomState(1)
    cases.append(gc.case("rng", {}, {
        "uniform": gc.arr(rs.uniform(-0.1, 0.1, 1000)),
        "shuffle_1000": [int(v) for v in rs.permutation(1000)],
    }))
    gc.write("face_cluster", "mlp", cases)


def gen_pca():
    cases = []
    for cid, (seed, n, dim) in {
        "n50": (31, 50, 512),
        "n800_randomized": (32, 800, 512),
        "n6000_eigh": (33, 6000, 512),
        "n2": (34, 2, 512),
        "n1": (35, 1, 512),
    }.items():
        X, _ = identities(seed, max(1, n // 20), dim, (20, 20), 1.0)
        X = X[:n]
        res = client.post("/pca", json={"encodings": [hexed(v) for v in X]})
        out = res.get_json()
        if res.status_code != 200:
            cases.append(gc.case(cid, {"x": gc.arr(X)}, {"error": out["error"]}))
            continue
        coords = np.array(out["coordinates"], dtype=np.float64)
        cases.append(gc.case(cid, {"x": gc.arr(X)}, {"coordinates": gc.arr(coords)}))
        print(f"pca {cid}: {coords.shape}")
    gc.write("face_cluster", "pca", cases)


def gen_timing():
    """The sidecar code on 5k faces (Django scale >1000: min_cluster_size 4)."""
    X, t = identities(41, 250, 512, (5, 35), 0.9, noise=500)
    X = X[:5000]
    t0 = time.perf_counter()
    res = client.post("/cluster", json={
        "faces": [{"id": i + 1, "encoding": hexed(p)} for i, p in enumerate(X)],
        "min_cluster_size": 4, "min_samples": 1, "cluster_selection_epsilon": 0.05,
    })
    cluster_s = time.perf_counter() - t0
    labels = res.get_json()["labels"]
    known, clusters, unknown, truth = split(42, 250, 150, sizes=(5, 35), noise=500)
    body = {
        "known": [{"person_id": int(p), "encoding": hexed(v)} for p, v in known],
        "clusters": [{"person_id": int(p), "encoding": hexed(v)} for p, v in clusters],
        "unknown": [{"id": int(i), "encoding": hexed(v)} for i, v in unknown],
    }
    t0 = time.perf_counter()
    res = client.post("/train", json=body)
    train_s = time.perf_counter() - t0
    print(f"timing: cluster 5k {cluster_s:.1f}s, train {len(known)}+{len(clusters)} "
          f"-> {len(unknown)} {train_s:.1f}s")
    gc.write("face_cluster", "timing", [gc.case("5k", {
        "cluster_faces": len(X), "known": len(known), "clusters": len(clusters),
        "unknown": len(unknown),
    }, {
        "cluster_seconds": cluster_s, "train_seconds": train_s,
        "clusters_found": len(set(labels)) - (1 if -1 in labels else 0),
    })])


def gen_edge():
    """cluster_edge / train_edge / pca_edge: non-finite encodings, a 5k
    library, and train splits hard enough that the held-out accuracy is
    below 1 (overlapping identities, few labels)."""
    cases = []
    X, t = identities(51, 6, 512, (6, 12), 0.6, noise=4)
    X = X.copy()
    X[3, 7] = np.nan
    X[10, 0] = np.inf
    X[11, 5] = -np.inf
    cases.append(cluster_case("nonfinite_rows", X, t, eps=0.0))
    cases.append(cluster_case("all_nan", np.full((3, 8), np.nan), [0, 0, 0]))
    Y = np.random.default_rng(52).normal(size=(3, 8))
    Y[1] = np.nan
    cases.append(cluster_case("two_finite", Y, [0, 0, 0]))
    X, t = identities(41, 250, 512, (5, 35), 0.9, noise=500)
    cases.append(cluster_case("ids250_5000", X[:5000], t[:5000]))
    gc.write("face_cluster", "cluster_edge", cases)

    cases = [
        train_case("hard_overlap", *split(61, 30, 20, sizes=(4, 20), spread=1.6,
                                          noise=40, label_frac=0.3)),
        train_case("hard_few_labels", *split(62, 80, 60, sizes=(3, 12), spread=1.4,
                                             noise=100, label_frac=0.25)),
        train_case("hard_dim128", *split(63, 25, 15, dim=128, sizes=(4, 16), spread=1.8,
                                         noise=30, label_frac=0.4)),
    ]
    known, clusters, unknown, truth = split(64, 5, 3, noise=3)
    bad = [(p, v.copy()) for p, v in known]
    bad[1][1][4] = np.nan
    cases.append(train_case("nan_known", bad, clusters, unknown, truth))
    bad_unknown = [(i, v.copy()) for i, v in unknown]
    bad_unknown[-1][1][0] = np.inf
    cases.append(train_case("inf_unknown", known, clusters, bad_unknown, truth))
    cases.append(train_case("nothing_to_predict", known, clusters, [], {}))
    gc.write("face_cluster", "train_edge", cases)

    X, _ = identities(71, 3, 512, (20, 20), 1.0)
    X = X[:30].copy()
    X[4, 2] = np.nan
    res = client.post("/pca", json={"encodings": [hexed(v) for v in X]})
    cases = [gc.case("nan", {"x": gc.arr(X)}, {"error": res.get_json()["error"]})]
    X[4, 2] = np.inf
    res = client.post("/pca", json={"encodings": [hexed(v) for v in X]})
    cases.append(gc.case("inf", {"x": gc.arr(X)}, {"error": res.get_json()["error"]}))
    gc.write("face_cluster", "pca_edge", cases)


if __name__ == "__main__":
    which = sys.argv[1:] or ["cluster", "train", "mlp", "pca", "edge"]
    for w in which:
        globals()[f"gen_{w}"]()
