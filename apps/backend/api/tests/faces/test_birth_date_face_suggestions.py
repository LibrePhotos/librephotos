"""Face suggestions skip the people born after the photo was taken (#2752).

``assign_face_predictions`` picks the likeliest person for an unlabelled face
from each classifier. A person with a birth date after the photo's date (with
a day of slack) is left out of that pick; people without a birth date, cluster
people and undated photos behave as before.
"""

from __future__ import annotations

import datetime
from typing import TYPE_CHECKING, cast

import numpy as np
from django.test import TestCase

from api.faces.birth_dates import (
    birth_dates_of,
    photo_dates_of_faces,
    unborn_people,
    without_unborn,
)
from api.faces.classify import (
    _Classifiers,
    assign_face_predictions,
    classify_face_page,
    likeliest_class,
)
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

TAKEN = datetime.datetime(2018, 2, 12, 10, 0, tzinfo=datetime.UTC)


class StubClassifier:
    """What training reads of a fitted MLPClassifier: its classes and probabilities."""

    def __init__(
        self, classes: list[int], probabilities: list[float] | None = None
    ) -> None:
        self.classes_ = classes
        self.probabilities = probabilities or []

    def predict_proba(self, encodings: list[list[float]]) -> list[list[float]]:
        return [self.probabilities for _ in encodings]


def stub_classifier(
    classes: list[int], probabilities: list[float] | None = None
) -> MLPClassifier:
    # A stub, not a fitted classifier: it has the two members training reads.
    return cast("MLPClassifier", StubClassifier(classes, probabilities))


class UnbornPeopleTest(TestCase):
    def test_a_person_born_after_the_photo_is_unborn(self) -> None:
        dates = {1: datetime.date(2019, 5, 3), 2: datetime.date(1990, 1, 1)}

        self.assertEqual(unborn_people(dates, TAKEN), frozenset({1}))

    def test_a_day_of_slack_keeps_the_day_after_in(self) -> None:
        dates = {1: datetime.date(2018, 2, 13), 2: datetime.date(2018, 2, 14)}

        self.assertEqual(unborn_people(dates, TAKEN), frozenset({2}))

    def test_an_undated_photo_leaves_everybody_in(self) -> None:
        self.assertEqual(
            unborn_people({1: datetime.date(2019, 5, 3)}, None), frozenset()
        )

    def test_without_unborn_zeroes_only_their_classes(self) -> None:
        self.assertEqual(
            without_unborn([1, 2, 3], [0.5, 0.3, 0.2], {1, 3}), [0.0, 0.3, 0.0]
        )


class LikeliestClassTest(TestCase):
    def test_the_most_probable_class(self) -> None:
        self.assertEqual(likeliest_class([1, 2], [0.7, 0.3]), (1, 0.7))

    def test_the_next_likeliest_person_wins_over_an_unborn_one(self) -> None:
        masked = without_unborn([1, 2, 3], [0.7, 0.2, 0.1], {1})

        self.assertEqual(likeliest_class([1, 2, 3], masked), (2, 0.2))

    def test_nobody_left_is_no_suggestion(self) -> None:
        self.assertEqual(likeliest_class([1, 2], [0.0, 0.0]), (None, 0.0))


class AssignFacePredictionsTest(TestCase):
    def setUp(self) -> None:
        self.user = create_test_user()
        self.mia = create_test_person(
            name="Mia", cluster_owner=self.user, birth_date=datetime.date(2019, 5, 3)
        )
        self.anna = create_test_person(name="Anna", cluster_owner=self.user)
        self.cluster_person = create_test_person(
            name="Unknown 1", cluster_owner=self.user, kind=Person.KIND_CLUSTER
        )
        self.face = create_test_face(
            photo=create_test_photo(owner=self.user, exif_timestamp=TAKEN)
        )

    def classifiers(
        self, birth_dates: dict[int, datetime.date] | None = None
    ) -> _Classifiers:
        people = [self.mia.pk, self.anna.pk]
        return _Classifiers(
            person=stub_classifier(people),
            cluster=stub_classifier([*people, self.cluster_person.pk]),
            unknown_cluster=get_unknown_cluster(user=self.user),
            birth_dates=(
                birth_dates_of(self.user) if birth_dates is None else birth_dates
            ),
        )

    def assign(
        self,
        cluster: list[float],
        classification: list[float],
        taken: datetime.datetime | None,
        birth_dates: dict[int, datetime.date] | None = None,
    ) -> None:
        # As classify_face_page does for each face
        classifiers = self.classifiers(birth_dates)
        unborn = unborn_people(classifiers.birth_dates, taken)
        assign_face_predictions(
            self.face,
            *classifiers.born_only(unborn, cluster, classification),
            classifiers,
            classifiers.predicted_persons(),
        )

    def test_an_unborn_person_is_not_suggested_the_next_one_is(self) -> None:
        self.assign([0.6, 0.3, 0.1], [0.8, 0.2], TAKEN)

        self.assertEqual(self.face.classification_person, self.anna)
        self.assertAlmostEqual(self.face.classification_probability, 0.2)
        self.assertEqual(self.face.cluster_person, self.anna)
        self.assertAlmostEqual(self.face.cluster_probability, 0.3)

    def test_a_photo_after_the_birth_date_keeps_the_person(self) -> None:
        later = datetime.datetime(2024, 6, 1, tzinfo=datetime.UTC)

        self.assign([0.6, 0.3, 0.1], [0.8, 0.2], later)

        self.assertEqual(self.face.classification_person, self.mia)
        self.assertEqual(self.face.cluster_person, self.mia)

    def test_an_undated_photo_is_not_filtered(self) -> None:
        self.assign([0.6, 0.3, 0.1], [0.8, 0.2], None)

        self.assertEqual(self.face.classification_person, self.mia)
        self.assertEqual(self.face.cluster_person, self.mia)

    def test_people_without_a_birth_date_behave_as_before(self) -> None:
        self.assign([0.6, 0.3, 0.1], [0.8, 0.2], TAKEN, {})

        self.assertEqual(self.face.classification_person, self.mia)
        self.assertEqual(self.face.cluster_person, self.mia)

    def test_cluster_people_are_never_filtered(self) -> None:
        self.assign([0.6, 0.1, 0.3], [0.8, 0.2], TAKEN)

        self.assertEqual(self.face.cluster_person, self.cluster_person)

    def test_everybody_unborn_is_no_suggestion(self) -> None:
        both_unborn = {
            self.mia.pk: datetime.date(2019, 5, 3),
            self.anna.pk: datetime.date(2020, 1, 1),
        }
        self.face.classification_person = self.mia
        self.face.cluster_person = self.mia

        self.assign([0.6, 0.4, 0.0], [0.8, 0.2], TAKEN, both_unborn)

        self.assertIsNone(self.face.classification_person)
        self.assertEqual(self.face.classification_probability, 0.0)
        self.assertIsNone(self.face.cluster_person)
        self.assertEqual(self.face.cluster_probability, 0.0)


class BornOnlyTest(TestCase):
    def test_without_a_person_classifier_only_the_cluster_row_is_masked(self) -> None:
        classifiers = _Classifiers(
            person=None,
            cluster=stub_classifier([1, 2]),
            unknown_cluster=get_unknown_cluster(user=create_test_user()),
        )

        self.assertEqual(
            classifiers.born_only({1}, [0.6, 0.4], [0.0, 0.0]),
            ([0.0, 0.4], [0.0, 0.0]),
        )


class BirthDatesOfTest(TestCase):
    def test_only_the_users_people_with_a_birth_date(self) -> None:
        user = create_test_user()
        mia = create_test_person(
            cluster_owner=user, birth_date=datetime.date(2019, 5, 3)
        )
        create_test_person(cluster_owner=user)
        create_test_person(
            cluster_owner=create_test_user(), birth_date=datetime.date(2001, 1, 1)
        )

        self.assertEqual(birth_dates_of(user), {mia.pk: datetime.date(2019, 5, 3)})

    def test_photo_dates_leave_undated_photos_out(self) -> None:
        user = create_test_user()
        dated = create_test_face(
            photo=create_test_photo(owner=user, exif_timestamp=TAKEN)
        )
        undated = create_test_face(
            photo=create_test_photo(owner=user, exif_timestamp=None)
        )

        self.assertEqual(
            photo_dates_of_faces([dated.pk, undated.pk]), {dated.pk: TAKEN}
        )


class ClassifyFacePageTest(TestCase):
    """The page loop hands each face its photo's date."""

    def test_the_face_on_an_old_photo_gets_the_born_person(self) -> None:
        user = create_test_user()
        mia = create_test_person(
            name="Mia", cluster_owner=user, birth_date=datetime.date(2019, 5, 3)
        )
        anna = create_test_person(name="Anna", cluster_owner=user)
        face = create_test_face(
            photo=create_test_photo(owner=user, exif_timestamp=TAKEN)
        )
        classifiers = _Classifiers(
            person=stub_classifier([mia.pk, anna.pk], [0.8, 0.2]),
            cluster=stub_classifier([mia.pk, anna.pk], [0.7, 0.3]),
            unknown_cluster=get_unknown_cluster(user=user),
            birth_dates=birth_dates_of(user),
        )
        job = create_test_job(user, LongRunningJob.JOB_TRAIN_FACES)

        classify_face_page(classifiers, [np.zeros(1)], [face.pk], job, 1)

        face = Face.objects.get(pk=face.pk)
        self.assertEqual(face.classification_person, anna)
        self.assertEqual(face.cluster_person, anna)
