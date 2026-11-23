"""Parity check: the sidecar against api/face_classify.py on the same input.

Run with the backend's venv (it needs Django importable for face_classify):

    PY=.../apps/backend/.venv-win/Scripts/python.exe
    $PY apps/backend-rs/sidecars/face_cluster/test_face_cluster.py

Uses Flask's test client, so nothing listens on a port. Exits non-zero on the
first mismatch.
"""

import os
import sys
import tempfile
from types import SimpleNamespace

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
BACKEND = os.path.join(REPO, "apps", "backend")
FIXTURE = os.path.join(REPO, "apps", "backend-rs", "tests", "fixture")

sys.path.insert(0, HERE)
sys.path.insert(0, BACKEND)
sys.path.insert(0, FIXTURE)
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "lp_twin_settings")
os.environ.setdefault("SECRET_KEY", "face-cluster-parity")
SCRATCH = tempfile.mkdtemp(prefix="face-cluster-parity-")
os.environ.setdefault("BASE_DATA", SCRATCH)
os.environ.setdefault("BASE_LOGS", os.path.join(SCRATCH, "logs"))
os.makedirs(os.environ["BASE_LOGS"], exist_ok=True)

import django  # noqa: E402

django.setup()

from api import face_classify  # noqa: E402

import main  # noqa: E402

client = main.app.test_client()


def hexed(vector):
    return np.asarray(vector, dtype=np.float64).tobytes().hex()


def synthetic(seed=7, per_blob=18, blobs=4, noise=6, dim=512):
    rng = np.random.default_rng(seed)
    centers = rng.normal(0, 1, size=(blobs, dim))
    points, truth = [], []
    for b, center in enumerate(centers):
        for _ in range(per_blob):
            points.append(center + rng.normal(0, 0.08, size=dim))
            truth.append(b)
    for _ in range(noise):
        points.append(rng.normal(0, 1, size=dim))
        truth.append(-1)
    order = rng.permutation(len(points))
    return [points[i] for i in order], [truth[i] for i in order]


def check_cluster(points, user):
    n = len(points)
    reference = face_classify.build_clusterer(user, n).fit(np.array(points)).labels_
    body = {
        "faces": [{"id": i + 1, "encoding": hexed(p)} for i, p in enumerate(points)],
        "min_cluster_size": face_classify.resolve_min_cluster_size(user, n),
        "min_samples": user.min_samples if user.min_samples > 0 else 1,
        "cluster_selection_epsilon": user.cluster_selection_epsilon,
    }
    res = client.post("/cluster", json=body)
    assert res.status_code == 200, res.data
    labels = res.get_json()["labels"]
    assert labels == [int(x) for x in reference], (labels, list(reference))
    assert res.get_json()["ids"] == list(range(1, n + 1))
    return labels


def check_train(points, labels):
    # Label every face of the first two clusters as persons 101/102, keep the
    # rest unknown, and give every other cluster a centroid "person".
    known, clusters, unknown = [], [], []
    by_label = {}
    for i, (p, label) in enumerate(zip(points, labels)):
        by_label.setdefault(label, []).append((i + 1, p))
    real = sorted(label for label in by_label if label != -1)
    persons = {real[0]: 101, real[1]: 102}
    centroid_person = 200
    for label in real:
        members = by_label[label]
        if label in persons:
            for face_id, p in members[: len(members) // 2]:
                known.append((face_id, persons[label], p))
            for face_id, p in members[len(members) // 2 :]:
                unknown.append((face_id, p))
        else:
            centroid_person += 1
            mean = np.mean(a=[p for _, p in members], axis=0, dtype=np.float64)
            clusters.append((centroid_person, mean))
            for face_id, p in members:
                unknown.append((face_id, p))
    for face_id, p in by_label.get(-1, []):
        unknown.append((face_id, p))

    # Django's train_faces, minus the ORM.
    data_known = {"encoding": [p for _, _, p in known], "id": [pid for _, pid, _ in known]}
    classifier = face_classify.fit_mlp(
        np.array(data_known["encoding"]), np.array(data_known["id"])
    )
    for pid, mean in clusters:
        data_known["encoding"].append(mean)
        data_known["id"].append(pid)
    enc, ids = face_classify.filter_data(data_known["encoding"], data_known["id"])
    cluster_classifier = face_classify.fit_mlp(enc, ids)
    expected = {}
    unknown_enc = [p for _, p in unknown]
    unknown_ids = [face_id for face_id, _ in unknown]
    for start in range(0, len(unknown_enc), 100):
        page = np.array(unknown_enc[start : start + 100])
        cps = cluster_classifier.predict_proba(page)
        clps = classifier.predict_proba(page)
        for face_id, cp, clp in zip(unknown_ids[start : start + 100], cps, clps):
            cperson, cprob = face_classify.most_probable_class(cluster_classifier.classes_, cp)
            kperson, kprob = face_classify.most_probable_class(classifier.classes_, clp)
            expected[face_id] = (int(cperson), float(cprob), int(kperson), float(kprob))

    body = {
        "known": [{"person_id": pid, "encoding": hexed(p)} for _, pid, p in known],
        "clusters": [{"person_id": pid, "encoding": hexed(m)} for pid, m in clusters],
        "unknown": [{"id": face_id, "encoding": hexed(p)} for face_id, p in unknown],
    }
    res = client.post("/train", json=body)
    assert res.status_code == 200, res.data
    got = {
        p["id"]: (
            p["cluster_person_id"],
            p["cluster_probability"],
            p["classification_person_id"],
            p["classification_probability"],
        )
        for p in res.get_json()["predictions"]
    }
    assert got == expected, "train predictions differ from face_classify"
    return len(got)


def check_train_without_labels(points):
    # No labelled faces: classifier is None, classification stays empty.
    clusters = [{"person_id": 7, "encoding": hexed(points[0])},
                {"person_id": 8, "encoding": hexed(points[1])}]
    unknown = [{"id": 1, "encoding": hexed(points[2])}]
    res = client.post("/train", json={"known": [], "clusters": clusters, "unknown": unknown})
    assert res.status_code == 200, res.data
    (pred,) = res.get_json()["predictions"]
    assert pred["classification_person_id"] is None
    assert pred["classification_probability"] == 0.0
    assert pred["cluster_person_id"] in (7, 8)


def check_train_error_matches_django():
    try:
        face_classify.fit_mlp(*face_classify.filter_data([], []))
        raise AssertionError("expected sklearn to refuse an empty training set")
    except ValueError as err:
        expected = str(err)
    res = client.post("/train", json={"known": [], "clusters": [], "unknown": []})
    assert res.status_code == 500
    assert res.get_json()["error"] == expected, (res.get_json(), expected)


def check_pca(points):
    # cluster_faces' PCA picks the randomized solver without a random_state,
    # so Django itself differs run to run; only the shape is comparable.
    res = client.post("/pca", json={"encodings": [hexed(p) for p in points[:20]]})
    assert res.status_code == 200, res.data
    got = np.array(res.get_json()["coordinates"])
    assert got.shape == (20, 3) and np.isfinite(got).all(), got.shape
    too_few = client.post("/pca", json={"encodings": [hexed(points[0])]})
    assert too_few.status_code == 500 and "n_components" in too_few.get_json()["error"]


def check_conventions():
    assert client.get("/health").get_json()["service"] == "face_cluster"
    assert client.post("/cluster", data="nope").status_code == 400
    assert client.post("/cluster", json={"faces": []}).status_code == 400
    assert client.post("/unload-model").status_code == 200


def main_():
    points, _ = synthetic()
    user = SimpleNamespace(min_cluster_size=0, min_samples=1, cluster_selection_epsilon=0.05)
    labels = check_cluster(points, user)
    clusters = len({x for x in labels if x != -1})
    assert clusters >= 3, labels
    tuned = SimpleNamespace(min_cluster_size=5, min_samples=3, cluster_selection_epsilon=0.0)
    check_cluster(points, tuned)
    predicted = check_train(points, labels)
    check_train_without_labels(points)
    check_train_error_matches_django()
    check_pca(points)
    check_conventions()
    print(f"face_cluster parity OK: {len(points)} faces, {clusters} clusters, "
          f"{predicted} predictions identical to api/face_classify.py")


if __name__ == "__main__":
    main_()
