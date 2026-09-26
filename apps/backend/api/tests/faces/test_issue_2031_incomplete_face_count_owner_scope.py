"""Issue #2031 - the incomplete-faces count must be scoped like the face list.

``FaceListView`` returns only faces on the requester's own photos
(``photo__owner``). ``FaceIncompleteListViewSet`` produced the count that
drives the face dashboard grid without that filter, so a person shared with
another user was counted across both libraries. The grid then draws slots the
list can never fill, and the last page 404s with "Invalid page".

``cluster_owner`` scopes the *person*, not its faces, so it does not cover
this: both users below see the same person.
"""

from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from api.models import Person
from api.tests.utils import (
    create_test_face,
    create_test_person,
    create_test_photo,
    create_test_user,
)


class IncompleteFaceCountOwnerScopeTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user()
        self.stranger = create_test_user()
        self.client.force_authenticate(user=self.user)
        self.photo = create_test_photo(owner=self.user)
        self.stranger_photo = create_test_photo(owner=self.stranger)

    def _incomplete(self, **params):
        response = self.client.get(reverse("incomplete_faces-list"), params)
        self.assertEqual(response.status_code, 200)
        return response.data

    def _listed_faces(self, person_id, **params):
        # inferred=false is what selects the labelled-faces branch
        # (analysis_method=None -> Q(person=personid)); the view otherwise
        # defaults to clustering.
        query = {"person": person_id, "inferred": "false"}
        query.update(params)
        response = self.client.get(reverse("faces-list"), query)
        self.assertEqual(response.status_code, 200)
        body = response.data
        return body["results"] if isinstance(body, dict) and "results" in body else body

    def test_the_labelled_count_matches_what_the_list_returns(self):
        person = create_test_person(
            kind=Person.KIND_USER, cluster_owner=self.user, face_count=3
        )
        create_test_face(photo=self.photo, person=person)
        # Two more of the same person, on somebody else's photos.
        create_test_face(photo=self.stranger_photo, person=person)
        create_test_face(photo=self.stranger_photo, person=person)

        rows = [row for row in self._incomplete() if row["id"] == person.id]
        self.assertEqual(len(rows), 1, self._incomplete())
        self.assertEqual(rows[0]["face_count"], 1)
        self.assertEqual(len(self._listed_faces(person.id)), 1)

    def test_a_person_seen_only_in_another_library_is_not_listed(self):
        person = create_test_person(
            kind=Person.KIND_USER, cluster_owner=self.user, face_count=2
        )
        create_test_face(photo=self.stranger_photo, person=person)
        create_test_face(photo=self.stranger_photo, person=person)

        # Counted zero, so the `viewable_face_count__gt=0` filter drops it --
        # which is right: the list endpoint would return an empty page for it.
        self.assertEqual(
            [row for row in self._incomplete() if row["id"] == person.id], []
        )
        self.assertEqual(len(self._listed_faces(person.id)), 0)

    def test_the_clustering_count_is_scoped_too(self):
        person = create_test_person(kind=Person.KIND_CLUSTER, cluster_owner=self.user)
        create_test_face(
            photo=self.photo,
            person=None,
            cluster_person=person,
            cluster_probability=0.9,
        )
        create_test_face(
            photo=self.stranger_photo,
            person=None,
            cluster_person=person,
            cluster_probability=0.9,
        )

        rows = [
            row
            for row in self._incomplete(
                inferred="true", analysis_method="clustering", min_confidence="0.5"
            )
            if row["id"] == person.id
        ]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["face_count"], 1)

    def test_the_classification_count_is_scoped_too(self):
        person = create_test_person(kind=Person.KIND_CLUSTER, cluster_owner=self.user)
        create_test_face(
            photo=self.photo,
            person=None,
            classification_person=person,
            classification_probability=0.9,
        )
        create_test_face(
            photo=self.stranger_photo,
            person=None,
            classification_person=person,
            classification_probability=0.9,
        )

        rows = [
            row
            for row in self._incomplete(
                inferred="true", analysis_method="classification", min_confidence="0.5"
            )
            if row["id"] == person.id
        ]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["face_count"], 1)
