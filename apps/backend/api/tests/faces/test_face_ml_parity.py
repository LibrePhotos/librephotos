"""The numpy face clustering, classifier and PCA give what the libraries did.

``api.faces.hdbscan``, ``api.faces.mlp`` and ``api.faces.pca`` replace the
``hdbscan`` package and scikit-learn. The expected values in
``api/tests/fixtures/face_ml_parity.json`` were computed once with
hdbscan 0.8.44 and scikit-learn 1.9.1 (neither is installed any more) on the
inputs built below, which come from ``numpy.random.RandomState``, whose
streams numpy keeps stable.

When tree edges tie, the order ``argsort`` gives them can change a label,
and that order depends on the CPU's sort kernel (for hdbscan too). Every
clustering case here gives the same labels whatever the tie order, so the
labels are compared exactly on any machine. The classifier is compared with a
tolerance: BLAS adds in a different order on other CPUs.
"""

import json
from pathlib import Path

import numpy as np
from django.test import SimpleTestCase

from api.faces.hdbscan import HDBSCAN, core_distances, hdbscan_labels
from api.faces.mlp import MLPClassifier
from api.faces.pca import PCA

FIXTURE = Path(__file__).resolve().parent.parent / "fixtures" / "face_ml_parity.json"

# (seed, faces, people, min_cluster_size, min_samples, cluster_selection_epsilon)
CLUSTERING_CASES = [
    (1, 40, 4, 2, 1, 0.0),
    (2, 120, 8, 2, 1, 0.95),
    (3, 120, 8, 2, 1, 0.0),
    (104, 200, 12, 3, 2, 0.9),
    (205, 200, 12, 4, 3, 0.5),
    (6, 300, 20, 2, 1, 1.0),
    (7, 300, 20, 4, 1, 0.0),
    (8, 400, 30, 2, 1, 1.05),
]

# (seed, people, faces per person)
CLASSIFIER_CASES = [(11, 1, 6), (12, 2, 15), (13, 5, 12), (14, 12, 8)]


def face_encodings(
    seed: int, faces: int, people: int, dimensions: int = 128
) -> np.ndarray:
    """Unit-length encodings: people with faces at different spreads, plus strangers."""
    rng = np.random.RandomState(seed)
    centers = rng.normal(size=(people, dimensions))
    centers /= np.linalg.norm(centers, axis=1, keepdims=True)
    strangers = faces // 5
    who = rng.randint(0, people, faces - strangers)
    spread = rng.uniform(0.02, 0.09, size=(len(who), 1))
    encodings = np.vstack(
        [
            centers[who] + spread * rng.normal(size=(len(who), dimensions)),
            rng.normal(size=(strangers, dimensions)),
        ]
    )
    encodings /= np.linalg.norm(encodings, axis=1, keepdims=True)
    return encodings[rng.permutation(faces)]


def classifier_data(
    seed: int, people: int, per_person: int, dimensions: int = 32
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Training encodings, their person ids, and faces to predict, scaled as
    ``classifier_input`` scales them."""
    rng = np.random.RandomState(seed)
    centers = rng.normal(size=(people, dimensions))
    centers /= np.linalg.norm(centers, axis=1, keepdims=True)
    ids = rng.choice(1000, people, replace=False) + 1

    def around(scale: float, count: int) -> np.ndarray:
        points = np.repeat(centers, count, axis=0) + rng.normal(
            scale=scale, size=(people * count, dimensions)
        )
        points /= np.linalg.norm(points, axis=1, keepdims=True)
        return points * np.sqrt(dimensions)

    return around(0.15, per_person), np.repeat(ids, per_person), around(0.25, 3)


def pca_data(seed: int, faces: int) -> np.ndarray:
    return face_encodings(seed, faces, max(2, faces // 10), dimensions=64)


def _fixture() -> dict:
    with FIXTURE.open(encoding="utf-8") as handle:
        return json.load(handle)


class HdbscanParityTest(SimpleTestCase):
    def test_labels_match_hdbscan(self):
        expected = _fixture()["hdbscan"]
        for case in CLUSTERING_CASES:
            seed, faces, people, min_cluster_size, min_samples, epsilon = case
            with self.subTest(case=case):
                labels = (
                    HDBSCAN(
                        min_cluster_size=min_cluster_size,
                        min_samples=min_samples,
                        cluster_selection_epsilon=epsilon,
                    )
                    .fit(face_encodings(seed, faces, people))
                    .labels_
                )
                self.assertEqual(labels.tolist(), expected[str(seed)])

    def test_core_distance_is_the_kth_nearest_including_the_point_itself(self):
        points = np.array([[0.0, 0.0], [3.0, 4.0], [6.0, 8.0], [0.0, 1.0]])
        diagonal, far = np.sqrt(18.0), np.sqrt(85.0)
        self.assertEqual(core_distances(points, 1).tolist(), [1.0, diagonal, 5.0, 1.0])
        self.assertEqual(core_distances(points, 2).tolist(), [5.0, 5.0, far, diagonal])

    def test_fewer_than_two_faces_are_refused(self):
        # As hdbscan, whose nearest-neighbour query fails on them.
        for points in (np.empty((0, 4)), np.ones((1, 4))):
            with self.subTest(rows=len(points)), self.assertRaises(ValueError):
                hdbscan_labels(points, 2, 1, 0.0)

    def test_rows_with_missing_values_are_noise(self):
        points = face_encodings(1, 40, 4)
        points[[3, 17]] = np.nan
        labels = hdbscan_labels(points, 2, 1, 0.0)
        self.assertEqual(labels[[3, 17]].tolist(), [-1, -1])
        clean = hdbscan_labels(np.delete(points, [3, 17], axis=0), 2, 1, 0.0)
        self.assertEqual(np.delete(labels, [3, 17]).tolist(), clean.tolist())

    def test_identical_faces_cluster_together(self):
        points = np.repeat(face_encodings(2, 6, 6), 3, axis=0)
        labels = hdbscan_labels(points, 2, 1, 0.0).reshape(6, 3)
        self.assertTrue((labels == labels[:, :1]).all())
        self.assertEqual(len(set(labels[:, 0])), 6)

    def test_invalid_parameters_are_refused(self):
        points = face_encodings(1, 10, 2)
        for arguments in ((1, 1, 0.0), (2, 0, 0.0), (2, 1, -0.5)):
            with self.subTest(arguments=arguments), self.assertRaises(ValueError):
                hdbscan_labels(points, *arguments)
        with self.assertRaises(ValueError):
            HDBSCAN(
                min_cluster_size=2,
                min_samples=1,
                cluster_selection_epsilon=0.0,
                metric="cosine",
            )


class MlpParityTest(SimpleTestCase):
    def test_training_matches_scikit_learn(self):
        expected = _fixture()["mlp"]
        for seed, people, per_person in CLASSIFIER_CASES:
            with self.subTest(seed=seed):
                encodings, ids, queries = classifier_data(seed, people, per_person)
                classifier = MLPClassifier(
                    alpha=1e-5, random_state=1, max_iter=1000
                ).fit(encodings, ids)
                case = expected[str(seed)]
                self.assertEqual(classifier.classes_, case["classes"])
                self.assertEqual(classifier.n_iter_, case["n_iter"])
                np.testing.assert_allclose(
                    classifier.predict_proba(queries),
                    case["probabilities"],
                    rtol=1e-7,
                    atol=1e-10,
                )

    def test_one_class_gets_two_probability_columns(self):
        # As scikit-learn: classes_ has one entry, predict_proba two columns.
        encodings, ids, queries = classifier_data(11, 1, 6)
        classifier = MLPClassifier(alpha=1e-5, random_state=1, max_iter=1000)
        probabilities = classifier.fit(encodings, ids).predict_proba(queries)
        self.assertEqual(len(classifier.classes_), 1)
        self.assertEqual(probabilities.shape, (3, 2))
        np.testing.assert_allclose(probabilities.sum(axis=1), 1.0)

    def test_max_iter_stops_training(self):
        encodings, ids, _ = classifier_data(13, 5, 12)
        classifier = MLPClassifier(alpha=1e-5, random_state=1, max_iter=3)
        self.assertEqual(classifier.fit(encodings, ids).n_iter_, 3)

    def test_non_finite_weights_are_refused(self):
        encodings, ids, _ = classifier_data(12, 2, 15)
        with np.errstate(all="ignore"), self.assertRaises(ValueError):
            MLPClassifier(alpha=np.inf, random_state=1, max_iter=2).fit(encodings, ids)


class PcaParityTest(SimpleTestCase):
    def test_coordinates_match_scikit_learn(self):
        expected = _fixture()["pca"]
        for faces in (5, 40, 120):
            with self.subTest(faces=faces):
                np.testing.assert_allclose(
                    PCA(n_components=3).fit_transform(pca_data(faces, faces)),
                    expected[str(faces)],
                    atol=1e-9,
                )

    def test_fewer_faces_than_components_are_refused(self):
        # As scikit-learn; cluster_faces pins the error it causes.
        with self.assertRaises(ValueError):
            PCA(n_components=3).fit_transform(pca_data(2, 2))

    def test_three_faces_vary_in_two_directions(self):
        coordinates = PCA(n_components=3).fit_transform(pca_data(3, 3))
        self.assertEqual(coordinates[:, 2].tolist(), [0.0, 0.0, 0.0])
        np.testing.assert_allclose(coordinates.sum(axis=0), 0.0, atol=1e-12)
