from django.core.validators import MinLengthValidator
from django.db import models

from api.models.photo import Photo
from api.models.user import User


class Person(models.Model):
    UNKNOWN_PERSON_NAME = "Unknown - Other"
    KIND_USER = "USER"
    KIND_CLUSTER = "CLUSTER"
    KIND_UNKNOWN = "UNKNOWN"
    KIND_CHOICES = (
        (KIND_USER, "User Labelled"),
        (KIND_CLUSTER, "Cluster ID"),
        (KIND_UNKNOWN, "Unknown Person"),
    )
    name = models.CharField(
        blank=False, max_length=128, validators=[MinLengthValidator(1)], db_index=True
    )
    kind = models.CharField(choices=KIND_CHOICES, max_length=10)
    cover_photo = models.ForeignKey(
        Photo, related_name="person", on_delete=models.SET_NULL, blank=False, null=True
    )
    cover_face = models.ForeignKey(
        "Face",
        related_name="face",
        on_delete=models.SET_NULL,
        blank=False,
        null=True,
    )
    face_count = models.IntegerField(default=0)
    cluster_owner = models.ForeignKey(
        User,
        related_name="owner",
        on_delete=models.SET_NULL,
        default=None,
        null=True,
    )
    # Delta-sync ordering key (mobile v2, doc 04). Bumped on every save.
    last_modified = models.DateTimeField(auto_now=True, db_index=True)

    def __str__(self) -> str:
        return (
            self.name
            + " ("
            + self.kind
            + ")"
            + " ("
            + str(self.id)
            + ")"
            + " ("
            + str(self.cluster_owner)
            + ")"
        )

    def _calculate_face_count(self) -> None:
        # The count is scoped to the owner's photos, so there must be an owner.
        assert self.cluster_owner is not None
        self.face_count = self.faces.filter(
            deleted=False,
            photo__hidden=False,
            photo__in_trashcan=False,
            photo__owner=self.cluster_owner.id,
        ).count()
        self.save()

    def _set_default_cover_photo(self) -> None:
        # A deleted face keeps its person, but is no cover for it. Only a face
        # on the owner's own photos, as in _calculate_face_count: a face from
        # another user's photo would leak that photo's hash (#2047).
        first_face = self.faces.filter(
            deleted=False, photo__owner_id=self.cluster_owner_id
        ).first()
        if not self.cover_photo and first_face is not None:
            self.cover_photo = first_face.photo
            self.cover_face = first_face
            self.save()


def get_or_create_person(
    name: str, owner: User | None = None, kind: str = Person.KIND_UNKNOWN
) -> Person:
    return Person.objects.get_or_create(name=name, cluster_owner=owner, kind=kind)[0]
