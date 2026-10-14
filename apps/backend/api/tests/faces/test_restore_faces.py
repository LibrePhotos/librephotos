"""Undoing face edits (#127): restoring deleted faces and labels.

A deleted face keeps its person, so ``POST /api/restore-faces/`` can give it
back to them; the faces dashboard lists deleted faces with ``deleted=true``.
``POST /api/labelfaces`` answers each face's people from before the request
(``previous``), and ``POST /api/restore-face-labels/`` puts them back,
suggestions included, so an undone confirm sends the face back to Inferred.
"""

from unittest.mock import MagicMock, patch

from django.test import TestCase
from rest_framework.test import APIClient

from api.models import Face, User
from api.models.person import Person
from api.models.photo_search import PhotoSearch
from api.tests.utils import (
    create_test_face,
    create_test_person,
    create_test_photo,
    create_test_user,
)


def _captions(face: Face) -> str:
    assert face.photo is not None
    return PhotoSearch.objects.get(photo=face.photo).search_captions or ""


class FaceRestoreTestCase(TestCase):
    def setUp(self) -> None:
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.anna = create_test_person(name="Zebulon Anna", cluster_owner=self.user)
        self.photo = create_test_photo(owner=self.user)
        self.other_photo = create_test_photo(owner=self.user)

    def _post(self, url: str, data: object) -> dict[str, object]:
        response = self.client.post(url, data, format="json")
        self.assertEqual(200, response.status_code, response.content)
        body: dict[str, object] = response.json()
        return body


class RestoreFacesTest(FaceRestoreTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.kept = create_test_face(photo=self.photo, person=self.anna)
        self.face = create_test_face(photo=self.other_photo, person=self.anna)
        self._post("/api/deletefaces/", {"face_ids": [self.kept.pk, self.face.pk]})
        self.anna.refresh_from_db()
        self.assertEqual((0, None), (self.anna.face_count, self.anna.cover_face_id))

    def test_a_restored_face_is_back_with_its_person(self) -> None:
        body = self._post("/api/restore-faces/", {"face_ids": [self.face.pk]})

        self.assertEqual({"restored_ids": [self.face.pk], "write_error": None}, body)
        self.face.refresh_from_db()
        self.anna.refresh_from_db()
        self.assertFalse(self.face.deleted)
        self.assertEqual(self.anna.pk, self.face.person_id)
        self.assertEqual(1, self.anna.face_count)
        self.assertEqual(self.face.pk, self.anna.cover_face_id)
        self.assertIn("Zebulon Anna", _captions(self.face))

    def test_a_face_that_is_not_deleted_is_skipped(self) -> None:
        live = create_test_face(photo=self.photo, person=self.anna)

        body = self._post("/api/restore-faces/", {"face_ids": [live.pk]})

        self.assertEqual([], body["restored_ids"])

    def test_someone_elses_deleted_face_is_skipped(self) -> None:
        stranger = create_test_user()
        their_face = create_test_face(
            photo=create_test_photo(owner=stranger), deleted=True
        )

        body = self._post("/api/restore-faces/", {"face_ids": [their_face.pk]})

        self.assertEqual([], body["restored_ids"])
        their_face.refresh_from_db()
        self.assertTrue(their_face.deleted)

    def test_a_face_of_no_one_is_restored_to_no_one(self) -> None:
        nobody = create_test_face(photo=self.photo, deleted=True)

        body = self._post("/api/restore-faces/", {"face_ids": [nobody.pk]})

        self.assertEqual([nobody.pk], body["restored_ids"])
        nobody.refresh_from_db()
        self.assertEqual((False, None), (nobody.deleted, nobody.person_id))

    def test_face_ids_are_required(self) -> None:
        response = self.client.post("/api/restore-faces/", {}, format="json")

        self.assertEqual(400, response.status_code)


class DeletedFaceListTest(FaceRestoreTestCase):
    """The Deleted tab's lists: people with deleted faces, and their faces."""

    def setUp(self) -> None:
        super().setUp()
        create_test_face(photo=self.photo, person=self.anna)
        self.deleted = create_test_face(
            photo=self.other_photo, person=self.anna, deleted=True
        )
        self.nobody = create_test_face(photo=self.photo, deleted=True)
        create_test_face(photo=self.photo)

    def test_the_people_list_counts_deleted_faces(self) -> None:
        response = self.client.get("/api/faces/incomplete/", {"deleted": "true"})

        self.assertEqual(200, response.status_code)
        counts = {row["name"]: row["face_count"] for row in response.json()}
        self.assertEqual({"Zebulon Anna": 1, Person.UNKNOWN_PERSON_NAME: 1}, counts)

    def test_a_persons_deleted_faces_are_listed(self) -> None:
        response = self.client.get(
            "/api/faces/", {"deleted": "true", "person": self.anna.pk}
        )

        self.assertEqual(200, response.status_code)
        ids = [row["id"] for row in response.json()["results"]]
        self.assertEqual([self.deleted.pk], ids)

    def test_the_deleted_faces_of_no_one_are_listed(self) -> None:
        response = self.client.get(
            "/api/faces/",
            {"deleted": "true", "inferred": "true", "analysis_method": "clustering"},
        )

        ids = [row["id"] for row in response.json()["results"]]
        self.assertEqual([self.nobody.pk], ids)

    def test_the_other_lists_still_leave_deleted_faces_out(self) -> None:
        response = self.client.get(
            "/api/faces/", {"person": self.anna.pk, "inferred": "false"}
        )

        ids = [row["id"] for row in response.json()["results"]]
        self.assertNotIn(self.deleted.pk, ids)
        self.assertEqual(1, len(ids))


class RestoreFaceLabelsTest(FaceRestoreTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.cluster = create_test_person(
            name="Unknown 001", cluster_owner=self.user, kind=Person.KIND_CLUSTER
        )
        self.face = create_test_face(
            photo=self.photo, cluster_person=self.cluster, classification_person=None
        )

    def _label(self, name: str) -> list[dict[str, object]]:
        body = self._post(
            "/api/labelfaces", {"face_ids": [self.face.pk], "person_name": name}
        )
        previous = body["previous"]
        assert isinstance(previous, list)
        return previous

    def test_labelling_answers_the_faces_people_before(self) -> None:
        previous = self._label("Zebulon Anna")

        self.assertEqual(
            [
                {
                    "id": self.face.pk,
                    "person": None,
                    "cluster_person": self.cluster.pk,
                    "classification_person": None,
                }
            ],
            previous,
        )

    def test_undoing_a_confirm_sends_the_face_back_to_its_suggestion(self) -> None:
        previous = self._label("Zebulon Anna")
        self.anna.refresh_from_db()
        self.assertEqual(self.face.pk, self.anna.cover_face_id)

        body = self._post("/api/restore-face-labels/", {"faces": previous})

        self.assertEqual([self.face.pk], body["restored_ids"])
        self.face.refresh_from_db()
        self.anna.refresh_from_db()
        self.assertEqual(
            (None, self.cluster.pk), (self.face.person_id, self.face.cluster_person_id)
        )
        self.assertEqual((0, None), (self.anna.face_count, self.anna.cover_face_id))
        self.assertNotIn("Zebulon Anna", _captions(self.face))

    def test_undoing_not_this_person_gives_the_person_back(self) -> None:
        self.face.person = self.anna
        self.face.save()
        previous = self._label(Person.UNKNOWN_PERSON_NAME)
        self.face.refresh_from_db()
        self.assertIsNone(self.face.cluster_person_id)

        self._post("/api/restore-face-labels/", {"faces": previous})

        self.face.refresh_from_db()
        self.anna.refresh_from_db()
        self.assertEqual(
            (self.anna.pk, self.cluster.pk),
            (self.face.person_id, self.face.cluster_person_id),
        )
        self.assertEqual(1, self.anna.face_count)
        self.assertIn("Zebulon Anna", _captions(self.face))

    def test_someone_elses_person_is_restored_as_no_one(self) -> None:
        theirs = create_test_person(name="Mallory", cluster_owner=create_test_user())

        self._post(
            "/api/restore-face-labels/",
            {
                "faces": [
                    {
                        "id": self.face.pk,
                        "person": theirs.pk,
                        "cluster_person": theirs.pk,
                        "classification_person": self.anna.pk,
                    }
                ]
            },
        )

        self.face.refresh_from_db()
        self.assertEqual(
            (None, None, self.anna.pk),
            (
                self.face.person_id,
                self.face.cluster_person_id,
                self.face.classification_person_id,
            ),
        )

    def test_someone_elses_face_is_skipped(self) -> None:
        their_face = create_test_face(photo=create_test_photo(owner=create_test_user()))

        body = self._post(
            "/api/restore-face-labels/",
            {
                "faces": [
                    {
                        "id": their_face.pk,
                        "person": self.anna.pk,
                        "cluster_person": None,
                        "classification_person": None,
                    }
                ]
            },
        )

        self.assertEqual([], body["restored_ids"])
        their_face.refresh_from_db()
        self.assertIsNone(their_face.person_id)

    def test_a_face_without_its_people_is_a_bad_request(self) -> None:
        response = self.client.post(
            "/api/restore-face-labels/",
            {"faces": [{"id": self.face.pk}]},
            format="json",
        )

        self.assertEqual(400, response.status_code)
        fields = {error["field"] for error in response.json()["errors"]}
        self.assertTrue(any(field.startswith("faces") for field in fields), fields)


@patch("api.faces.labels.write_photo_metadata")
class RestoreWriteBackTest(TestCase):
    """A restore writes the regions back, only when the user opted in."""

    def _restore(self, **user_fields: object) -> dict[str, object]:
        user = create_test_user(**user_fields)
        person = create_test_person(name="Anna", cluster_owner=user)
        face = create_test_face(
            photo=create_test_photo(owner=user), person=person, deleted=True
        )
        client = APIClient()
        client.force_authenticate(user=user)
        response = client.post(
            "/api/restore-faces/", {"face_ids": [face.pk]}, format="json"
        )
        self.assertEqual(200, response.status_code)
        body: dict[str, object] = response.json()
        return body

    def test_the_regions_are_written_when_opted_in(self, write: MagicMock) -> None:
        self._restore(
            save_metadata_to_disk=User.SaveMetadata.SIDECAR_FILE,
            save_face_tags_to_disk=True,
        )

        self.assertEqual(1, write.call_count)
        self.assertEqual(["face_tags"], write.call_args.kwargs["metadata_types"])

    def test_nothing_is_written_with_face_tags_off(self, write: MagicMock) -> None:
        self._restore(
            save_metadata_to_disk=User.SaveMetadata.SIDECAR_FILE,
            save_face_tags_to_disk=False,
        )

        write.assert_not_called()
