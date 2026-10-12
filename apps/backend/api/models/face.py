from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from django.db import models

from api.lazy_import import LazyModule
from api.models.cluster import Cluster
from api.models.person import Person
from api.models.photo import Photo
from api.models.scopes import OwnedQuerySet

if TYPE_CHECKING:
    import numpy.typing as npt
    from numpy import float64

if TYPE_CHECKING:
    import numpy as np
else:
    np = LazyModule("numpy")


class FaceQuerySet(OwnedQuerySet["Face"]):
    """A face has no owner column: it belongs to its photo's owner."""

    owner_lookup = "photo__owner"


class Face(models.Model):
    photo = models.ForeignKey(
        Photo, related_name="faces", on_delete=models.CASCADE, blank=False, null=True
    )
    image = models.ImageField(upload_to="faces", null=True)

    person = models.ForeignKey(
        Person, on_delete=models.SET_NULL, related_name="faces", null=True
    )

    classification_person = models.ForeignKey(
        Person,
        related_name="classification_faces",
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
    )
    classification_probability = models.FloatField(default=0.0, db_index=True)

    cluster_person = models.ForeignKey(
        Person,
        related_name="cluster_faces",
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
    )
    cluster_probability = models.FloatField(default=0.0, db_index=True)

    deleted = models.BooleanField(default=False)

    cluster = models.ForeignKey(
        Cluster,
        related_name="faces",
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
    )

    location_top = models.IntegerField()
    location_bottom = models.IntegerField()
    location_left = models.IntegerField()
    location_right = models.IntegerField()
    encoding = models.TextField()

    objects = FaceQuerySet.as_manager()

    @property
    def timestamp(self) -> datetime | None:
        return self.photo.exif_timestamp if self.photo else None

    def __str__(self) -> str:
        return str(self.id)

    def get_encoding_array(self) -> npt.NDArray[float64]:
        return np.frombuffer(bytes.fromhex(self.encoding))
