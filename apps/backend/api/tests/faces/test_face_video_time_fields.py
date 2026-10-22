"""The second of a video a face is at reaches the clients (#2762).

The face lists, a photo's people and a person's photos carry it, so the
web app opens a video where the face is.
"""

from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from api.tests.utils import (
    create_test_album_date,
    create_test_face,
    create_test_person,
    create_test_photo,
    create_test_user,
)


class FaceVideoTimeFieldsTest(TestCase):
    def setUp(self) -> None:
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.anna = create_test_person(name="Anna", cluster_owner=self.user)
        self.video = create_test_photo(owner=self.user, video=True)
        self.photo = create_test_photo(owner=self.user)
        self.frame_face = create_test_face(
            photo=self.video, person=self.anna, video_time=42.5
        )
        self.photo_face = create_test_face(photo=self.photo, person=self.anna)

    def video_times(self, rows: list[dict[str, object]]) -> dict[object, object]:
        return {row["id"]: row["video_time"] for row in rows}

    def test_the_face_list_carries_it(self) -> None:
        response = self.client.get(
            reverse("faces-list"),
            {"person": self.anna.id, "analysis_method": "", "inferred": "false"},
        )

        self.assertEqual(200, response.status_code)
        self.assertEqual(
            {self.frame_face.id: 42.5, self.photo_face.id: None},
            self.video_times(response.json()["results"]),
        )

    def test_labelling_answers_it(self) -> None:
        response = self.client.post(
            "/api/labelfaces",
            {"face_ids": [self.frame_face.id], "person_name": "Anna"},
            format="json",
        )

        self.assertEqual(200, response.status_code)
        self.assertEqual(
            {self.frame_face.id: 42.5}, self.video_times(response.json()["results"])
        )

    def test_a_photos_people_carry_it(self) -> None:
        people = self.client.get(f"/api/photos/{self.video.image_hash}/").json()[
            "people"
        ]

        self.assertEqual([42.5], [person["video_time"] for person in people])

    def test_a_persons_photos_say_when_the_person_is_in_a_video(self) -> None:
        create_test_face(photo=self.video, person=self.anna, video_time=80.0)
        create_test_face(
            photo=self.video, person=self.anna, video_time=3.0, deleted=True
        )
        other = create_test_person(name="Ben", cluster_owner=self.user)
        create_test_face(photo=self.video, person=other, video_time=1.0)
        album = create_test_album_date(date=timezone.now().date(), owner=self.user)
        album.photos.add(self.video, self.photo)

        def times(query: dict[str, object]) -> dict[str, object]:
            response = self.client.get(f"/api/albums/date/{album.id}/", query)
            self.assertEqual(200, response.status_code)
            return {
                item["id"]: item["person_video_time"]
                for item in response.json()["results"]["items"]
            }

        self.assertEqual(
            {str(self.video.id): 42.5, str(self.photo.id): None},
            times({"person": self.anna.id}),
        )
        self.assertEqual({None}, set(times({}).values()))
