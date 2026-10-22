"""The faces dashboard's "Similar" group order (#622).

Groups whose cluster centroids are close sit next to each other: a greedy
nearest-neighbour chain from the group with the most faces. The list sends
each group's place as ``similarity_rank``.
"""

from typing import Any
from unittest.mock import patch

import numpy as np
from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIClient

from api.faces import similarity
from api.faces.similarity import (
    person_centroids,
    similarity_chain,
    similarity_ranks,
)
from api.models import Person
from api.tests.utils import (
    create_test_cluster,
    create_test_face,
    create_test_person,
    create_test_photo,
    create_test_user,
)


def direction(seed: int, near: int | None = None) -> np.ndarray:
    """A unit vector; with ``near``, one close to ``direction(near)``."""
    vector = np.random.RandomState(seed).randn(512)
    if near is not None:
        vector = direction(near) * 10 + vector / np.linalg.norm(vector)
    return vector / np.linalg.norm(vector)


def hex_of(vector: np.ndarray) -> str:
    return vector.astype(np.float64).tobytes().hex()


class SimilarityChainTest(SimpleTestCase):
    def test_three_pairs_end_up_next_to_each_other(self) -> None:
        # a, b, c and their look-alikes, shuffled.
        centroids = [
            direction(1),
            direction(2),
            direction(3),
            direction(11, near=3),
            direction(12, near=1),
            direction(13, near=2),
        ]
        order = similarity_chain(centroids, [9, 1, 1, 1, 1, 1])

        self.assertEqual(0, order[0])
        pairs = {frozenset(order[i : i + 2]) for i in range(0, 6, 2)}
        self.assertEqual(
            {frozenset({0, 4}), frozenset({1, 5}), frozenset({2, 3})}, pairs
        )

    def test_starts_at_the_group_with_the_most_faces(self) -> None:
        order = similarity_chain([direction(1), direction(2), direction(3)], [1, 7, 2])

        self.assertEqual(1, order[0])

    def test_ties_keep_the_given_order(self) -> None:
        same = direction(5)

        self.assertEqual([0, 1, 2], similarity_chain([same, same, same], [3, 3, 3]))

    def test_groups_without_a_centroid_follow_in_their_order(self) -> None:
        order = similarity_chain(
            [None, direction(1), None, direction(2)], [50, 1, 9, 2]
        )

        self.assertEqual([3, 1, 0, 2], order)

    def test_no_centroid_at_all_keeps_the_order(self) -> None:
        self.assertEqual([0, 1], similarity_chain([None, None], [1, 2]))

    def test_nothing_gives_nothing(self) -> None:
        self.assertEqual([], similarity_chain([], []))


class PersonCentroidsTest(TestCase):
    def setUp(self) -> None:
        self.user = create_test_user()

    def test_a_person_is_the_mean_of_their_clusters(self) -> None:
        anna = create_test_person(cluster_owner=self.user)
        create_test_cluster(
            self.user, person=anna, mean_face_encoding=hex_of(direction(1))
        )
        create_test_cluster(
            self.user, person=anna, mean_face_encoding=hex_of(direction(2))
        )

        centroid = person_centroids(self.user, [anna.pk])[anna.pk]

        expected = direction(1) + direction(2)
        np.testing.assert_allclose(expected / np.linalg.norm(expected), centroid)

    def test_clusters_without_or_with_an_odd_encoding_are_skipped(self) -> None:
        anna, ben, cleo = (
            create_test_person(cluster_owner=self.user) for _ in range(3)
        )
        create_test_cluster(self.user, person=anna, mean_face_encoding="")
        create_test_cluster(
            self.user, person=ben, mean_face_encoding=hex_of(direction(1))
        )
        create_test_cluster(
            self.user, person=cleo, mean_face_encoding=hex_of(direction(2))
        )
        old_model = np.random.RandomState(3).rand(128)
        create_test_cluster(
            self.user, person=cleo, mean_face_encoding=hex_of(old_model)
        )

        centroids = person_centroids(self.user, [anna.pk, ben.pk, cleo.pk])

        self.assertEqual({ben.pk, cleo.pk}, set(centroids))
        np.testing.assert_allclose(direction(2), centroids[cleo.pk])

    def test_another_users_clusters_are_not_read(self) -> None:
        anna = create_test_person(cluster_owner=self.user)
        other = create_test_user()
        create_test_cluster(other, person=anna, mean_face_encoding=hex_of(direction(1)))

        self.assertEqual({}, person_centroids(self.user, [anna.pk]))

    def test_ranks_follow_the_chain(self) -> None:
        anna, ben, cleo = (
            create_test_person(cluster_owner=self.user) for _ in range(3)
        )
        create_test_cluster(
            self.user, person=anna, mean_face_encoding=hex_of(direction(1))
        )
        create_test_cluster(
            self.user, person=ben, mean_face_encoding=hex_of(direction(2, near=1))
        )

        ranks = similarity_ranks(self.user, [(cleo.pk, 9), (anna.pk, 5), (ben.pk, 1)])

        self.assertEqual({anna.pk: 0, ben.pk: 1, cleo.pk: 2}, ranks)

    def test_too_many_groups_get_no_rank(self) -> None:
        with patch.object(similarity, "MAX_CHAINED_GROUPS", 1):
            self.assertEqual({}, similarity_ranks(self.user, [(1, 1), (2, 1)]))


class IncompleteListSimilarityRankTest(TestCase):
    def setUp(self) -> None:
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def group(self, name: str, encoding: np.ndarray | None, faces: int) -> Person:
        person = create_test_person(
            name=name, kind=Person.KIND_CLUSTER, cluster_owner=self.user
        )
        if encoding is not None:
            create_test_cluster(
                self.user, person=person, mean_face_encoding=hex_of(encoding)
            )
        for _ in range(faces):
            create_test_face(
                photo=create_test_photo(owner=self.user),
                cluster_person=person,
                cluster_probability=0.9,
            )
        return person

    def inferred(self) -> list[dict[str, Any]]:
        response = self.client.get(
            "/api/faces/incomplete/",
            {
                "inferred": "true",
                "analysis_method": "clustering",
                "min_confidence": 0.5,
            },
        )
        self.assertEqual(200, response.status_code, response.content)
        body: list[dict[str, Any]] = response.json()
        return body

    def test_each_group_says_where_it_goes(self) -> None:
        anna = self.group("Unknown 001", direction(1), 3)
        far = self.group("Unknown 002", direction(2), 1)
        anna_again = self.group("Unknown 003", direction(3, near=1), 1)
        loner = self.group("Unknown 004", None, 2)
        create_test_face(photo=create_test_photo(owner=self.user))

        ranks = {group["id"]: group["similarity_rank"] for group in self.inferred()}

        self.assertEqual(
            {anna.pk: 0, anna_again.pk: 1, far.pk: 2, loner.pk: 3, 0: None}, ranks
        )
