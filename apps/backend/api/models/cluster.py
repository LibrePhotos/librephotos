import numpy as np
from django.core.exceptions import MultipleObjectsReturned
from django.db import models

from api.models.person import Person
from api.models.user import User, get_deleted_user
from api.util import logger

UNKNOWN_CLUSTER_ID = -1
UNKNOWN_CLUSTER_NAME = "Other Unknown Cluster"


class Cluster(models.Model):
    person = models.ForeignKey(
        Person,
        on_delete=models.SET_NULL,
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
        try:
            return Cluster.objects.get_or_create(owner=user, cluster_id=cluster_id)[0]
        except MultipleObjectsReturned:
            logger.error(
                "Multiple clusters found with id %d. Choosing first one" % cluster_id
            )
            return Cluster.objects.filter(owner=user, cluster_id=cluster_id).first()

    @staticmethod
    def calculate_mean_face_encoding(all_encodings):
        return np.mean(a=all_encodings, axis=0, dtype=np.float64)


def get_unknown_cluster(user: User) -> Cluster:
    unknown_cluster: Cluster = Cluster.get_or_create_cluster_by_id(
        user, UNKNOWN_CLUSTER_ID
    )
    if unknown_cluster.person is not None:
        unknown_cluster.person = None
        unknown_cluster.name = UNKNOWN_CLUSTER_NAME
        unknown_cluster.save()
    return unknown_cluster
