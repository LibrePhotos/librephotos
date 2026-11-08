"""``GET /api/faces/review-count/``: the faces waiting for review.

The People page's "Review faces" link shows this number and opens the face
dashboard's Suggested tab, so the number must be what that tab lists.
"""

from django.test import TestCase
from rest_framework.test import APIClient

from api.tests.utils import (
    create_test_face,
    create_test_person,
    create_test_person_group,
    create_test_photo,
    create_test_user,
)

URL = "/api/faces/review-count/"


class FacesReviewCountTest(TestCase):
    def setUp(self) -> None:
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.anna = create_test_person(name="Anna", cluster_owner=self.user)
        self.ben = create_test_person(name="Ben", cluster_owner=self.user)

    def face(self, owner=None, in_trashcan=False, **kwargs):
        photo = create_test_photo(owner=owner or self.user, in_trashcan=in_trashcan)
        return create_test_face(photo=photo, **kwargs)

    def suggest(self, suggested_for, probability=0.9, **kwargs):
        return self.face(
            cluster_person=suggested_for, cluster_probability=probability, **kwargs
        )

    def count(self, **params):
        response = self.client.get(URL, params)
        self.assertEqual(200, response.status_code, response.content)
        return response.json()["suggested"]

    def test_counts_faces_suggested_for_your_people(self):
        self.suggest(self.anna)
        self.suggest(self.anna)
        self.suggest(self.ben)
        self.assertEqual(3, self.count())

    def test_leaves_out_what_the_suggested_tab_does_not_list(self):
        self.suggest(self.anna)
        self.suggest(self.anna, probability=0.5)  # below the default 0.7
        self.suggest(self.anna, deleted=True)
        self.suggest(self.anna, person=self.anna)  # already labelled
        self.suggest(self.anna, in_trashcan=True)
        self.face(cluster_person=None)  # Unknown - Other: a backlog of strangers
        self.assertEqual(1, self.count())

    def test_counts_only_your_own_faces_and_people(self):
        other = create_test_user()
        theirs = create_test_person(name="Cleo", cluster_owner=other)
        self.suggest(self.anna)
        self.suggest(theirs, owner=other)
        self.suggest(self.anna, owner=other)
        self.assertEqual(1, self.count())

    def test_takes_the_dashboards_filters(self):
        self.suggest(self.anna, probability=0.5)
        self.face(classification_person=self.ben, classification_probability=0.95)
        self.assertEqual(1, self.count(min_confidence=0.4))
        self.assertEqual(1, self.count(analysis_method="classification"))

    def test_narrows_to_a_group(self):
        group = create_test_person_group(self.user, persons=[self.anna])
        self.suggest(self.anna)
        self.suggest(self.ben)
        self.assertEqual(1, self.count(group=group.pk))

    def test_matches_the_suggested_tab(self):
        self.suggest(self.anna)
        self.suggest(self.anna, probability=0.75)
        self.suggest(self.ben, probability=0.65)
        self.suggest(self.ben, deleted=True)
        self.face(cluster_person=None)
        response = self.client.get(
            "/api/faces/incomplete/",
            {"inferred": "true", "min_confidence": 0.7},
        )
        listed = sum(
            person["face_count"] for person in response.json() if person["id"] != 0
        )
        self.assertEqual(listed, self.count())

    def test_needs_a_signed_in_user(self):
        self.assertEqual(401, APIClient().get(URL).status_code)
