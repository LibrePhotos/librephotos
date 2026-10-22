"""A person's birth date (#2750).

``PATCH /api/persons/<id>/`` sets or clears it next to the rename and the
cover; the person endpoints answer it to the owner. It is personal data, so it
is in no photo's people and no shared or public payload.
"""

import datetime

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from api.serializers.photos import (
    PublicPhotoDetailSerializer,
    PublicPhotoPersonSerializer,
)
from api.serializers.public_share import SharedPhotoPersonSerializer
from api.tests.utils import (
    create_test_face,
    create_test_person,
    create_test_photo,
    create_test_user,
)


def person_url(person) -> str:
    return f"/api/persons/{person.pk}/"


class PersonBirthDateTestCase(TestCase):
    def setUp(self) -> None:
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.photo = create_test_photo(owner=self.user)
        self.mia = create_test_person(name="Mia", cluster_owner=self.user)
        create_test_face(photo=self.photo, person=self.mia)

    def patch(self, person, body):
        return self.client.patch(person_url(person), body, format="json")


class SetAndClearTest(PersonBirthDateTestCase):
    def test_a_patch_stores_the_birth_date(self):
        response = self.patch(self.mia, {"birth_date": "2019-05-03"})

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["birth_date"], "2019-05-03")
        self.mia.refresh_from_db()
        self.assertEqual(self.mia.birth_date, datetime.date(2019, 5, 3))

    def test_null_clears_it(self):
        self.mia.birth_date = datetime.date(2019, 5, 3)
        self.mia.save()

        response = self.patch(self.mia, {"birth_date": None})

        self.assertEqual(response.status_code, 200, response.content)
        self.mia.refresh_from_db()
        self.assertIsNone(self.mia.birth_date)

    def test_a_date_in_the_future_is_refused(self):
        next_week = timezone.now().date() + datetime.timedelta(days=7)

        response = self.patch(self.mia, {"birth_date": next_week.isoformat()})

        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            [error["code"] for error in response.json()["errors"]], ["future_date"]
        )
        self.mia.refresh_from_db()
        self.assertIsNone(self.mia.birth_date)

    def test_today_is_a_birth_date(self):
        today = timezone.now().date().isoformat()

        response = self.patch(self.mia, {"birth_date": today})

        self.assertEqual(response.status_code, 200, response.content)

    def test_a_malformed_date_is_refused(self):
        response = self.patch(self.mia, {"birth_date": "3 May 2019"})

        self.assertEqual(response.status_code, 400)

    def test_another_users_person_is_not_found(self):
        stranger = create_test_person(name="Zoe", cluster_owner=create_test_user())

        response = self.patch(stranger, {"birth_date": "2019-05-03"})

        self.assertEqual(response.status_code, 404)
        stranger.refresh_from_db()
        self.assertIsNone(stranger.birth_date)


class EditsNextToItTest(PersonBirthDateTestCase):
    def test_a_rename_keeps_the_birth_date(self):
        self.mia.birth_date = datetime.date(2019, 5, 3)
        self.mia.save()

        response = self.patch(self.mia, {"newPersonName": "Mia B."})

        self.assertEqual(response.status_code, 200, response.content)
        self.mia.refresh_from_db()
        self.assertEqual(self.mia.name, "Mia B.")
        self.assertEqual(self.mia.birth_date, datetime.date(2019, 5, 3))

    def test_a_cover_change_still_works(self):
        response = self.patch(self.mia, {"cover_photo": str(self.photo.pk)})

        self.assertEqual(response.status_code, 200, response.content)
        self.mia.refresh_from_db()
        self.assertEqual(self.mia.cover_photo, self.photo)
        self.assertIsNone(self.mia.birth_date)

    def test_a_rename_and_a_birth_date_in_one_request(self):
        response = self.patch(
            self.mia, {"newPersonName": "Mia B.", "birth_date": "2019-05-03"}
        )

        self.assertEqual(response.status_code, 200, response.content)
        self.mia.refresh_from_db()
        self.assertEqual(
            (self.mia.name, self.mia.birth_date), ("Mia B.", datetime.date(2019, 5, 3))
        )

    def test_an_empty_patch_changes_nothing(self):
        before = self.mia.last_modified

        response = self.patch(self.mia, {})

        self.assertEqual(response.status_code, 200, response.content)
        self.mia.refresh_from_db()
        self.assertEqual(self.mia.last_modified, before)


class ReadTest(PersonBirthDateTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.mia.birth_date = datetime.date(2019, 5, 3)
        self.mia.save()

    def test_the_person_and_the_people_list_answer_it(self):
        detail = self.client.get(person_url(self.mia)).json()
        [row] = self.client.get("/api/persons/").json()["results"]

        self.assertEqual(detail["birth_date"], "2019-05-03")
        self.assertEqual(row["birth_date"], "2019-05-03")

    def test_a_person_without_one_answers_null(self):
        ben = create_test_person(name="Ben", cluster_owner=self.user)

        self.assertIsNone(self.client.get(person_url(ben)).json()["birth_date"])

    def test_the_photo_detail_people_leave_it_out(self):
        people = self.client.get(f"/api/photos/{self.photo.image_hash}/").json()[
            "people"
        ]

        self.assertEqual([entry["name"] for entry in people], ["Mia"])
        for entry in people:
            self.assertNotIn("birth_date", entry)

    def test_a_public_photo_with_shared_faces_leaves_it_out(self):
        serializer = PublicPhotoDetailSerializer(
            self.photo, context={"sharing_settings": {"share_faces": True}}
        )

        [entry] = serializer.get_people(self.photo)

        self.assertNotIn("birth_date", entry)

    def test_no_shared_or_public_person_shape_has_it(self):
        for serializer in (PublicPhotoPersonSerializer, SharedPhotoPersonSerializer):
            with self.subTest(serializer=serializer.__name__):
                self.assertNotIn("birth_date", serializer().fields)
