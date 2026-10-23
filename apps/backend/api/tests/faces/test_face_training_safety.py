"""``train_faces`` with nothing to learn, and while other work changes faces (#2733).

Training runs after every clustering and, later, after uploads. It must:

- finish cleanly for a user with faces but no labelled people and no clusters
  (there is no class to fit a classifier on);
- write only its predictions, so a label the user sets while it runs is kept,
  as is the cluster a concurrent recluster moved the face into;
- leave a prediction empty when the predicted person was deleted meanwhile
  (a recluster deletes the cluster people), instead of failing the job.
"""

import uuid
from typing import Any
from unittest.mock import patch

import numpy as np
from django.test import TestCase

from api.faces import classify
from api.faces.classify import train_faces
from api.models import Face, LongRunningJob, Person
from api.tests.utils import (
    create_test_cluster,
    create_test_face,
    create_test_person,
    create_test_photo,
    create_test_user,
)


def enc_hex(seed: int) -> str:
    return np.random.RandomState(seed).rand(128).astype(np.float64).tobytes().hex()


class FirstClassMLP:
    """An ``MLPClassifier`` stand-in that is sure of its first class."""

    def __init__(self, **kwargs: Any) -> None:
        self.classes_ = np.array([])

    def fit(self, encodings: np.ndarray, y: np.ndarray) -> FirstClassMLP:
        self.classes_ = np.unique(np.asarray(y))
        return self

    def predict_proba(self, encodings: np.ndarray) -> np.ndarray:
        rows = np.full((len(encodings), len(self.classes_)), 0.1 / len(self.classes_))
        rows[:, 0] = 0.9
        return rows


class RowClassMLP(FirstClassMLP):
    """Sure of class ``i % classes`` for row ``i``, so rows are told apart."""

    def predict_proba(self, encodings: np.ndarray) -> np.ndarray:
        n = len(self.classes_)
        rows = np.full((len(encodings), n), 0.1 / n)
        for i in range(len(encodings)):
            rows[i, i % n] = 0.9
        return rows


class TrainFacesSafetyTest(TestCase):
    def setUp(self) -> None:
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)
        self.job_id = str(uuid.uuid4())

    def face(self, seed: int, **kwargs: Any) -> Face:
        return create_test_face(photo=self.photo, encoding=enc_hex(seed), **kwargs)

    def job(self) -> LongRunningJob:
        return LongRunningJob.objects.get(job_id=self.job_id)

    def train(self) -> bool:
        with patch.object(classify, "make_mlp_classifier", FirstClassMLP):
            return train_faces(self.user, self.job_id)

    def test_faces_without_labels_or_clusters_finish_with_nothing_to_train(
        self,
    ) -> None:
        self.face(1)
        self.face(2)

        # The real classifier: fitting it on no rows raised and failed the job.
        self.assertTrue(train_faces(self.user, self.job_id))

        job = self.job()
        self.assertTrue(job.finished)
        self.assertFalse(job.failed)
        self.assertEqual(job.result, {"status": "completed", "nothing_to_train": True})

    def test_a_user_without_faces_finishes_too(self) -> None:
        self.assertTrue(train_faces(self.user, self.job_id))
        self.assertFalse(self.job().failed)

    def labelled_alice(self) -> Person:
        alice = create_test_person(name="Alice", cluster_owner=self.user)
        self.face(1, person=alice)
        return alice

    def test_a_label_set_while_training_runs_is_kept(self) -> None:
        alice = self.labelled_alice()
        bob = create_test_person(name="Bob", cluster_owner=self.user)
        unknown = self.face(2)
        new_cluster = create_test_cluster(owner=self.user, cluster_id=7)
        original = classify.assign_face_predictions

        def label_meanwhile(face: Face, *args: Any, **kwargs: Any) -> None:
            # The user labels the face, and a recluster moves it, after
            # training loaded its page of faces but before it writes them.
            Face.objects.filter(pk=face.pk).update(person=bob, cluster=new_cluster)
            original(face, *args, **kwargs)

        with patch.object(classify, "assign_face_predictions", label_meanwhile):
            self.assertTrue(self.train())

        unknown.refresh_from_db()
        self.assertEqual(unknown.person_id, bob.id)
        self.assertEqual(unknown.cluster_id, new_cluster.id)
        # Training still wrote its own prediction.
        self.assertEqual(unknown.classification_person_id, alice.id)

    def test_a_predicted_person_deleted_meanwhile_leaves_the_prediction_empty(
        self,
    ) -> None:
        alice = self.labelled_alice()
        unknown = self.face(2, cluster=create_test_cluster(owner=self.user))
        original = classify.classify_face_page

        def delete_alice_first(*args: Any, **kwargs: Any) -> None:
            Person.objects.filter(pk=alice.pk).delete()
            original(*args, **kwargs)

        with patch.object(classify, "classify_face_page", delete_alice_first):
            self.assertTrue(self.train())

        unknown.refresh_from_db()
        self.assertIsNone(unknown.classification_person_id)
        self.assertEqual(unknown.classification_probability, 0.0)
        self.assertIsNone(unknown.cluster_person_id)
        self.assertEqual(unknown.cluster_probability, 0.0)
        self.assertFalse(self.job().failed)

    def test_a_face_deleted_meanwhile_does_not_shift_the_predictions(self) -> None:
        alice = self.labelled_alice()
        bob = create_test_person(name="Bob", cluster_owner=self.user)
        self.face(2, person=bob)
        gone = self.face(3)
        kept = self.face(4)
        original = classify.classify_face_page

        def delete_face_first(*args: Any, **kwargs: Any) -> None:
            Face.objects.filter(pk=gone.pk).delete()
            original(*args, **kwargs)

        with (
            patch.object(classify, "make_mlp_classifier", RowClassMLP),
            patch.object(classify, "classify_face_page", delete_face_first),
        ):
            self.assertTrue(train_faces(self.user, self.job_id))

        # Row 0 (the gone face) predicts the first class, row 1 the second.
        first, second = sorted([alice.id, bob.id])
        kept.refresh_from_db()
        self.assertEqual(kept.classification_person_id, second)
        self.assertNotEqual(kept.classification_person_id, first)
