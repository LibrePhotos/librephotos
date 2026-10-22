""" "Not this person" is remembered (#2747).

Sending a face back to unknown ("Not Anna") stores Anna in the face's
``rejected_persons``, and training never suggests her for that face again.
The undo of that labelling, and labelling the face as Anna by hand, take the
rejection back. A merge of Anna into another person moves the rejection along.
"""

import uuid
from typing import Any
from unittest.mock import patch

import numpy as np
from django.test import TestCase
from rest_framework.test import APIClient

from api.faces import classify
from api.faces.classify import train_faces
from api.faces.merge import merge_people
from api.models import Face, Person
from api.tests.utils import (
    create_test_cluster,
    create_test_face,
    create_test_person,
    create_test_photo,
    create_test_user,
)


def enc_hex(seed: int) -> str:
    return np.random.RandomState(seed).rand(128).astype(np.float64).tobytes().hex()


class FixedMLP:
    """An ``MLPClassifier`` stand-in sure of its first class, then its second."""

    def __init__(self, **kwargs: Any) -> None:
        self.classes_ = np.array([])

    def fit(self, encodings: np.ndarray, y: np.ndarray) -> "FixedMLP":
        self.classes_ = np.unique(np.asarray(y))
        return self

    def predict_proba(self, encodings: np.ndarray) -> np.ndarray:
        n = len(self.classes_)
        rows = np.zeros((len(encodings), n))
        rows[:, 0] = 0.7
        if n > 1:
            rows[:, 1] = 0.3
        return rows


def rejected_ids(face: Face) -> set[int]:
    return set(face.rejected_persons.values_list("id", flat=True))


class NotThisPersonApiTest(TestCase):
    def setUp(self) -> None:
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.anna = create_test_person(name="Anna", cluster_owner=self.user)
        self.bob = create_test_person(name="Bob", cluster_owner=self.user)
        self.face = create_test_face(
            photo=create_test_photo(owner=self.user),
            cluster_person=self.anna,
            classification_person=self.bob,
        )

    def label(self, name: str) -> dict[str, Any]:
        response = self.client.post(
            "/api/labelfaces",
            {"face_ids": [self.face.pk], "person_name": name},
            format="json",
        )
        self.assertEqual(200, response.status_code, response.content)
        body: dict[str, Any] = response.json()
        return body

    def test_not_this_person_remembers_the_suggested_people(self) -> None:
        body = self.label(Person.UNKNOWN_PERSON_NAME)

        self.assertEqual({self.anna.pk, self.bob.pk}, rejected_ids(self.face))
        self.assertEqual(
            [
                {"id": self.anna.pk, "name": "Anna"},
                {"id": self.bob.pk, "name": "Bob"},
            ],
            body["rejected_people"],
        )

    def test_a_labelled_face_sent_away_remembers_its_person(self) -> None:
        Face.objects.filter(pk=self.face.pk).update(
            person=self.anna, cluster_person=None, classification_person=None
        )

        self.label(Person.UNKNOWN_PERSON_NAME)

        self.assertEqual({self.anna.pk}, rejected_ids(self.face))

    def test_unknown_other_and_clusters_are_not_named(self) -> None:
        other = create_test_person(
            name=Person.UNKNOWN_PERSON_NAME,
            kind=Person.KIND_UNKNOWN,
            cluster_owner=self.user,
        )
        cluster = create_test_person(
            name="Unknown 001", kind=Person.KIND_CLUSTER, cluster_owner=self.user
        )
        Face.objects.filter(pk=self.face.pk).update(
            cluster_person=cluster, classification_person=other
        )

        body = self.label(Person.UNKNOWN_PERSON_NAME)

        # The cluster is rejected too, so training does not put the face back
        # in it; "Unknown - Other" is where the face goes, so never.
        self.assertEqual({cluster.pk}, rejected_ids(self.face))
        self.assertEqual([], body["rejected_people"])

    def test_someone_elses_person_is_not_recorded(self) -> None:
        stranger = create_test_person(name="Stranger", cluster_owner=create_test_user())
        Face.objects.filter(pk=self.face.pk).update(
            cluster_person=stranger, classification_person=None
        )

        self.label(Person.UNKNOWN_PERSON_NAME)

        self.assertEqual(set(), rejected_ids(self.face))

    def test_the_undo_takes_the_rejection_back(self) -> None:
        body = self.label(Person.UNKNOWN_PERSON_NAME)

        response = self.client.post(
            "/api/restore-face-labels/", {"faces": body["previous"]}, format="json"
        )

        self.assertEqual(200, response.status_code, response.content)
        self.face.refresh_from_db()
        self.assertEqual(self.anna.pk, self.face.cluster_person_id)
        self.assertEqual(set(), rejected_ids(self.face))

    def test_labelling_the_face_by_hand_clears_that_rejection(self) -> None:
        self.label(Person.UNKNOWN_PERSON_NAME)

        body = self.label("Anna")

        self.assertEqual([], body["rejected_people"])
        self.face.refresh_from_db()
        self.assertEqual(self.anna.pk, self.face.person_id)
        # Bob stays rejected: only the person given is taken back.
        self.assertEqual({self.bob.pk}, rejected_ids(self.face))

    def test_deleting_the_person_drops_the_rejection(self) -> None:
        self.label(Person.UNKNOWN_PERSON_NAME)

        self.anna.delete()

        self.assertEqual({self.bob.pk}, rejected_ids(self.face))


class MergeKeepsRejectionsTest(TestCase):
    def setUp(self) -> None:
        self.user = create_test_user()
        self.anna = create_test_person(name="Anna", cluster_owner=self.user)
        self.anna_b = create_test_person(name="Anna B", cluster_owner=self.user)
        self.photo = create_test_photo(owner=self.user)

    def test_merging_moves_the_rejection_to_the_target(self) -> None:
        face = create_test_face(photo=self.photo)
        face.rejected_persons.add(self.anna)

        merge_people(self.user, self.anna, self.anna_b)

        self.assertEqual({self.anna_b.pk}, rejected_ids(face))

    def test_a_face_labelled_as_the_target_gets_no_rejection(self) -> None:
        face = create_test_face(photo=self.photo, person=self.anna_b)
        face.rejected_persons.add(self.anna)

        merge_people(self.user, self.anna, self.anna_b)

        self.assertEqual(set(), rejected_ids(face))

    def test_the_target_rejection_of_a_moved_face_is_cleared(self) -> None:
        # Labelled Anna after "Not Anna B": the merge labels it Anna B.
        face = create_test_face(photo=self.photo, person=self.anna)
        face.rejected_persons.add(self.anna_b)

        merge_people(self.user, self.anna, self.anna_b)

        face.refresh_from_db()
        self.assertEqual(self.anna_b.pk, face.person_id)
        self.assertEqual(set(), rejected_ids(face))

    def test_another_users_rejections_are_left_alone(self) -> None:
        stranger = create_test_user()
        their_face = create_test_face(photo=create_test_photo(owner=stranger))
        their_face.rejected_persons.add(self.anna)

        merge_people(self.user, self.anna, self.anna_b)

        self.assertEqual(set(), rejected_ids(their_face))


class TrainingSkipsRejectedPeopleTest(TestCase):
    def setUp(self) -> None:
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)
        self.anna = create_test_person(name="Anna", cluster_owner=self.user)
        self.bob = create_test_person(name="Bob", cluster_owner=self.user)
        create_test_face(photo=self.photo, person=self.anna, encoding=enc_hex(1))
        create_test_face(photo=self.photo, person=self.bob, encoding=enc_hex(2))
        self.face = create_test_face(
            photo=self.photo,
            encoding=enc_hex(3),
            cluster=create_test_cluster(owner=self.user),
        )

    def train(self) -> None:
        with patch.object(classify, "make_mlp_classifier", FixedMLP):
            self.assertTrue(train_faces(self.user, str(uuid.uuid4())))
        self.face.refresh_from_db()

    def test_training_suggests_the_top_person_without_a_rejection(self) -> None:
        self.train()

        self.assertEqual(self.anna.pk, self.face.classification_person_id)

    def test_a_rejected_person_is_not_suggested_again(self) -> None:
        self.face.rejected_persons.add(self.anna)

        self.train()

        self.assertEqual(self.bob.pk, self.face.classification_person_id)
        self.assertAlmostEqual(0.3, self.face.classification_probability)
        self.assertEqual(self.bob.pk, self.face.cluster_person_id)

    def test_no_one_left_leaves_the_face_without_a_suggestion(self) -> None:
        # An old suggestion of Anna is cleared, not kept.
        Face.objects.filter(pk=self.face.pk).update(classification_person=self.anna)
        self.face.rejected_persons.add(self.anna, self.bob)

        self.train()

        self.assertIsNone(self.face.classification_person_id)
        self.assertEqual(0.0, self.face.classification_probability)
        self.assertIsNone(self.face.cluster_person_id)
        self.assertEqual(0.0, self.face.cluster_probability)
