"""The writes that move a face, its cluster or its person between states.

Each test drives a bad interleaving by hand: a copy of a row loaded before
someone else changed it, a rebuild that fails half-way, a second rebuild
between another one's reading and writing.
"""

import inspect
from unittest.mock import MagicMock, patch

import numpy as np
from constance.test import override_config
from django.db import connection
from django.test import TestCase, override_settings

from api.faces import classify, labels, photo_faces
from api.faces.cluster_manager import ClusterManager
from api.models import Face, Person, PhotoSearch
from api.models.cluster import Cluster, get_unknown_cluster
from api.models.person import get_or_create_person
from api.tests.utils import (
    create_test_face,
    create_test_person,
    create_test_photo,
    create_test_user,
)

MODEL = "buffalo_sc"


def enc_hex(seed: int) -> str:
    return np.random.RandomState(seed).rand(128).astype(np.float64).tobytes().hex()


def fake_hdbscan(labels_: list[int]) -> MagicMock:
    instance = MagicMock()
    instance.labels_ = np.array(labels_)
    return MagicMock(return_value=instance)


@override_config(FACE_RECOGNITION_MODEL=MODEL)
class EncodingKeepsConcurrentChangesTest(TestCase):
    """Generate Face Embeddings encodes faces loaded when its loop started."""

    def setUp(self) -> None:
        self.user = create_test_user()
        self.face = create_test_face(
            photo=create_test_photo(owner=self.user),
            location_top=10,
            location_right=60,
            location_bottom=60,
            location_left=10,
        )
        Face.objects.filter(pk=self.face.pk).update(encoding="")
        self.stale = Face.objects.get(pk=self.face.pk)

    def encode(self, encodings: list[object]) -> None:
        with patch.object(photo_faces, "get_face_encodings", return_value=encodings):
            photo_faces.generate_face_encoding(self.stale)

    def test_a_label_set_meanwhile_stays(self) -> None:
        anna = create_test_person(name="Anna", cluster_owner=self.user)
        Face.objects.filter(pk=self.face.pk).update(person=anna, deleted=True)

        self.encode([np.random.rand(512)])

        face = Face.objects.get(pk=self.face.pk)
        self.assertEqual(face.person_id, anna.pk)
        self.assertTrue(face.deleted)
        self.assertNotEqual(face.encoding, "")

    def test_a_face_deleted_meanwhile_is_not_inserted_again(self) -> None:
        Face.objects.filter(pk=self.face.pk).delete()

        self.encode([np.random.rand(512)])

        self.assertFalse(Face.objects.filter(pk=self.face.pk).exists())

    def test_a_face_deleted_meanwhile_is_not_marked_unmatched(self) -> None:
        Face.objects.filter(pk=self.face.pk).delete()

        self.encode([None])

        self.assertFalse(Face.objects.filter(pk=self.face.pk).exists())

    def test_the_encoding_of_a_box_moved_meanwhile_is_dropped(self) -> None:
        Face.objects.filter(pk=self.face.pk).update(location_top=20)

        self.encode([np.random.rand(512)])

        self.assertEqual(Face.objects.get(pk=self.face.pk).encoding, "")


@override_settings(FEATURE_FACE_CLUSTER=True)
class ClusterRebuildTest(TestCase):
    """Find Similar Faces deletes the user's clusters and builds them again."""

    def setUp(self) -> None:
        self.user = create_test_user()
        photo = create_test_photo(owner=self.user)
        self.faces = [
            create_test_face(photo=photo, encoding=enc_hex(seed)) for seed in range(4)
        ]
        self.hdbscan = fake_hdbscan([0, 0, 1, 1])

    def rebuild(self) -> bool:
        with (
            patch.object(classify, "make_hdbscan", self.hdbscan),
            patch.object(classify, "enqueue_followup"),
        ):
            return classify.cluster_all_faces(self.user)

    def clustered_people(self) -> list[str]:
        return sorted(
            Person.objects.owned_by(self.user)
            .filter(kind=Person.KIND_CLUSTER)
            .values_list("name", flat=True)
        )

    def test_a_rebuild_that_fails_half_way_keeps_the_clusters_it_had(self) -> None:
        self.rebuild()
        before = {face.pk: face.cluster_id for face in Face.objects.all()}

        real = ClusterManager.try_add_cluster
        calls = MagicMock(side_effect=[real, RuntimeError("worker killed")])

        def fail_on_second(*args: object) -> list[Cluster]:
            step = calls()
            return step(*args)

        with patch.object(ClusterManager, "try_add_cluster", fail_on_second):
            self.assertFalse(self.rebuild())

        self.assertEqual(self.clustered_people(), ["Unknown 1", "Unknown 2"])
        after = {face.pk: face.cluster_id for face in Face.objects.all()}
        self.assertEqual(after, before)
        self.assertTrue(all(after.values()))

    def test_the_clustering_lock_is_held_before_anything_is_deleted(self) -> None:
        self.rebuild()
        seen: list[tuple[bool, int]] = []

        def lock(user: object) -> None:
            seen.append(
                (
                    connection.in_atomic_block,
                    Cluster.objects.owned_by(self.user).count(),
                )
            )

        with patch.object(classify, "lock_clustering", side_effect=lock):
            self.rebuild()

        self.assertEqual(len(seen), 1)
        in_transaction, clusters_left = seen[0]
        self.assertTrue(in_transaction)
        self.assertGreater(clusters_left, 0)

    def test_a_rebuild_between_another_ones_read_and_write_leaves_one_set(
        self,
    ) -> None:
        real_plan = classify.plan_clusters

        def plan_then_let_another_rebuild_run(user: object) -> object:
            plan = real_plan(user)
            with patch.object(classify, "plan_clusters", real_plan):
                self.rebuild()
            return plan

        with patch.object(
            classify, "plan_clusters", side_effect=plan_then_let_another_rebuild_run
        ):
            self.rebuild()

        self.assertEqual(self.clustered_people(), ["Unknown 1", "Unknown 2"])
        clusters = Cluster.objects.owned_by(self.user).exclude(cluster_id=-1)
        self.assertEqual(
            sorted(clusters.values_list("name", flat=True)), ["Cluster 1", "Cluster 2"]
        )
        live = set(clusters.values_list("pk", flat=True))
        for face in Face.objects.all():
            self.assertIn(face.cluster_id, live)


class MixedClusterTest(TestCase):
    """A cluster holding faces of a named person and unlabelled faces."""

    def test_its_unlabelled_faces_join_the_cluster_of_its_main_person(self) -> None:
        user = create_test_user()
        photo = create_test_photo(owner=user)
        anna = create_test_person(name="Anna", cluster_owner=user)
        bob = create_test_person(name="Bob", cluster_owner=user)
        faces = [
            create_test_face(photo=photo, encoding=enc_hex(seed), person=person)
            for seed, person in enumerate((bob, anna, anna, None))
        ]

        clusters = ClusterManager.try_add_cluster(user, 3, faces)

        anna_cluster = next(c for c in clusters if c.person_id == anna.pk)
        unlabelled = Face.objects.get(pk=faces[3].pk)
        self.assertEqual(unlabelled.cluster_id, anna_cluster.pk)
        self.assertIsNone(unlabelled.person_id)


class RelabelClearsSuggestionsTest(TestCase):
    def setUp(self) -> None:
        self.user = create_test_user()
        self.anna = create_test_person(name="Anna", cluster_owner=self.user)
        self.bob = create_test_person(name="Bob", cluster_owner=self.user)
        self.cluster = create_test_person(
            name="Unknown 4", kind=Person.KIND_CLUSTER, cluster_owner=self.user
        )
        self.face = create_test_face(
            photo=create_test_photo(owner=self.user),
            cluster_person=self.cluster,
            classification_person=self.bob,
        )

    def test_labelling_a_face_drops_the_suggestions_it_had(self) -> None:
        labels.relabel_faces(self.user, Face.objects.filter(pk=self.face.pk), self.anna)

        face = Face.objects.get(pk=self.face.pk)
        self.assertEqual(face.person_id, self.anna.pk)
        self.assertIsNone(face.cluster_person_id)
        self.assertIsNone(face.classification_person_id)

    def test_the_undo_gives_the_suggestions_back(self) -> None:
        result = labels.relabel_faces(
            self.user, Face.objects.filter(pk=self.face.pk), self.anna
        )

        labels.restore_labels(self.user, result.previous)

        face = Face.objects.get(pk=self.face.pk)
        self.assertIsNone(face.person_id)
        self.assertEqual(face.cluster_person_id, self.cluster.pk)
        self.assertEqual(face.classification_person_id, self.bob.pk)


class XmpNameReconcileTest(TestCase):
    """A rescan finds a named face region over a face that has no person."""

    BOX = (10, 60, 60, 10)

    def setUp(self) -> None:
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)
        self.anna = create_test_person(name="Anna", cluster_owner=self.user)
        top, right, bottom, left = self.BOX
        self.face = create_test_face(
            photo=self.photo,
            location_top=top,
            location_right=right,
            location_bottom=bottom,
            location_left=left,
        )

    def reconcile(self) -> None:
        scan = photo_faces._FaceScan(
            self.photo,
            np.zeros((100, 100, 3), dtype=np.uint8),
            get_unknown_cluster(self.user),
            [self.BOX],
        )
        photo_faces._save_new_faces(scan, [(*self.BOX, "Anna")])

    def test_the_face_gets_the_name_and_the_photo_is_found_by_it(self) -> None:
        self.reconcile()

        self.assertEqual(Face.objects.get(pk=self.face.pk).person_id, self.anna.pk)
        self.assertIn("Anna", PhotoSearch.objects.get(photo=self.photo).search_captions)
        self.anna.refresh_from_db()
        self.assertEqual(self.anna.face_count, 1)

    def test_a_person_the_user_said_the_face_is_not_is_not_given_back(self) -> None:
        self.face.rejected_persons.add(self.anna)

        self.reconcile()

        self.assertIsNone(Face.objects.get(pk=self.face.pk).person_id)

    def test_a_deleted_face_is_not_named(self) -> None:
        Face.objects.filter(pk=self.face.pk).update(deleted=True)

        self.reconcile()

        self.assertIsNone(Face.objects.get(pk=self.face.pk).person_id)


class PersonBookkeepingKeepsEditsTest(TestCase):
    """The face count and the default cover are written from a loaded person."""

    def setUp(self) -> None:
        self.user = create_test_user()
        self.person = create_test_person(name="Anna", cluster_owner=self.user)
        create_test_face(photo=create_test_photo(owner=self.user), person=self.person)
        self.stale = Person.objects.get(pk=self.person.pk)
        Person.objects.filter(pk=self.person.pk).update(
            name="Anna Maria", birth_date="1990-05-01"
        )

    def assert_edits_kept(self) -> None:
        person = Person.objects.get(pk=self.person.pk)
        self.assertEqual(person.name, "Anna Maria")
        self.assertEqual(str(person.birth_date), "1990-05-01")

    def test_counting_faces_keeps_a_rename(self) -> None:
        self.stale._calculate_face_count()

        self.assert_edits_kept()
        self.assertEqual(Person.objects.get(pk=self.person.pk).face_count, 1)

    def test_picking_a_default_cover_keeps_a_rename(self) -> None:
        self.stale._set_default_cover_photo()

        self.assert_edits_kept()
        self.assertIsNotNone(Person.objects.get(pk=self.person.pk).cover_face_id)


class NoUnknownKindByDefaultTest(TestCase):
    """Nothing makes a person of the legacy kind UNKNOWN any more."""

    def test_get_or_create_person_has_no_default_kind(self) -> None:
        kind = inspect.signature(get_or_create_person).parameters["kind"]
        self.assertIs(kind.default, inspect.Parameter.empty)
