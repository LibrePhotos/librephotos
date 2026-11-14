"""face_cluster sidecar (port 8013): the numeric half of api/face_classify.py.

The Rust backend does every database read and write; this service only runs
the scikit-learn / HDBSCAN steps on the encodings it is sent, exactly as
face_classify.py runs them, so the same input gives the same labels and
probabilities.

Encodings travel as Django stores them: ``ndarray.tobytes().hex()`` of a
float64 vector.

``POST /cluster``
    ``{faces: [{id, encoding}], min_cluster_size, min_samples,
    cluster_selection_epsilon}`` -> ``{ids, labels}`` (HDBSCAN, euclidean).
``POST /train``
    ``{known: [{person_id, encoding}], clusters: [{person_id, encoding}],
    unknown: [{id, encoding}]}`` -> ``{predictions: [{id, cluster_person_id,
    cluster_probability, classification_person_id,
    classification_probability}]}``. One MLPClassifier on the labelled faces,
    one on the labelled faces plus the cluster centroids (``train_faces``).
``POST /pca``
    ``{encodings: [hex]}`` -> ``{coordinates: [[x, y, z]]}`` for the face
    scatter plot (``cluster_faces``).

A failed fit answers ``{"error": str(exception)}`` with 500; the backend
stores that text as the job's error, as Django's ``lrj.fail(error=err)`` does.
"""

import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _common import create_app, json_fields, logger, serve_forever  # noqa: E402

PORT = 8013
# train_faces predicts the unknown faces in pages of 100; the page size is
# kept so the matrix products (and the probabilities) are the same.
PREDICT_PAGE = 100

log = logger("face_cluster")
app = create_app("face_cluster", unload=lambda: None, is_loaded=lambda: False)


class FitError(Exception):
    pass


def decode(encoding):
    return np.frombuffer(bytes.fromhex(encoding))


def filter_data(encodings, ids):
    """face_classify.filter_data: keep the entries shaped like the first."""
    valid_encodings = []
    valid_ids = []
    expected_shape = len(encodings[0]) if encodings else 0
    for i, (encoding, id_) in enumerate(zip(encodings, ids)):
        if len(encoding) == expected_shape:
            valid_encodings.append(encoding)
            valid_ids.append(id_)
        else:
            log(
                f"Discarding entry {i}: ID={id_}, encoding shape={len(encoding)} "
                f"(expected {expected_shape})"
            )
    return np.array(valid_encodings), np.array(valid_ids)


def fit_mlp(encodings, ids):
    from sklearn.neural_network import MLPClassifier

    return MLPClassifier(solver="adam", alpha=1e-5, random_state=1, max_iter=1000).fit(
        encodings, ids
    )


def most_probable_class(classes, probabilities):
    """The last class whose probability equals the highest one, and that probability"""
    highest_probability = max(probabilities)
    highest_class = 0
    for i, target in enumerate(classes):
        if highest_probability == probabilities[i]:
            highest_class = target
    return highest_class, highest_probability


def _failed(error):
    log(f"{type(error).__name__}: {error}")
    return {"error": str(error), "type": type(error).__name__}, 500


@app.route("/cluster", methods=["POST"])
def cluster():
    faces, min_cluster_size, min_samples, epsilon = json_fields(
        "faces", "min_cluster_size", min_samples=1, cluster_selection_epsilon=0.0
    )
    ids = [face["id"] for face in faces]
    if not faces:
        return {"ids": [], "labels": []}, 200
    try:
        from hdbscan import HDBSCAN

        clt = HDBSCAN(
            min_cluster_size=int(min_cluster_size),
            min_samples=int(min_samples),
            cluster_selection_epsilon=float(epsilon),
            metric="euclidean",
        )
        clt.fit(np.array([decode(face["encoding"]) for face in faces]))
    except Exception as error:
        return _failed(error)
    return {"ids": ids, "labels": [int(label) for label in clt.labels_]}, 200


@app.route("/train", methods=["POST"])
def train():
    known, unknown, clusters = json_fields("known", "unknown", clusters=[])
    try:
        predictions = _train(known, clusters, unknown)
    except Exception as error:
        return _failed(error)
    return {"predictions": predictions}, 200


def _train(known, clusters, unknown):
    known_encodings = [decode(face["encoding"]) for face in known]
    known_ids = [face["person_id"] for face in known]

    classifier = None
    if known_ids:
        classifier = fit_mlp(np.array(known_encodings), np.array(known_ids))

    for centroid in clusters:
        known_encodings.append(decode(centroid["encoding"]))
        known_ids.append(centroid["person_id"])
    filtered_encodings, filtered_ids = filter_data(known_encodings, known_ids)
    cluster_classifier = fit_mlp(filtered_encodings, filtered_ids)

    unknown_encodings = [decode(face["encoding"]) for face in unknown]
    unknown_ids = [face["id"] for face in unknown]
    if unknown_encodings:
        filtered_unknown, filtered_unknown_ids = filter_data(
            unknown_encodings, unknown_ids
        )
        unknown_encodings = list(filtered_unknown)
        unknown_ids = [int(face_id) for face_id in filtered_unknown_ids]

    predictions = []
    for start in range(0, len(unknown_encodings), PREDICT_PAGE):
        page = np.array(unknown_encodings[start : start + PREDICT_PAGE])
        page_ids = unknown_ids[start : start + PREDICT_PAGE]
        cluster_probs = cluster_classifier.predict_proba(page)
        if classifier:
            classification_probs = classifier.predict_proba(page)
        else:
            classification_probs = [
                [0.0] * len(cluster_classifier.classes_) for _ in cluster_probs
            ]
        for face_id, cluster_p, classification_p in zip(
            page_ids, cluster_probs, classification_probs
        ):
            classification_person = None
            classification_probability = 0.0
            if classifier:
                classification_person, classification_probability = (
                    most_probable_class(classifier.classes_, classification_p)
                )
            cluster_person, cluster_probability = most_probable_class(
                cluster_classifier.classes_, cluster_p
            )
            predictions.append(
                {
                    "id": int(face_id),
                    "cluster_person_id": int(cluster_person),
                    "cluster_probability": float(cluster_probability),
                    "classification_person_id": (
                        int(classification_person) if classification_person else None
                    ),
                    "classification_probability": float(classification_probability),
                }
            )
    return predictions


@app.route("/pca", methods=["POST"])
def pca():
    (encodings,) = json_fields("encodings")
    if not encodings:
        return {"coordinates": []}, 200
    try:
        from sklearn.decomposition import PCA

        vis = PCA(n_components=3).fit_transform([decode(e) for e in encodings])
    except Exception as error:
        return _failed(error)
    return {"coordinates": [[float(v) for v in row] for row in vis]}, 200


def serve():
    serve_forever(app, "face_cluster", PORT)


if __name__ == "__main__":
    serve()
