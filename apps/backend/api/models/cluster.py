import numpy as np
from django.db import models

from api.models.person import Person, get_unknown_person
from api.models.user import User, get_deleted_user

UNKNOWN_CLUSTER_ID = -1
UNKNOWN_CLUSTER_NAME = "Other Unknown Cluster"


class Cluster(models.Model):
    person = models.ForeignKey(
        Person,
        on_delete=models.SET(get_unknown_person),
        related_name="clusters",
        blank=True,
        null=True,
    )
    mean_face_encoding = models.TextField()
    cluster_id = models.IntegerField(null=True)
    name = models.TextField(null=True)

    owner = models.ForeignKey(
        User, on_delete=models.SET(get_deleted_user), default=None, null=True
    )

    def __str__(self):
        return "%d" % self.id

    def get_mean_encoding_array(self) -> np.ndarray:
        return np.frombuffer(bytes.fromhex(self.mean_face_encoding))

    def set_metadata(self, all_vectors):
        self.mean_face_encoding = (
            Cluster.calculate_mean_face_encoding(all_vectors).tobytes().hex()
        )

    @staticmethod
    def get_or_create_cluster_by_name(user: User, name):
        return Cluster.objects.get_or_create(owner=user, name=name)[0]

    @staticmethod
    def get_or_create_cluster_by_id(user: User, cluster_id: int):
        return Cluster.objects.get_or_create(owner=user, cluster_id=cluster_id)[0]

    @staticmethod
    def calculate_mean_face_encoding(all_encodings):
        return np.mean(a=all_encodings, axis=0, dtype=np.float64)


def get_unknown_cluster() -> Cluster:
    unknown_cluster: Cluster = Cluster.get_or_create_cluster_by_id(
        get_deleted_user(), UNKNOWN_CLUSTER_ID
    )
    unknown_person: Person = get_unknown_person()
    if unknown_cluster.person is not unknown_person:
        unknown_cluster.person = unknown_person
        unknown_cluster.name = UNKNOWN_CLUSTER_NAME
        unknown_cluster.save()
    return unknown_cluster
