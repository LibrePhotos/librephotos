from __future__ import annotations

import logging
import os
from datetime import datetime
from functools import partial
from typing import TYPE_CHECKING, Any

from django.db import models, transaction
from django.db.models.signals import post_delete

from api.face_recognition import get_face_encodings
from api.lazy_import import LazyModule
from api.models.cluster import Cluster
from api.models.person import Person
from api.models.photo import Photo

if TYPE_CHECKING:
    import numpy.typing as npt
    from numpy import float64

if TYPE_CHECKING:
    import numpy as np
else:
    np = LazyModule("numpy")

logger = logging.getLogger(__name__)


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

    @property
    def timestamp(self) -> datetime | None:
        return self.photo.exif_timestamp if self.photo else None

    def __str__(self) -> str:
        return str(self.id)

    def generate_encoding(self) -> None:
        photo = self.photo
        assert photo is not None
        encodings = get_face_encodings(
            photo.thumbnail.thumbnail_big.path,
            [
                (
                    self.location_top,
                    self.location_right,
                    self.location_bottom,
                    self.location_left,
                )
            ],
        )
        if not encodings:
            raise ValueError(f"Face service returned no encoding for face {self.id}")
        if encodings[0] is None:
            # Another face's embedding would file this one under a stranger,
            # so the face keeps no encoding and stays out of clustering.
            raise ValueError(f"The face service detected no face in face {self.id}")
        self.encoding = encodings[0].tobytes().hex()
        self.save()

    def get_encoding_array(self) -> npt.NDArray[float64]:
        return np.frombuffer(bytes.fromhex(self.encoding))


def _remove_face_crop(face_id: int, path: str) -> None:
    try:
        if os.path.isfile(path):
            os.remove(path)
    except OSError:
        # The face row is gone either way; a crop left behind is only disk.
        logger.warning("Could not remove the crop of deleted face %s", face_id)


def delete_face_crop_file(
    sender: type[Face], instance: Face, using: str, **kwargs: Any
) -> None:
    """Remove a deleted face's crop file once the delete commits.

    Deferred to on_commit, as the thumbnail files are, so a rolled-back delete
    keeps the crop its restored row points at.
    """
    if instance.image:
        transaction.on_commit(
            partial(_remove_face_crop, instance.pk, instance.image.path), using=using
        )


def register() -> None:
    post_delete.connect(
        delete_face_crop_file,
        sender=Face,
        dispatch_uid="api.models.face.delete_face_crop_file",
    )
