from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from django.core.exceptions import MultipleObjectsReturned
from django.db import models

from api.models.person import Person
from api.models.user import User, get_deleted_user
from api.lazy_import import LazyModule

if TYPE_CHECKING:
    import numpy.typing as npt
    from numpy import float64

if TYPE_CHECKING:
    import numpy as np
else:
    np = LazyModule("numpy")

logger = logging.getLogger(__name__)

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

    def __str__(self) -> str:
        return "%d" % self.id

    def get_mean_encoding_array(self) -> npt.NDArray[float64]:
        return np.frombuffer(bytes.fromhex(self.mean_face_encoding))

    def set_metadata(self, all_vectors: npt.ArrayLike) -> None:
        self.mean_face_encoding = (
            Cluster.calculate_mean_face_encoding(all_vectors).tobytes().hex()
        )

    @staticmethod
    def get_or_create_cluster_by_name(user: User, name: str) -> Cluster:
        return Cluster.objects.get_or_create(owner=user, name=name)[0]

    @staticmethod
    def get_or_create_cluster_by_id(user: User, cluster_id: int) -> Cluster:
        try:
            return Cluster.objects.get_or_create(owner=user, cluster_id=cluster_id)[0]
        except MultipleObjectsReturned:
            logger.error(
                "Multiple clusters found with id %d. Choosing first one", cluster_id
            )
            cluster = Cluster.objects.filter(owner=user, cluster_id=cluster_id).first()
            # MultipleObjectsReturned just showed rows for this id and owner.
            assert cluster is not None
            return cluster

    @staticmethod
    def calculate_mean_face_encoding(
        all_encodings: npt.ArrayLike,
    ) -> npt.NDArray[float64]:
        return np.asarray(all_encodings, dtype=np.float64).mean(axis=0)


def get_unknown_cluster(user: User) -> Cluster:
    unknown_cluster: Cluster = Cluster.get_or_create_cluster_by_id(
        user, UNKNOWN_CLUSTER_ID
    )
    if unknown_cluster.person is not None:
        unknown_cluster.person = None
        unknown_cluster.name = UNKNOWN_CLUSTER_NAME
        unknown_cluster.save()
    return unknown_cluster
