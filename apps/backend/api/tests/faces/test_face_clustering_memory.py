import tracemalloc
from collections.abc import Callable
from unittest.mock import patch

import numpy as np
from django.db import connection
from django.test import SimpleTestCase, TestCase
from django.test.utils import CaptureQueriesContext

from api.faces import classify, hdbscan
from api.faces.hdbscan import core_distances, hdbscan_labels
from api.models.cluster import unit_length
from api.tests.utils import create_test_face, create_test_photo, create_test_user

FACES = 2000
DIMENSIONS = 512


def library(seed: int = 5) -> np.ndarray:
    rng = np.random.RandomState(seed)
    people = rng.normal(size=(60, DIMENSIONS))
    faces = people[rng.randint(0, 60, FACES)] + 0.05 * rng.normal(
        size=(FACES, DIMENSIONS)
    )
    faces /= np.linalg.norm(faces, axis=1, keepdims=True)
    faces[FACES // 2 :: 7] = faces[: len(faces[FACES // 2 :: 7])]
    return faces


def brute_force_core_distances(points: np.ndarray, min_samples: int) -> np.ndarray:
    result = np.empty(len(points))
    for index, point in enumerate(points):
        squared = np.cumsum((points - point) ** 2, axis=1)[:, -1]
        result[index] = np.sqrt(np.sort(squared)[min_samples])
    return result


def peak_bytes(work: Callable[[], object]) -> int:
    tracemalloc.start()
    try:
        tracemalloc.reset_peak()
        before = tracemalloc.get_traced_memory()[0]
        work()
        return tracemalloc.get_traced_memory()[1] - before
    finally:
        tracemalloc.stop()


class SmallBlocks:
    def __enter__(self) -> None:
        self.patches = [
            patch.object(hdbscan, "_BLOCK_ENTRIES", 1 << 16),
            patch.object(hdbscan, "_EXACT_BLOCK", 256),
        ]
        for started in self.patches:
            started.start()

    def __exit__(self, *exc: object) -> None:
        for started in self.patches:
            started.stop()


class ClusteringMemoryTest(SimpleTestCase):
    def test_core_distances_allocate_less_than_half_a_copy_of_the_faces(self):
        points = library()

        with SmallBlocks():
            peak = peak_bytes(lambda: core_distances(points, 2))

        self.assertLess(peak, points.nbytes // 2)

    def test_clustering_allocates_less_than_half_a_copy_of_the_faces(self):
        points = library()

        with SmallBlocks():
            peak = peak_bytes(lambda: hdbscan_labels(points, 4, 2, 0.0))

        self.assertLess(peak, points.nbytes // 2)

    def test_copies_of_a_face_get_the_core_distance_of_the_face(self):
        points = library()[:400]
        points[399] = points[10]
        points[397, 0] = 0.0
        points[396] = points[397]
        points[396, 0] = -0.0

        for min_samples in (1, 2, 5):
            with self.subTest(min_samples=min_samples):
                self.assertEqual(
                    brute_force_core_distances(points, min_samples).tolist(),
                    core_distances(points, min_samples).tolist(),
                )


class EncodingCollectionTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        photo = create_test_photo(owner=self.user)
        rng = np.random.RandomState(9)
        self.vectors = rng.normal(size=(7, 128))
        self.faces = [
            create_test_face(photo=photo, encoding=vector.tobytes().hex())
            for vector in self.vectors
        ]
        create_test_face(photo=photo, encoding=rng.normal(size=64).tobytes().hex())

    def test_the_encodings_are_one_matrix_read_in_pages(self):
        with (
            patch.object(classify, "ENCODING_PAGE", 3),
            CaptureQueriesContext(connection) as queries,
            self.assertLogs("api.faces.classify", "WARNING"),
        ):
            data = classify.collect_face_encodings(self.user)

        matrix = data["encoding"]
        self.assertIsInstance(matrix, np.ndarray)
        self.assertEqual((7, 128), matrix.shape)
        self.assertEqual(np.float64, matrix.dtype)
        self.assertTrue(matrix.flags.c_contiguous)
        self.assertEqual([face.id for face in self.faces], data["id"])
        expected = [unit_length(vector).tolist() for vector in self.vectors]
        self.assertEqual(expected, matrix.tolist())
        pages = [query for query in queries if "LIMIT 3" in query["sql"]]
        self.assertEqual(3, len(pages))
