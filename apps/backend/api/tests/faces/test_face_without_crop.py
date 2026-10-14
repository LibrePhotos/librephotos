"""A face whose crop image is empty must not break the endpoints that list it.

``Face.image`` is nullable, and legacy rows (or a crop that failed to save)
have no file name. Reading ``face.image.url`` on such a field raises
``ValueError("The 'image' attribute has no file associated with it.")``, which
turned deleting the face, listing it, relabeling it and opening its photo into a
500. A face without a crop is still a face: it can be listed, relabeled and
deleted; its crop URL is just missing.
"""

from unittest.mock import patch

import numpy as np
from django.test import TestCase
from rest_framework.test import APIClient

from api.faces.classify import cluster_faces
from api.models.face import Face
from api.tests.utils import (
    create_test_face,
    create_test_person,
    create_test_photo,
    create_test_user,
)


def _encoding(seed: int) -> str:
    return np.random.RandomState(seed).rand(128).astype(np.float64).tobytes().hex()


class _FakePCA:
    def __init__(self, n_components: int | None = None) -> None:
        self.n_components = n_components

    def fit_transform(self, x: list[object]) -> np.ndarray:
        return np.array([[i * 1.0, i * 2.0, i * 3.0] for i in range(len(x))])


class FaceWithoutCropTest(TestCase):
    def setUp(self) -> None:
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.photo = create_test_photo(owner=self.user)
        self.person = create_test_person(name="Ann", cluster_owner=self.user)

    def _cropless_face(self, image: str | None = "") -> Face:
        return create_test_face(photo=self.photo, person=self.person, image=image)

    def _delete(self, *faces: Face) -> dict[str, object]:
        response = self.client.post(
            "/api/deletefaces/", {"face_ids": [f.id for f in faces]}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.content)
        body: dict[str, object] = response.json()
        return body

    def test_deleting_a_face_with_an_empty_crop_deletes_it(self) -> None:
        face = self._cropless_face("")

        body = self._delete(face)

        face.refresh_from_db()
        self.assertTrue(face.deleted)
        self.assertEqual(body["deleted_ids"], [face.id])
        self.assertEqual(body["deleted"], [])

    def test_deleting_a_face_with_a_null_crop_deletes_it(self) -> None:
        face = self._cropless_face(None)

        body = self._delete(face)

        face.refresh_from_db()
        self.assertTrue(face.deleted)
        self.assertEqual(body["deleted_ids"], [face.id])

    def test_a_cropless_face_does_not_stop_the_others_from_being_deleted(
        self,
    ) -> None:
        cropless = self._cropless_face("")
        cropped = create_test_face(
            photo=self.photo, person=self.person, image="faces/a.jpg"
        )

        body = self._delete(cropless, cropped)

        self.assertFalse(Face.objects.filter(deleted=False).exists())
        self.assertEqual(sorted(body["deleted_ids"]), sorted([cropless.id, cropped.id]))
        self.assertEqual(body["deleted"], [cropped.image.url])
        self.assertEqual(body["results"], body["deleted"])

    def test_the_face_list_shows_a_cropless_face_without_a_url(self) -> None:
        face = self._cropless_face("")

        response = self.client.get(
            "/api/faces/", {"person": self.person.id, "inferred": "false"}
        )

        self.assertEqual(response.status_code, 200, response.content)
        [row] = response.json()["results"]
        self.assertEqual(row["id"], face.id)
        self.assertIsNone(row["face_url"])

    def test_relabeling_a_cropless_face_answers_it_without_a_url(self) -> None:
        face = self._cropless_face("")

        with patch("api.views.faces.write_face_tags_of", return_value=None):
            response = self.client.post(
                "/api/labelfaces/",
                {"face_ids": [face.id], "person_name": "Bea"},
                format="json",
            )

        self.assertEqual(response.status_code, 200, response.content)
        [row] = response.json()["updated"]
        self.assertEqual(row["id"], face.id)
        self.assertIsNone(row["face_url"])

    def test_the_photo_lists_a_cropless_face_with_an_empty_url(self) -> None:
        face = self._cropless_face("")

        response = self.client.get(f"/api/photos/{self.photo.image_hash}/")

        self.assertEqual(response.status_code, 200, response.content)
        [entry] = response.json()["people"]
        self.assertEqual(entry["face_id"], face.id)
        self.assertEqual(entry["face_url"], "")

    def test_the_cluster_chart_leaves_out_a_cropless_face(self) -> None:
        create_test_face(
            photo=self.photo, person=self.person, image="", encoding=_encoding(1)
        )
        create_test_face(
            photo=self.photo,
            person=self.person,
            image="faces/b.jpg",
            encoding=_encoding(2),
        )

        with patch("api.faces.classify.make_pca", _FakePCA):
            result = cluster_faces(self.user)

        self.assertEqual(
            [point["face_url"] for point in result["data"]], ["/media/faces/b.jpg"]
        )
