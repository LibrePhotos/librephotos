"""Deleting a person leaves its faces and clusters behind, unlinked.

``Face.person`` is ``on_delete=SET_NULL``: the faces survive the person and
go back to unlabeled, as do the clusters and the classifier's suggestions.
This held through a ``post_delete`` receiver before, and every way a person
is deleted relies on it: the people list's DELETE, merging two people and
the clustering reset. Relabelling every face of a person away leaves the
person in place, without faces: clustering never deletes a named person.
"""

from django.test import TestCase
from rest_framework.test import APIClient

from api.faces.classify import delete_clustered_people
from api.models.cluster import Cluster
from api.models.deletion_log import DeletionLog
from api.models.face import Face
from api.models.person import Person
from api.tests.utils import (
    create_test_cluster,
    create_test_face,
    create_test_person,
    create_test_photo,
    create_test_user,
)


class PersonDeleteTest(TestCase):
    def setUp(self) -> None:
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.photo = create_test_photo(owner=self.user)
        self.person = create_test_person(name="Alice", cluster_owner=self.user)
        self.other = create_test_person(name="Bob", cluster_owner=self.user)
        self.cluster = create_test_cluster(
            person=self.person, mean_face_encoding="", owner=self.user
        )
        self.face = create_test_face(
            photo=self.photo,
            person=self.person,
            classification_person=self.person,
            cluster_person=self.person,
            cluster=self.cluster,
        )
        self.other_face = create_test_face(photo=self.photo, person=self.other)
        self.other._calculate_face_count()

    def assert_unlinked(self) -> None:
        self.assertFalse(Person.objects.filter(pk=self.person.pk).exists())
        face = Face.objects.get(pk=self.face.pk)
        self.assertIsNone(face.person_id)
        self.assertIsNone(face.classification_person_id)
        self.assertIsNone(face.cluster_person_id)
        self.assertEqual(face.cluster_id, self.cluster.pk)
        self.assertIsNone(Cluster.objects.get(pk=self.cluster.pk).person_id)

    def assert_other_person_untouched(self) -> None:
        self.assertEqual(Face.objects.get(pk=self.other_face.pk).person, self.other)
        self.assertEqual(Person.objects.get(pk=self.other.pk).face_count, 1)

    def test_instance_delete_unlinks_faces_and_clusters(self) -> None:
        self.person.delete()

        self.assert_unlinked()
        self.assert_other_person_untouched()

    def test_queryset_delete_unlinks_faces_and_clusters(self) -> None:
        Person.objects.filter(pk=self.person.pk).delete()

        self.assert_unlinked()
        self.assert_other_person_untouched()

    def test_people_list_delete_unlinks_faces(self) -> None:
        response = self.client.delete(f"/api/persons/{self.person.pk}/")

        self.assertEqual(response.status_code, 204)
        self.assert_unlinked()
        self.assert_other_person_untouched()
        # The delta feed still hears about it.
        self.assertTrue(
            DeletionLog.objects.filter(
                entity=DeletionLog.ENTITY_PERSON,
                entity_id=str(self.person.pk),
                owner=self.user,
            ).exists()
        )

    def test_relabel_moves_every_face_and_keeps_the_emptied_person(self) -> None:
        response = self.client.post(
            "/api/labelfaces",
            {"face_ids": [self.face.pk], "person_name": "Bob"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)

        self.assertEqual(Person.objects.get(pk=self.person.pk).face_count, 0)
        self.assertEqual(
            set(Face.objects.filter(person=self.other).values_list("pk", flat=True)),
            {self.face.pk, self.other_face.pk},
        )
        self.assertEqual(Person.objects.get(pk=self.other.pk).face_count, 2)

    def test_clustering_reset_unlinks_the_cluster_people(self) -> None:
        cluster_person = create_test_person(
            name="Unknown 1", kind=Person.KIND_CLUSTER, cluster_owner=self.user
        )
        face = create_test_face(photo=self.photo, person=cluster_person)

        delete_clustered_people(self.user)

        self.assertIsNone(Face.objects.get(pk=face.pk).person_id)
        self.assert_other_person_untouched()
