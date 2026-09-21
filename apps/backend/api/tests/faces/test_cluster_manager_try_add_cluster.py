"""Characterization tests for api.cluster_manager.ClusterManager.try_add_cluster.

These tests pin the CURRENT behavior of try_add_cluster before refactoring.
They intentionally assert observed behavior, including two quirks that look
like bugs (see the comments on
``test_known_faces_branch_does_not_set_cluster_person`` and
``test_known_faces_branch_ignores_unknown_faces``).
"""

import numpy as np
from django.test import TestCase

from api.cluster_manager import ClusterManager
from api.models.cluster import UNKNOWN_CLUSTER_ID, UNKNOWN_CLUSTER_NAME, Cluster
from api.models.face import Face
from api.models.person import Person
from api.tests.utils import create_test_face, create_test_person, create_test_user


def _encoding_hex(seed):
    rng = np.random.RandomState(seed)
    return rng.rand(128).tobytes().hex()


class TryAddClusterTestCase(TestCase):
    def setUp(self):
        self.user = create_test_user()

    def _face(self, seed, person=None):
        return create_test_face(person=person, encoding=_encoding_hex(seed))

    # ------------------------------------------------------------------
    # Unknown cluster branch (cluster_id == UNKNOWN_CLUSTER_ID)
    # ------------------------------------------------------------------
    def test_unknown_cluster_id_assigns_unknown_cluster_and_returns_empty(self):
        unknown_face = self._face(1)
        person = create_test_person(cluster_owner=self.user)
        known_face = self._face(2, person=person)
        known_face.cluster_person = person
        known_face.save()

        result = ClusterManager.try_add_cluster(
            self.user, UNKNOWN_CLUSTER_ID, [unknown_face, known_face]
        )

        self.assertEqual(result, [])

        unknown_cluster = Cluster.objects.get(
            owner=self.user, cluster_id=UNKNOWN_CLUSTER_ID
        )
        self.assertIsNone(unknown_cluster.person)
        # get_unknown_cluster only renames the row when it already had a person,
        # so a freshly created unknown cluster keeps name=None.
        self.assertIsNone(unknown_cluster.name)
        self.assertNotEqual(unknown_cluster.name, UNKNOWN_CLUSTER_NAME)

        unknown_face.refresh_from_db()
        known_face.refresh_from_db()
        self.assertEqual(unknown_face.cluster_id, unknown_cluster.id)
        self.assertEqual(known_face.cluster_id, unknown_cluster.id)
        # Unknown faces get their cluster_person cleared...
        self.assertIsNone(unknown_face.cluster_person)
        # ...but known faces keep theirs.
        self.assertEqual(known_face.cluster_person_id, person.id)
        # person assignment itself is never touched
        self.assertIsNone(unknown_face.person)
        self.assertEqual(known_face.person_id, person.id)

    def test_existing_unknown_cluster_with_person_is_reset_and_renamed(self):
        person = create_test_person(cluster_owner=self.user)
        stale = Cluster.objects.create(
            owner=self.user,
            cluster_id=UNKNOWN_CLUSTER_ID,
            person=person,
            mean_face_encoding="",
        )

        ClusterManager.try_add_cluster(self.user, UNKNOWN_CLUSTER_ID, [self._face(5)])

        stale.refresh_from_db()
        self.assertIsNone(stale.person)
        self.assertEqual(stale.name, UNKNOWN_CLUSTER_NAME)

    def test_unknown_cluster_id_with_no_faces(self):
        result = ClusterManager.try_add_cluster(self.user, UNKNOWN_CLUSTER_ID, [])
        self.assertEqual(result, [])
        self.assertTrue(
            Cluster.objects.filter(
                owner=self.user, cluster_id=UNKNOWN_CLUSTER_ID
            ).exists()
        )

    # ------------------------------------------------------------------
    # No-known-faces branch
    # ------------------------------------------------------------------
    def test_all_unknown_faces_creates_cluster_and_cluster_person(self):
        faces = [self._face(10), self._face(11)]

        result = ClusterManager.try_add_cluster(self.user, 7, faces)

        self.assertEqual(len(result), 1)
        cluster = result[0]
        self.assertEqual(cluster.cluster_id, 7)
        self.assertEqual(cluster.name, "Cluster 7")
        self.assertEqual(cluster.owner_id, self.user.id)

        person = cluster.person
        self.assertEqual(person.name, "Unknown 7")
        self.assertEqual(person.kind, Person.KIND_CLUSTER)
        self.assertEqual(person.cluster_owner_id, self.user.id)

        for face in faces:
            face.refresh_from_db()
            self.assertEqual(face.cluster_id, cluster.id)
            self.assertEqual(face.cluster_person_id, person.id)
            # face.person is left untouched (still None)
            self.assertIsNone(face.person)

        # mean encoding is the mean of the unknown faces' encodings
        expected = np.mean(
            [f.get_encoding_array() for f in faces], axis=0, dtype=np.float64
        )
        cluster.refresh_from_db()
        np.testing.assert_allclose(cluster.get_mean_encoding_array(), expected)

    def test_pad_len_zero_fills_the_person_name(self):
        result = ClusterManager.try_add_cluster(
            self.user, 5, [self._face(20)], padLen=4
        )
        self.assertEqual(result[0].person.name, "Unknown 0005")
        # cluster name is NOT padded
        self.assertEqual(result[0].name, "Cluster 5")

    def test_empty_face_list_still_creates_cluster_with_nan_encoding(self):
        result = ClusterManager.try_add_cluster(self.user, 3, [])

        self.assertEqual(len(result), 1)
        cluster = result[0]
        cluster.refresh_from_db()
        self.assertEqual(cluster.cluster_id, 3)
        self.assertIsNotNone(cluster.person)
        # np.mean of an empty list -> a single nan value, stored as 8 bytes
        mean = cluster.get_mean_encoding_array()
        self.assertEqual(mean.shape, (1,))
        self.assertTrue(np.isnan(mean[0]))

    def test_repeated_call_reuses_person_and_cluster(self):
        first = ClusterManager.try_add_cluster(self.user, 9, [self._face(30)])
        second = ClusterManager.try_add_cluster(self.user, 9, [self._face(31)])

        self.assertEqual(first[0].id, second[0].id)
        self.assertEqual(first[0].person.id, second[0].person.id)
        self.assertEqual(
            Cluster.objects.filter(owner=self.user, cluster_id=9).count(), 1
        )
        self.assertEqual(
            Person.objects.filter(name="Unknown 9", cluster_owner=self.user).count(), 1
        )

    def test_unknown_cluster_row_is_created_even_for_normal_cluster_ids(self):
        ClusterManager.try_add_cluster(self.user, 2, [self._face(40)])
        self.assertTrue(
            Cluster.objects.filter(
                owner=self.user, cluster_id=UNKNOWN_CLUSTER_ID
            ).exists()
        )

    # ------------------------------------------------------------------
    # Known-faces branch
    # ------------------------------------------------------------------
    def test_known_faces_split_into_one_cluster_per_person(self):
        alice = create_test_person(name="Alice", cluster_owner=self.user)
        bob = create_test_person(name="Bob", cluster_owner=self.user)
        f1 = self._face(50, person=alice)
        f2 = self._face(51, person=alice)
        f3 = self._face(52, person=bob)

        result = ClusterManager.try_add_cluster(self.user, 4, [f1, f2, f3])

        self.assertEqual(len(result), 2)
        names = sorted(c.name for c in result)
        self.assertEqual(names, ["Cluster 4-1", "Cluster 4-2"])
        self.assertEqual([c.cluster_id for c in result], [4, 4])
        self.assertEqual(
            sorted(c.person_id for c in result), sorted([alice.id, bob.id])
        )

        by_person = {c.person_id: c for c in result}
        for face, person in ((f1, alice), (f2, alice), (f3, bob)):
            face.refresh_from_db()
            self.assertEqual(face.cluster_id, by_person[person.id].id)

        # mean encoding for Alice's cluster is the mean over her two faces
        alice_cluster = Cluster.objects.get(id=by_person[alice.id].id)
        expected = np.mean(
            [f1.get_encoding_array(), f2.get_encoding_array()],
            axis=0,
            dtype=np.float64,
        )
        np.testing.assert_allclose(alice_cluster.get_mean_encoding_array(), expected)

    def test_known_faces_branch_does_not_set_cluster_person(self):
        """QUIRK: face_ids_by_cluster is cleared before the second bulk update,
        so the update that would set ``cluster_person`` matches zero rows and
        known faces keep whatever cluster_person they had."""
        alice = create_test_person(name="Alice", cluster_owner=self.user)
        face = self._face(60, person=alice)

        ClusterManager.try_add_cluster(self.user, 8, [face])

        face.refresh_from_db()
        self.assertIsNotNone(face.cluster_id)
        self.assertIsNone(face.cluster_person)

    def test_known_faces_branch_ignores_unknown_faces(self):
        """QUIRK: when at least one known face is present, faces without a
        person are collected but never assigned to any cluster."""
        alice = create_test_person(name="Alice", cluster_owner=self.user)
        known = self._face(70, person=alice)
        unknown = self._face(71)

        result = ClusterManager.try_add_cluster(self.user, 6, [known, unknown])

        self.assertEqual(len(result), 1)
        known.refresh_from_db()
        unknown.refresh_from_db()
        self.assertEqual(known.cluster_id, result[0].id)
        self.assertIsNone(unknown.cluster_id)
        self.assertIsNone(unknown.cluster_person)

        # the mean encoding only reflects the known face
        result[0].refresh_from_db()
        np.testing.assert_allclose(
            result[0].get_mean_encoding_array(), known.get_encoding_array()
        )

    def test_known_faces_reuse_existing_cluster_row_by_name(self):
        alice = create_test_person(name="Alice", cluster_owner=self.user)
        existing = Cluster.objects.create(
            owner=self.user, name="Cluster 11-1", mean_face_encoding=""
        )

        result = ClusterManager.try_add_cluster(
            self.user, 11, [self._face(80, person=alice)]
        )

        self.assertEqual(result[0].id, existing.id)
        existing.refresh_from_db()
        self.assertEqual(existing.cluster_id, 11)
        self.assertEqual(existing.person_id, alice.id)

    def test_known_faces_cluster_index_follows_first_seen_person_order(self):
        alice = create_test_person(name="Alice", cluster_owner=self.user)
        bob = create_test_person(name="Bob", cluster_owner=self.user)
        faces = [
            self._face(90, person=bob),
            self._face(91, person=alice),
            self._face(92, person=bob),
        ]

        result = ClusterManager.try_add_cluster(self.user, 12, faces)

        self.assertEqual([c.name for c in result], ["Cluster 12-1", "Cluster 12-2"])
        self.assertEqual([c.person_id for c in result], [bob.id, alice.id])

    def test_returned_clusters_are_persisted(self):
        alice = create_test_person(name="Alice", cluster_owner=self.user)
        result = ClusterManager.try_add_cluster(
            self.user, 13, [self._face(100, person=alice)]
        )
        for cluster in result:
            self.assertIsNotNone(cluster.id)
            self.assertTrue(Cluster.objects.filter(id=cluster.id).exists())
        self.assertEqual(Face.objects.filter(cluster=result[0]).count(), 1)
