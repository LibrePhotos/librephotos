"""Taking a person off photos from the person page (#2207).

``POST /api/persons/<id>/remove-photos/`` sends the person's faces on the
given photos back to unknown, through the same ``relabel_faces`` path the
face dashboard's labelling uses. The cover fix rides along: a person whose
cover face is relabelled away gets a new cover instead of keeping one they
are no longer on.
"""

from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from api.faces.labels import relabel_faces, summarize_write_errors
from api.metadata.writer import MetadataWriteError
from api.models import Face, Person
from api.models.photo_search import PhotoSearch
from api.models.user import User
from api.tests.utils import (
    create_test_face,
    create_test_person,
    create_test_photo,
    create_test_user,
)


def remove_url(person: Person) -> str:
    return f"/api/persons/{person.pk}/remove-photos/"


class PersonRemovePhotosTest(TestCase):
    def setUp(self) -> None:
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.anna = create_test_person(name="Anna", cluster_owner=self.user)
        self.ben = create_test_person(name="Ben", cluster_owner=self.user)
        self.photo1 = create_test_photo(owner=self.user)
        self.photo2 = create_test_photo(owner=self.user)
        self.photo3 = create_test_photo(owner=self.user)
        self.face1 = create_test_face(
            photo=self.photo1,
            person=self.anna,
            cluster_person=self.anna,
            classification_person=self.anna,
        )
        self.face2 = create_test_face(photo=self.photo2, person=self.anna)
        self.face3 = create_test_face(photo=self.photo3, person=self.anna)
        # Ben stands next to Anna on the first photo.
        self.ben_face = create_test_face(photo=self.photo1, person=self.ben)
        for person in (self.anna, self.ben):
            person._calculate_face_count()

    def _remove(self, person: Person, *photos: object) -> object:
        return self.client.post(
            remove_url(person),
            {"photo_ids": [str(getattr(p, "pk", p)) for p in photos]},
            format="json",
        )

    def test_unlabels_only_that_persons_faces_on_the_given_photos(self) -> None:
        response = self._remove(self.anna, self.photo1, self.photo2)

        self.assertEqual(200, response.status_code, response.content)
        self.assertEqual(
            {"removed": 2, "photo_count": 2, "write_error": None}, response.json()
        )
        face1 = Face.objects.get(pk=self.face1.pk)
        self.assertIsNone(face1.person_id)
        # "Not this person": the suggestions go too, so the face is unknown.
        self.assertIsNone(face1.cluster_person_id)
        self.assertIsNone(face1.classification_person_id)
        self.assertIsNone(Face.objects.get(pk=self.face2.pk).person_id)
        self.assertEqual(self.anna.pk, Face.objects.get(pk=self.face3.pk).person_id)
        self.assertEqual(self.ben.pk, Face.objects.get(pk=self.ben_face.pk).person_id)

    def test_updates_the_face_count(self) -> None:
        self._remove(self.anna, self.photo1)

        self.assertEqual(2, Person.objects.get(pk=self.anna.pk).face_count)
        self.assertEqual(1, Person.objects.get(pk=self.ben.pk).face_count)

    def test_a_photo_without_the_person_is_ignored(self) -> None:
        other = create_test_photo(owner=self.user)

        response = self._remove(self.ben, self.photo2, other)

        self.assertEqual(
            {"removed": 0, "photo_count": 0, "write_error": None}, response.json()
        )
        self.assertEqual(self.anna.pk, Face.objects.get(pk=self.face2.pk).person_id)

    def test_picks_a_new_cover_when_the_cover_photo_is_removed(self) -> None:
        Person.objects.filter(pk=self.anna.pk).update(
            cover_face=self.face1, cover_photo=self.photo1
        )

        self._remove(self.anna, self.photo1)

        anna = Person.objects.get(pk=self.anna.pk)
        self.assertIn(anna.cover_face_id, {self.face2.pk, self.face3.pk})
        self.assertEqual(
            Face.objects.get(pk=anna.cover_face_id).photo_id, anna.cover_photo_id
        )

    def test_keeps_a_cover_that_is_not_removed(self) -> None:
        Person.objects.filter(pk=self.anna.pk).update(
            cover_face=self.face3, cover_photo=self.photo3
        )

        self._remove(self.anna, self.photo1)

        anna = Person.objects.get(pk=self.anna.pk)
        self.assertEqual(self.face3.pk, anna.cover_face_id)
        self.assertEqual(self.photo3.pk, anna.cover_photo_id)

    def test_removing_every_photo_leaves_no_cover(self) -> None:
        Person.objects.filter(pk=self.anna.pk).update(
            cover_face=self.face1, cover_photo=self.photo1
        )

        self._remove(self.anna, self.photo1, self.photo2, self.photo3)

        anna = Person.objects.get(pk=self.anna.pk)
        self.assertIsNone(anna.cover_face_id)
        self.assertIsNone(anna.cover_photo_id)
        self.assertEqual(0, anna.face_count)

    def test_the_photos_are_no_longer_found_by_the_name(self) -> None:
        self._remove(self.anna, self.photo2)

        search = PhotoSearch.objects.get(photo=self.photo2)
        self.assertNotIn("Anna", search.search_captions or "")

    def test_another_users_person_is_not_found(self) -> None:
        stranger = create_test_user()
        their_person = create_test_person(name="Anna", cluster_owner=stranger)
        their_photo = create_test_photo(owner=stranger)
        their_face = create_test_face(photo=their_photo, person=their_person)

        response = self._remove(their_person, their_photo)

        self.assertEqual(404, response.status_code)
        self.assertEqual(their_person.pk, Face.objects.get(pk=their_face.pk).person_id)

    def test_another_users_photo_is_ignored(self) -> None:
        # A face on someone else's photo can carry this user's person (#2047);
        # naming that photo must not unlabel it.
        stranger = create_test_user()
        their_photo = create_test_photo(owner=stranger)
        their_face = create_test_face(photo=their_photo, person=self.anna)

        response = self._remove(self.anna, their_photo)

        self.assertEqual(200, response.status_code)
        self.assertEqual(0, response.json()["removed"])
        self.assertEqual(self.anna.pk, Face.objects.get(pk=their_face.pk).person_id)

    def test_a_cluster_person_has_no_page(self) -> None:
        cluster = create_test_person(
            name="Unknown 1", kind=Person.KIND_CLUSTER, cluster_owner=self.user
        )

        self.assertEqual(404, self._remove(cluster, self.photo1).status_code)

    def test_refuses_a_bad_body(self) -> None:
        for body in ({}, {"photo_ids": []}, {"photo_ids": ["not-a-uuid"]}):
            with self.subTest(body=body):
                response = self.client.post(remove_url(self.anna), body, format="json")
                self.assertEqual(400, response.status_code)
        self.assertEqual(3, Person.objects.get(pk=self.anna.pk).face_count)

    def test_an_anonymous_request_is_refused(self) -> None:
        response = APIClient().post(
            remove_url(self.anna), {"photo_ids": [str(self.photo1.pk)]}, format="json"
        )

        self.assertEqual(401, response.status_code)


@patch("api.faces.labels.write_photo_metadata")
class RemovePhotosWriteBackTest(TestCase):
    """The face regions follow the relabel to disk, only when the user opted in."""

    def _setup(self, **user_fields: object) -> tuple[User, Person, list[object]]:
        user = create_test_user(**user_fields)
        person = create_test_person(name="Anna", cluster_owner=user)
        photos = [create_test_photo(owner=user) for _ in range(2)]
        for photo in photos:
            create_test_face(photo=photo, person=person)
        return user, person, photos

    def _remove(self, user: User, person: Person, photos: list[object]) -> object:
        client = APIClient()
        client.force_authenticate(user=user)
        return client.post(
            remove_url(person),
            {"photo_ids": [str(getattr(p, "pk", p)) for p in photos]},
            format="json",
        )

    def test_writes_each_photo_once_when_opted_in(self, write) -> None:
        user, person, photos = self._setup(
            save_metadata_to_disk=User.SaveMetadata.SIDECAR_FILE,
            save_face_tags_to_disk=True,
        )

        response = self._remove(user, person, photos)

        self.assertEqual(200, response.status_code)
        self.assertEqual(2, write.call_count)
        self.assertEqual(
            {True}, {call.kwargs["use_sidecar"] for call in write.call_args_list}
        )

    def test_writes_nothing_with_metadata_sync_off(self, write) -> None:
        user, person, photos = self._setup(
            save_metadata_to_disk=User.SaveMetadata.OFF, save_face_tags_to_disk=True
        )

        self._remove(user, person, photos)

        write.assert_not_called()

    def test_writes_nothing_with_face_tags_off(self, write) -> None:
        user, person, photos = self._setup(
            save_metadata_to_disk=User.SaveMetadata.SIDECAR_FILE,
            save_face_tags_to_disk=False,
        )

        self._remove(user, person, photos)

        write.assert_not_called()

    def test_a_failed_write_keeps_the_relabel_and_says_so(self, write) -> None:
        write.side_effect = [
            MetadataWriteError("/photos/a.jpg", "read-only"),
            RuntimeError("boom"),
        ]
        user, person, photos = self._setup(
            save_metadata_to_disk=User.SaveMetadata.SIDECAR_FILE,
            save_face_tags_to_disk=True,
        )

        response = self._remove(user, person, photos)

        self.assertEqual(200, response.status_code)
        self.assertEqual(
            "2 of 2 photos were not written: read-only", response.json()["write_error"]
        )
        self.assertFalse(Face.objects.filter(person=person).exists())


class RelabelFacesTest(TestCase):
    """The cover fix applies to every relabel, the face dashboard's too."""

    def setUp(self) -> None:
        self.user = create_test_user()
        self.anna = create_test_person(name="Anna", cluster_owner=self.user)
        self.photo1 = create_test_photo(owner=self.user)
        self.photo2 = create_test_photo(owner=self.user)
        self.face1 = create_test_face(photo=self.photo1, person=self.anna)
        self.face2 = create_test_face(photo=self.photo2, person=self.anna)
        Person.objects.filter(pk=self.anna.pk).update(
            cover_face=self.face1, cover_photo=self.photo1
        )

    def test_labelling_the_cover_face_as_someone_else_moves_the_cover(self) -> None:
        client = APIClient()
        client.force_authenticate(user=self.user)

        response = client.post(
            "/api/labelfaces",
            {"person_name": "Ben", "face_ids": [self.face1.pk]},
            format="json",
        )

        self.assertEqual(200, response.status_code)
        anna = Person.objects.get(pk=self.anna.pk)
        self.assertEqual(self.face2.pk, anna.cover_face_id)
        self.assertEqual(self.photo2.pk, anna.cover_photo_id)
        ben = Person.objects.get(name="Ben", cluster_owner=self.user)
        self.assertEqual(self.face1.pk, ben.cover_face_id)

    def test_relabelling_to_the_same_person_keeps_the_cover(self) -> None:
        anna = Person.objects.get(pk=self.anna.pk)

        relabel_faces(self.user, Face.objects.filter(pk=self.face1.pk), anna)

        anna.refresh_from_db()
        self.assertEqual(self.face1.pk, anna.cover_face_id)
        self.assertEqual(self.photo1.pk, anna.cover_photo_id)

    def test_only_the_users_own_faces_are_relabelled(self) -> None:
        stranger = create_test_user()
        their_face = create_test_face(
            photo=create_test_photo(owner=stranger), person=self.anna
        )

        result = relabel_faces(self.user, Face.objects.all(), None)

        self.assertCountEqual(
            [self.face1.pk, self.face2.pk], [f.pk for f in result.faces]
        )
        self.assertEqual(self.anna.pk, Face.objects.get(pk=their_face.pk).person_id)


class SummarizeWriteErrorsTest(TestCase):
    def test_no_errors(self) -> None:
        self.assertIsNone(summarize_write_errors([], 3))

    def test_one_photo(self) -> None:
        self.assertEqual("read-only", summarize_write_errors(["read-only"], 1))

    def test_several_photos(self) -> None:
        self.assertEqual(
            "1 of 3 photos were not written: read-only",
            summarize_write_errors(["read-only"], 3),
        )
