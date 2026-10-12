"""The face views read their input through serializers (#2326).

``?min_confidence=x`` on the face lists and a body without ``face_ids`` used
to be a 500 (``float()``, ``data["face_ids"]``); each is a 400 naming the
field now.
"""

from django.test import TestCase
from rest_framework.test import APIClient

from api.tests.utils import (
    create_test_face,
    create_test_person,
    create_test_photo,
    create_test_user,
)


def error_fields(response) -> list[str]:
    return [error["field"] for error in response.json()["errors"]]


class FaceRequestTestCase(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.person = create_test_person(name="Ada", cluster_owner=self.user)
        self.photo = create_test_photo(owner=self.user)
        self.labeled = create_test_face(photo=self.photo, person=self.person)
        self.unknown = create_test_face(photo=self.photo)


class FaceListQueryTest(FaceRequestTestCase):
    def test_malformed_numbers_are_a_400(self):
        for url, field in (
            ("/api/faces/?min_confidence=x", "min_confidence"),
            ("/api/faces/?person=abc", "person"),
            ("/api/faces/incomplete/?min_confidence=x", "min_confidence"),
            ("/api/faces/incomplete/?inferred=true&min_confidence=x", "min_confidence"),
        ):
            with self.subTest(url=url):
                response = self.client.get(url)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(error_fields(response), [field])

    def test_confirmed_faces_of_a_person(self):
        response = self.client.get(
            f"/api/faces/?person={self.person.id}&inferred=false"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            [face["id"] for face in response.json()["results"]], [self.labeled.id]
        )

    def test_person_zero_lists_the_unassigned_faces(self):
        response = self.client.get("/api/faces/?person=0")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            [face["id"] for face in response.json()["results"]], [self.unknown.id]
        )
        response = self.client.get("/api/faces/")
        self.assertEqual(
            [face["id"] for face in response.json()["results"]], [self.unknown.id]
        )

    def test_incomplete_list_counts_the_unknown_faces(self):
        response = self.client.get("/api/faces/incomplete/")
        self.assertEqual(response.status_code, 200)
        by_name = {row["name"]: row for row in response.json()}
        self.assertEqual(by_name["Ada"]["face_count"], 1)
        self.assertEqual(by_name["Unknown - Other"]["face_count"], 1)


class FaceBodyTest(FaceRequestTestCase):
    def test_label_and_delete_need_face_ids(self):
        for url, body, field in (
            ("/api/labelfaces", {"person_name": "Bob"}, "face_ids"),
            ("/api/labelfaces", {"person_name": "Bob", "face_ids": "1"}, "face_ids"),
            ("/api/labelfaces", {"face_ids": [self.unknown.id]}, "person_name"),
            (
                "/api/labelfaces",
                {"face_ids": [self.unknown.id], "person_name": "  "},
                "person_name",
            ),
            ("/api/deletefaces", {}, "face_ids"),
            ("/api/deletefaces", {"face_ids": ["x"]}, "face_ids"),
        ):
            with self.subTest(url=url, body=body):
                response = self.client.post(url, body, format="json")
                self.assertEqual(response.status_code, 400)
                self.assertEqual(error_fields(response), [field])

    def test_labeling_trims_the_name(self):
        response = self.client.post(
            "/api/labelfaces",
            {"face_ids": [self.unknown.id], "person_name": "  Ada "},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.unknown.refresh_from_db()
        self.assertEqual(self.unknown.person, self.person)

    def test_add_face_names_its_missing_fields(self):
        response = self.client.post("/api/addface", {}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(sorted(error_fields(response)), ["person_name", "photo"])
