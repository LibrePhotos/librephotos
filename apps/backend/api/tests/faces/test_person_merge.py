"""Merging two people into one (#2206).

``POST /api/persons/<target>/merge/`` with ``{"person": <source>}`` moves
every face of the source to the target (labelled faces through
``relabel_faces``, suggestions and clusters repointed), keeps the target's
name and cover, and deletes the source. The face tag write-back is queued.
"""

from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from api.faces.labels import write_face_tags_later
from api.faces.merge import merge_people
from api.models import Cluster, Face, Person
from api.models.deletion_log import DeletionLog
from api.models.photo_search import PhotoSearch
from api.models.user import User
from api.tests.utils import (
    create_test_cluster,
    create_test_face,
    create_test_person,
    create_test_photo,
    create_test_user,
)


def merge_url(target: Person) -> str:
    return f"/api/persons/{target.pk}/merge/"


class PersonMergeTest(TestCase):
    def setUp(self) -> None:
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        # "Bob" is "Robert" under a nickname.
        self.robert = create_test_person(name="Robert", cluster_owner=self.user)
        self.bob = create_test_person(name="Bob", cluster_owner=self.user)
        self.photo1 = create_test_photo(owner=self.user)
        self.photo2 = create_test_photo(owner=self.user)
        self.photo3 = create_test_photo(owner=self.user)
        self.robert_face = create_test_face(photo=self.photo1, person=self.robert)
        self.bob_face1 = create_test_face(
            photo=self.photo2,
            person=self.bob,
            cluster_person=self.bob,
            classification_person=self.bob,
        )
        self.bob_face2 = create_test_face(photo=self.photo3, person=self.bob)
        # An unlabelled face the classifier and the clustering think is Bob.
        self.suggested = create_test_face(
            photo=self.photo1, classification_person=self.bob, cluster_person=self.bob
        )
        for person in (self.robert, self.bob):
            person._calculate_face_count()
        Person.objects.filter(pk=self.robert.pk).update(
            cover_face=self.robert_face, cover_photo=self.photo1
        )

    def _merge(self, target: Person, source: object) -> object:
        return self.client.post(
            merge_url(target), {"person": getattr(source, "pk", source)}, format="json"
        )

    def test_moves_the_labelled_faces_and_deletes_the_source(self) -> None:
        response = self._merge(self.robert, self.bob)

        self.assertEqual(200, response.status_code, response.content)
        self.assertEqual(
            {"moved": 2, "photo_count": 2, "write_queued": False}, response.json()
        )
        for face in (self.bob_face1, self.bob_face2):
            self.assertEqual(self.robert.pk, Face.objects.get(pk=face.pk).person_id)
        self.assertFalse(Person.objects.filter(pk=self.bob.pk).exists())

    def test_moves_the_suggestions(self) -> None:
        self._merge(self.robert, self.bob)

        for face in (self.bob_face1, self.suggested):
            moved = Face.objects.get(pk=face.pk)
            self.assertEqual(self.robert.pk, moved.cluster_person_id)
            self.assertEqual(self.robert.pk, moved.classification_person_id)
        # A suggestion is no label.
        self.assertIsNone(Face.objects.get(pk=self.suggested.pk).person_id)

    def test_moves_the_clusters(self) -> None:
        cluster = create_test_cluster(self.user, person=self.bob)

        self._merge(self.robert, self.bob)

        self.assertEqual(self.robert.pk, Cluster.objects.get(pk=cluster.pk).person_id)

    def test_counts_the_target_and_keeps_its_cover(self) -> None:
        self._merge(self.robert, self.bob)

        robert = Person.objects.get(pk=self.robert.pk)
        self.assertEqual(3, robert.face_count)
        self.assertEqual("Robert", robert.name)
        self.assertEqual(self.robert_face.pk, robert.cover_face_id)
        self.assertEqual(self.photo1.pk, robert.cover_photo_id)

    def test_a_target_without_a_cover_gets_one(self) -> None:
        Person.objects.filter(pk=self.robert.pk).update(
            cover_face=None, cover_photo=None
        )

        self._merge(self.robert, self.bob)

        robert = Person.objects.get(pk=self.robert.pk)
        self.assertIsNotNone(robert.cover_face_id)
        self.assertEqual(
            Face.objects.get(pk=robert.cover_face_id).photo_id, robert.cover_photo_id
        )

    def test_the_photos_are_found_by_the_target_name(self) -> None:
        self._merge(self.robert, self.bob)

        search = PhotoSearch.objects.get(photo=self.photo2)
        self.assertIn("Robert", search.search_captions or "")
        self.assertNotIn("Bob", search.search_captions or "")

    def test_the_phones_are_told_the_source_is_gone(self) -> None:
        self._merge(self.robert, self.bob)

        self.assertTrue(
            DeletionLog.objects.filter(
                entity=DeletionLog.ENTITY_PERSON, entity_id=str(self.bob.pk)
            ).exists()
        )

    def test_a_face_on_another_users_photo_is_not_moved(self) -> None:
        # A face on someone else's photo can carry this user's person (#2047).
        stranger = create_test_user()
        their_face = create_test_face(
            photo=create_test_photo(owner=stranger), person=self.bob
        )

        response = self._merge(self.robert, self.bob)

        self.assertEqual(2, response.json()["moved"])
        # The delete clears it, as a plain delete of Bob would.
        self.assertIsNone(Face.objects.get(pk=their_face.pk).person_id)

    def test_refuses_a_self_merge(self) -> None:
        response = self._merge(self.robert, self.robert)

        self.assertEqual(400, response.status_code)
        self.assertEqual("self_merge", response.json()["errors"][0]["code"])
        self.assertTrue(Person.objects.filter(pk=self.robert.pk).exists())

    def test_another_users_person_is_not_found(self) -> None:
        stranger = create_test_user()
        theirs = create_test_person(name="Bob", cluster_owner=stranger)
        their_face = create_test_face(
            photo=create_test_photo(owner=stranger), person=theirs
        )

        for target, source in ((self.robert, theirs), (theirs, self.bob)):
            with self.subTest(target=target.name, source=source.pk):
                self.assertEqual(404, self._merge(target, source).status_code)
        self.assertEqual(theirs.pk, Face.objects.get(pk=their_face.pk).person_id)
        self.assertTrue(Person.objects.filter(pk=self.bob.pk).exists())

    def test_a_cluster_or_the_unknown_person_cannot_be_merged(self) -> None:
        for kind in (Person.KIND_CLUSTER, Person.KIND_UNKNOWN):
            other = create_test_person(
                name=f"Not named {kind}", kind=kind, cluster_owner=self.user
            )
            with self.subTest(kind=kind):
                self.assertEqual(404, self._merge(self.robert, other).status_code)
                self.assertEqual(404, self._merge(other, self.bob).status_code)
                self.assertTrue(Person.objects.filter(pk=other.pk).exists())

    def test_an_unknown_id_is_not_found(self) -> None:
        self.assertEqual(404, self._merge(self.robert, 987654).status_code)

    def test_refuses_a_bad_body(self) -> None:
        for body in ({}, {"person": None}, {"person": "bob"}):
            with self.subTest(body=body):
                response = self.client.post(merge_url(self.robert), body, format="json")
                self.assertEqual(400, response.status_code)
        self.assertTrue(Person.objects.filter(pk=self.bob.pk).exists())

    def test_an_anonymous_request_is_refused(self) -> None:
        response = APIClient().post(
            merge_url(self.robert), {"person": self.bob.pk}, format="json"
        )

        self.assertEqual(401, response.status_code)

    def test_merge_people_refuses_one_person(self) -> None:
        with self.assertRaises(ValueError):
            merge_people(self.user, self.robert, self.robert)


@patch("api.faces.labels.enqueue_task")
class MergeWriteBackTest(TestCase):
    """The face regions follow the merge to disk in the background, when opted in."""

    def _setup(self, **user_fields: object) -> tuple[User, Person, Person]:
        user = create_test_user(**user_fields)
        target = create_test_person(name="Robert", cluster_owner=user)
        source = create_test_person(name="Bob", cluster_owner=user)
        for _ in range(2):
            create_test_face(photo=create_test_photo(owner=user), person=source)
        return user, target, source

    def _merge(self, user: User, target: Person, source: Person) -> object:
        client = APIClient()
        client.force_authenticate(user=user)
        with self.captureOnCommitCallbacks(execute=True):
            return client.post(merge_url(target), {"person": source.pk}, format="json")

    def test_queues_the_write_after_the_commit(self, enqueue) -> None:
        user, target, source = self._setup(
            save_metadata_to_disk=User.SaveMetadata.SIDECAR_FILE,
            save_face_tags_to_disk=True,
        )
        photo_ids = set(
            Face.objects.filter(person=source).values_list("photo_id", flat=True)
        )

        response = self._merge(user, target, source)

        self.assertTrue(response.json()["write_queued"])
        enqueue.assert_called_once()
        func, user_id, queued_ids = enqueue.call_args.args
        self.assertIs(write_face_tags_later, func)
        self.assertEqual(user.pk, user_id)
        self.assertEqual(photo_ids, set(queued_ids))

    def test_queues_nothing_with_metadata_sync_off(self, enqueue) -> None:
        user, target, source = self._setup(
            save_metadata_to_disk=User.SaveMetadata.OFF, save_face_tags_to_disk=True
        )

        response = self._merge(user, target, source)

        self.assertFalse(response.json()["write_queued"])
        enqueue.assert_not_called()

    def test_queues_nothing_with_face_tags_off(self, enqueue) -> None:
        user, target, source = self._setup(
            save_metadata_to_disk=User.SaveMetadata.SIDECAR_FILE,
            save_face_tags_to_disk=False,
        )

        self._merge(user, target, source)

        enqueue.assert_not_called()


@patch("api.faces.labels.write_photo_metadata")
class WriteFaceTagsLaterTest(TestCase):
    """The queued write: the user's own photos, under their current settings."""

    def setUp(self) -> None:
        self.user = create_test_user(
            save_metadata_to_disk=User.SaveMetadata.MEDIA_FILE,
            save_face_tags_to_disk=True,
        )
        self.photos = [create_test_photo(owner=self.user) for _ in range(2)]

    def test_writes_each_photo(self, write) -> None:
        error = write_face_tags_later(self.user.pk, [p.pk for p in self.photos])

        self.assertIsNone(error)
        self.assertEqual(2, write.call_count)
        self.assertEqual(
            {False}, {call.kwargs["use_sidecar"] for call in write.call_args_list}
        )

    def test_skips_another_users_photo(self, write) -> None:
        theirs = create_test_photo(owner=create_test_user())

        write_face_tags_later(self.user.pk, [theirs.pk])

        write.assert_not_called()

    def test_follows_a_setting_turned_off_since(self, write) -> None:
        User.objects.filter(pk=self.user.pk).update(save_face_tags_to_disk=False)

        write_face_tags_later(self.user.pk, [p.pk for p in self.photos])

        write.assert_not_called()

    def test_a_deleted_user_writes_nothing(self, write) -> None:
        self.assertIsNone(write_face_tags_later(987654, [self.photos[0].pk]))
        write.assert_not_called()

    def test_reports_a_failed_write(self, write) -> None:
        write.side_effect = RuntimeError("boom")

        error = write_face_tags_later(self.user.pk, [self.photos[0].pk])

        self.assertEqual("the face tags could not be written to the file", error)
