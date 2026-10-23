from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from django.db import models
from django.db.models import Q

from api.lazy_import import LazyModule
from api.models.cluster import Cluster, unit_length
from api.models.person import Person
from api.models.photo import Photo, visible_photo_q
from api.models.scopes import OwnedQuerySet

if TYPE_CHECKING:
    from typing import Self

    import numpy.typing as npt
    from numpy import float64

if TYPE_CHECKING:
    import numpy as np
else:
    np = LazyModule("numpy")


def face_photo_shown_q(through: str = "") -> Q:
    """Faces whose photo the photo lists show (``visible_photo_q``), as a ``Q``.

    A face on a hidden, trashed or removed photo is left out, as it is from
    ``Person.face_count``; an archived photo's faces stay. The condition is
    evaluated per query, so restoring a photo brings its faces back.
    ``through`` is the path from the queried model to the face, e.g.
    ``"faces__"`` for a per-person count.
    """
    return visible_photo_q(f"{through}photo__")


class FaceQuerySet(OwnedQuerySet["Face"]):
    """A face has no owner column: it belongs to its photo's owner."""

    owner_lookup = "photo__owner"

    def on_shown_photos(self) -> Self:
        """The faces of photos the photo lists show (``face_photo_shown_q``)."""
        return self.filter(face_photo_shown_q())

    def for_recognition(self) -> Self:
        """The faces clustering and training learn from and predict.

        Not deleted (a deleted crop is often no face at all), with an
        encoding, and on a photo the lists show. Ordered by id, so a run sees
        the faces in the same order every time.
        """
        return (
            self.on_shown_photos()
            .filter(deleted=False, encoding__isnull=False)
            .exclude(encoding="")
            .order_by("id")
        )


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

    # The people the user said this face is not ("Not Anna", #2747): training
    # never suggests them for it again. Labelling the face as one of them by
    # hand takes that person off the list; deleting a person drops its rows.
    rejected_persons = models.ManyToManyField(
        Person, related_name="rejected_faces", blank=True
    )

    deleted = models.BooleanField(default=False)

    cluster = models.ForeignKey(
        Cluster,
        related_name="faces",
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
    )

    # The box in pixels of the big thumbnail, or of the video frame at
    # ``video_time`` for a face found in a video's later frames.
    location_top = models.IntegerField()
    location_bottom = models.IntegerField()
    location_left = models.IntegerField()
    location_right = models.IntegerField()
    encoding = models.TextField()

    # The second of the video the face was found at (#2761); None for a
    # photo's faces and a video's faces on its first frame (the big thumbnail).
    # That frame is not kept, so such a face's crop and encoding cannot be
    # made again from the big thumbnail: the scan saves both.
    video_time = models.FloatField(null=True, blank=True)

    objects = FaceQuerySet.as_manager()

    @property
    def timestamp(self) -> datetime | None:
        return self.photo.exif_timestamp if self.photo else None

    @property
    def crop_url(self) -> str | None:
        """The URL of the face's crop, or None when it has none.

        ``image`` is nullable: legacy rows and a crop that failed to save have no
        file name, and ``image.url`` raises ValueError on such a field.
        """
        return self.image.url if self.image else None

    def __str__(self) -> str:
        return str(self.id)

    def get_encoding_array(self) -> npt.NDArray[float64]:
        """The stored encoding at unit length (see ``unit_length``)."""
        return unit_length(np.frombuffer(bytes.fromhex(self.encoding)))
