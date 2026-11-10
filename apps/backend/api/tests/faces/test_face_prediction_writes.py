"""How ``classify_face_page`` writes its predictions back.

It holds up to ``FACE_WRITE_BATCH`` faces and writes them with Django's
``bulk_update``: a few UPDATE statements for a page, never one per face, and
only the four prediction columns, so a label or cluster changed while training
ran is kept.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import TYPE_CHECKING, cast
from unittest.mock import patch

import numpy as np
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext

from api.faces import classify
from api.faces.classify import FACE_WRITE_BATCH, _Classifiers, classify_face_page
from api.models import Face, LongRunningJob, Person
from api.models.cluster import get_unknown_cluster
from api.tests.utils import (
    create_test_face,
    create_test_job,
    create_test_person,
    create_test_photo,
    create_test_user,
)

if TYPE_CHECKING:
    from api.faces.mlp import MLPClassifier
    from api.models.user import User


class StubClassifier:
    """What training reads of a fitted MLPClassifier: its classes and probabilities."""

    def __init__(self, classes: list[int], probabilities: list[float]) -> None:
        self.classes_ = classes
        self.probabilities = probabilities

    def predict_proba(self, encodings: list[list[float]]) -> list[list[float]]:
        return [self.probabilities for _ in encodings]


def stub_classifier(classes: list[int], probabilities: list[float]) -> MLPClassifier:
    # Duck-typed: classify_face_page only reads classes_ and predict_proba.
    return cast("MLPClassifier", StubClassifier(classes, probabilities))


class FacePredictionWritesTest(TestCase):
    def setUp(self) -> None:
        self.user: User = create_test_user()
        self.mia = create_test_person(name="Mia", cluster_owner=self.user)
        self.anna = create_test_person(name="Anna", cluster_owner=self.user)
        self.photo = create_test_photo(owner=self.user)
        self.classifiers = _Classifiers(
            person=stub_classifier([self.mia.pk, self.anna.pk], [0.2, 0.8]),
            cluster=stub_classifier([self.mia.pk, self.anna.pk], [0.3, 0.7]),
            unknown_cluster=get_unknown_cluster(user=self.user),
        )
        self.job = create_test_job(self.user, LongRunningJob.JOB_TRAIN_FACES)

    def faces(self, count: int) -> list[int]:
        return [
            create_test_face(
                photo=self.photo,
                classification_probability=0.1,
                cluster_probability=0.1,
            ).pk
            for _ in range(count)
        ]

    def classify(self, face_ids: list[int]) -> None:
        classify_face_page(
            self.classifiers,
            [np.zeros(1) for _ in face_ids],
            face_ids,
            self.job,
            len(face_ids),
        )

    def assert_predicted_anna(self, face_ids: list[int]) -> None:
        for face in Face.objects.filter(pk__in=face_ids):
            self.assertEqual(face.classification_person, self.anna)
            self.assertAlmostEqual(face.classification_probability, 0.8)
            self.assertEqual(face.cluster_person, self.anna)
            self.assertAlmostEqual(face.cluster_probability, 0.7)

    def test_a_page_larger_than_a_batch_is_written_in_a_few_updates(self) -> None:
        face_ids = self.faces(2 * FACE_WRITE_BATCH + 5)

        with CaptureQueriesContext(connection) as queries:
            self.classify(face_ids)

        updates = [
            query["sql"]
            for query in queries.captured_queries
            if query["sql"].startswith('UPDATE "api_face"')
        ]
        # Three held batches; SQLite may split one further at its parameter cap.
        self.assertGreaterEqual(len(updates), 3)
        self.assertLess(len(updates), 20)
        self.assert_predicted_anna(face_ids)

    def test_only_the_prediction_columns_are_written(self) -> None:
        face_ids = self.faces(3)
        labelled_meanwhile = face_ids[1]
        original = classify.assign_face_predictions

        def label_then_predict(
            face: Face,
            cluster_probabilities: Sequence[float],
            classification_probabilities: Sequence[float],
            classifiers: _Classifiers,
            persons: Mapping[int, Person],
        ) -> None:
            # The user labels the face after training loaded it.
            if face.pk == labelled_meanwhile:
                Face.objects.filter(pk=face.pk).update(person=self.mia)
            original(
                face,
                cluster_probabilities,
                classification_probabilities,
                classifiers,
                persons,
            )

        with patch.object(classify, "assign_face_predictions", label_then_predict):
            self.classify(face_ids)

        people = dict(Face.objects.filter(pk__in=face_ids).values_list("id", "person"))
        self.assertEqual(
            people,
            {face_ids[0]: None, labelled_meanwhile: self.mia.pk, face_ids[2]: None},
        )
        self.assert_predicted_anna(face_ids)
