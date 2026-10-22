"""The faces dashboard leaves out faces of photos the photo lists leave out (#2753).

A trashed, removed or hidden photo is gone from every photo list, and the
People page already ignores its faces. The faces dashboard listed them in
every tab and counted them in its groups. Each tab below gets one face on a
shown photo and one on a trashed photo: only the first is listed, and the
group's count is the list's length, so the last page never asks for a page
that is not there (#2031). Restoring the photo brings its face back.
"""

from typing import Any

from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from api.models import Face, Photo
from api.models.photo import restore_photos, trash_photos
from api.tests.utils import (
    create_test_face,
    create_test_person,
    create_test_photo,
    create_test_user,
)

UNKNOWN_OTHER = 0


class FacesOfPhotosOffTheListsTest(TestCase):
    def setUp(self) -> None:
        self.client = APIClient()
        self.user = create_test_user()
        self.client.force_authenticate(user=self.user)
        self.alice = create_test_person(name="Alice", cluster_owner=self.user)
        self.shown_photo = create_test_photo(owner=self.user)
        self.trashed_photo = create_test_photo(owner=self.user)
        trash_photos(Photo.objects.filter(pk=self.trashed_photo.pk))

    def listed(self, **params: Any) -> list[int]:
        response = self.client.get(reverse("faces-list"), params)
        self.assertEqual(response.status_code, 200)
        return [row["id"] for row in response.data["results"]]

    def counted(self, person_id: int, **params: Any) -> int:
        response = self.client.get(reverse("incomplete_faces-list"), params)
        self.assertEqual(response.status_code, 200)
        rows = [row for row in response.data if row["id"] == person_id]
        return rows[0]["face_count"] if rows else 0

    def assert_only_the_shown_face(
        self,
        face_fields: dict[str, Any],
        list_params: dict[str, Any],
        count_params: dict[str, Any],
        person_id: int,
    ) -> Face:
        shown = create_test_face(photo=self.shown_photo, **face_fields)
        trashed = create_test_face(photo=self.trashed_photo, **face_fields)

        self.assertEqual(self.listed(**list_params), [shown.id])
        self.assertEqual(self.counted(person_id, **count_params), 1)
        return trashed

    def test_labelled_tab(self) -> None:
        self.assert_only_the_shown_face(
            {"person": self.alice},
            {"person": self.alice.id, "inferred": "false"},
            {},
            self.alice.id,
        )

    def test_clustering_tab(self) -> None:
        self.assert_only_the_shown_face(
            {"cluster_person": self.alice, "cluster_probability": 0.9},
            {"person": self.alice.id, "analysis_method": "clustering"},
            {"inferred": "true", "analysis_method": "clustering"},
            self.alice.id,
        )

    def test_classification_tab(self) -> None:
        self.assert_only_the_shown_face(
            {"classification_person": self.alice, "classification_probability": 0.9},
            {"person": self.alice.id, "analysis_method": "classification"},
            {"inferred": "true", "analysis_method": "classification"},
            self.alice.id,
        )

    def test_deleted_tab(self) -> None:
        self.assert_only_the_shown_face(
            {"person": self.alice, "deleted": True},
            {"person": self.alice.id, "deleted": "true"},
            {"deleted": "true"},
            self.alice.id,
        )

    def test_unknown_other(self) -> None:
        self.assert_only_the_shown_face(
            {"cluster_person": None},
            {"inferred": "false"},
            {},
            UNKNOWN_OTHER,
        )

    def test_unknown_other_of_the_clustering_tab(self) -> None:
        self.assert_only_the_shown_face(
            {"cluster_person": None},
            {"analysis_method": "clustering"},
            {"inferred": "true", "analysis_method": "clustering"},
            UNKNOWN_OTHER,
        )

    def test_a_group_with_only_trashed_faces_is_not_listed(self) -> None:
        create_test_face(photo=self.trashed_photo, person=self.alice)

        self.assertEqual(self.counted(self.alice.id), 0)
        self.assertEqual(self.listed(person=self.alice.id, inferred="false"), [])

    def test_restoring_the_photo_brings_its_face_back(self) -> None:
        trashed = self.assert_only_the_shown_face(
            {"person": self.alice},
            {"person": self.alice.id, "inferred": "false"},
            {},
            self.alice.id,
        )

        restore_photos(Photo.objects.filter(pk=self.trashed_photo.pk))

        self.assertIn(trashed.id, self.listed(person=self.alice.id, inferred="false"))
        self.assertEqual(self.counted(self.alice.id), 2)

    def test_faces_of_a_removed_photo_are_not_listed(self) -> None:
        Photo.objects.filter(pk=self.trashed_photo.pk).update(
            in_trashcan=False, trashed_at=None, removed=True
        )

        self.assert_only_the_shown_face(
            {"person": self.alice},
            {"person": self.alice.id, "inferred": "false"},
            {},
            self.alice.id,
        )
