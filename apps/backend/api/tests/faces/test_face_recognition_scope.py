"""Which faces clustering and training learn from, and what a rebuild deletes.

- #2748: a deleted face (often not a face at all, like a painting) stays out
  of the HDBSCAN fit, not only out of the clusters assigned after it.
- #2753: a face on a hidden, trashed or removed photo stays out of clustering
  and training, like it stays off the photo lists; restoring the photo brings
  it back.
- #2732: clustering one user deletes only that user's clusters and cluster
  people, never another user's, and never a named person, not even one
  without faces.
"""

import datetime
import uuid
from unittest.mock import MagicMock, patch

import numpy as np
from django.test import TestCase, override_settings

from api.faces import classify
from api.faces.classify import (
    cluster_all_faces,
    collect_face_encodings,
    create_all_clusters,
    delete_clustered_people,
    delete_clusters,
    split_faces_by_label,
)
from api.models import Face, LongRunningJob, Person, Photo
from api.models.cluster import Cluster
from api.models.photo import restore_photos, trash_photos
from api.tests.utils import (
    create_test_cluster,
    create_test_face,
    create_test_person,
    create_test_photo,
    create_test_user,
)


def enc_hex(seed: int, length: int = 128) -> str:
    rng = np.random.RandomState(seed)
    return rng.rand(length).astype(np.float64).tobytes().hex()


class FaceSetup(TestCase):
    def setUp(self) -> None:
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)
        self.person = create_test_person(name="Alice", cluster_owner=self.user)

    def face_on(self, photo: Photo, seed: int, **kwargs: object) -> Face:
        return create_test_face(photo=photo, encoding=enc_hex(seed), **kwargs)

    def learned_ids(self) -> set[int]:
        """Face ids clustering reads, and those training reads (labelled faces
        are keyed by their person, so they come back as the person's id)."""
        return set(collect_face_encodings(self.user)["id"])

    def trained_unknown_ids(self) -> set[int]:
        _, unknown = split_faces_by_label(self.user)
        return set(unknown["id"])

    def trained_known_ids(self) -> list[int]:
        known, _ = split_faces_by_label(self.user)
        return known["id"]


class DeletedFacesAreNotClusteredTest(FaceSetup):
    """#2748"""

    def test_a_deleted_face_is_not_collected(self) -> None:
        kept = self.face_on(self.photo, 1)
        deleted = self.face_on(self.photo, 2, deleted=True)

        ids = self.learned_ids()

        self.assertIn(kept.id, ids)
        self.assertNotIn(deleted.id, ids)

    def test_the_fit_sees_the_same_encodings_as_without_the_deleted_face(
        self,
    ) -> None:
        self.face_on(self.photo, 1)
        self.face_on(self.photo, 2)
        self.face_on(self.photo, 3, deleted=True)

        fitted = []

        class FakeHdbscan:
            labels_ = np.array([0, 0])

            def fit(self, data: np.ndarray) -> None:
                fitted.append(data)

        with (
            patch.object(classify, "make_hdbscan", return_value=FakeHdbscan()),
            patch.object(classify.ClusterManager, "try_add_cluster", return_value=[]),
        ):
            target = create_all_clusters(self.user)

        self.assertEqual(target, 2)
        self.assertEqual(fitted[0].shape, (2, 128))


class FacesOfPhotosOffTheListsTest(FaceSetup):
    """#2753"""

    def setUp(self) -> None:
        super().setUp()
        self.shown = self.face_on(self.photo, 1)
        self.shown_labelled = self.face_on(self.photo, 2, person=self.person)

    def off_list_photo(self, **fields: object) -> Photo:
        photo = create_test_photo(owner=self.user)
        Photo.objects.filter(pk=photo.pk).update(**fields)
        return photo

    def assert_left_out(self, photo: Photo) -> None:
        unknown = self.face_on(photo, 3)
        labelled = self.face_on(photo, 4, person=self.person)

        self.assertEqual(self.learned_ids(), {self.shown.id, self.shown_labelled.id})
        self.assertNotIn(unknown.id, self.trained_unknown_ids())
        self.assertIn(self.shown.id, self.trained_unknown_ids())
        # Only the labelled face of the shown photo trains Alice.
        self.assertEqual(self.trained_known_ids(), [self.person.id])
        self.assertTrue(Face.objects.filter(pk=labelled.pk).exists())

    def test_faces_of_a_trashed_photo_are_left_out(self) -> None:
        photo = create_test_photo(owner=self.user)
        trash_photos(Photo.objects.filter(pk=photo.pk))

        self.assert_left_out(photo)

    def test_faces_of_a_removed_photo_are_left_out(self) -> None:
        self.assert_left_out(self.off_list_photo(removed=True))

    def test_faces_of_a_hidden_photo_are_left_out(self) -> None:
        self.assert_left_out(self.off_list_photo(hidden=True))

    def test_faces_of_an_archived_photo_stay(self) -> None:
        photo = self.off_list_photo(archived=True)
        face = self.face_on(photo, 3)

        self.assertIn(face.id, self.learned_ids())
        self.assertIn(face.id, self.trained_unknown_ids())

    def test_restoring_the_photo_brings_its_faces_back(self) -> None:
        photo = create_test_photo(owner=self.user)
        face = self.face_on(photo, 3)
        trash_photos(Photo.objects.filter(pk=photo.pk))
        self.assertNotIn(face.id, self.learned_ids())

        restore_photos(Photo.objects.filter(pk=photo.pk))

        self.assertIn(face.id, self.learned_ids())
        self.assertIn(face.id, self.trained_unknown_ids())


class ClusteringDeletesOnlyTheUsersOwnRowsTest(TestCase):
    """#2732"""

    def setUp(self) -> None:
        self.user = create_test_user()
        self.other = create_test_user()

    def test_clusters_of_another_user_and_ownerless_ones_survive(self) -> None:
        mine = create_test_cluster(owner=self.user)
        theirs = create_test_cluster(owner=self.other)
        ownerless = create_test_cluster(owner=self.other)
        Cluster.objects.filter(pk=ownerless.pk).update(owner=None)

        delete_clusters(self.user)

        self.assertFalse(Cluster.objects.filter(pk=mine.pk).exists())
        self.assertTrue(Cluster.objects.filter(pk=theirs.pk).exists())
        self.assertTrue(Cluster.objects.filter(pk=ownerless.pk).exists())

    def test_cluster_people_of_another_user_and_ownerless_people_survive(
        self,
    ) -> None:
        mine = create_test_person(
            name="Unknown 1", kind=Person.KIND_CLUSTER, cluster_owner=self.user
        )
        my_unknown = create_test_person(
            name=Person.UNKNOWN_PERSON_NAME,
            kind=Person.KIND_UNKNOWN,
            cluster_owner=self.user,
        )
        my_named = create_test_person(name="Alice", cluster_owner=self.user)
        theirs = create_test_person(
            name="Unknown 1", kind=Person.KIND_CLUSTER, cluster_owner=self.other
        )
        their_named = create_test_person(name="Bob", cluster_owner=self.other)
        ownerless = create_test_person(name="Carol", cluster_owner=None)

        delete_clustered_people(self.user)

        self.assertFalse(Person.objects.filter(pk__in=[mine.pk, my_unknown.pk]))
        survivors = Person.objects.filter(
            pk__in=[my_named.pk, theirs.pk, their_named.pk, ownerless.pk]
        )
        self.assertEqual(survivors.count(), 4)


@override_settings(FEATURE_FACE_CLUSTER=True)
@patch("api.faces.classify.enqueue_followup")
class ClusteringKeepsNamedPeopleTest(TestCase):
    """Clustering rebuilds only its own rows: the cluster people ("Unknown
    NNN", "Unknown - Other") and the clusters. A named person without faces,
    made by hand or left empty when its faces were moved, is the user's own
    and survives every rebuild, like its birth date does."""

    def setUp(self) -> None:
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)

    def cluster(self) -> None:
        job_id = str(uuid.uuid4())
        LongRunningJob.create_job(
            self.user, LongRunningJob.JOB_CLUSTER_ALL_FACES, job_id=job_id
        )
        self.assertTrue(cluster_all_faces(self.user, job_id))

    def test_named_people_without_faces_survive(self, enqueue: MagicMock) -> None:
        by_hand = create_test_person(name="Made by hand", cluster_owner=self.user)
        born = create_test_person(
            name="Born",
            cluster_owner=self.user,
            birth_date=datetime.date(2001, 2, 3),
        )

        self.cluster()

        survivors = Person.objects.filter(pk__in=[by_hand.pk, born.pk])
        self.assertEqual(survivors.count(), 2)
        self.assertEqual(
            Person.objects.get(pk=born.pk).birth_date, datetime.date(2001, 2, 3)
        )

    def test_cluster_people_go_with_their_rejections(self, enqueue: MagicMock) -> None:
        cluster_person = create_test_person(
            name="Unknown 1", kind=Person.KIND_CLUSTER, cluster_owner=self.user
        )
        named = create_test_person(name="Anna", cluster_owner=self.user)
        # Deleted, so the fit has no faces to learn from: only the deletes run.
        face = create_test_face(photo=self.photo, deleted=True)
        face.rejected_persons.add(cluster_person, named)

        self.cluster()

        self.assertFalse(Person.objects.filter(pk=cluster_person.pk).exists())
        # A rebuilt cluster is a new person: "Not Unknown 1" means nothing
        # any more, while "Not Anna" is kept.
        self.assertEqual(list(face.rejected_persons.all()), [named])
