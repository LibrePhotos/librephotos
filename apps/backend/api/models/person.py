from __future__ import annotations

from collections.abc import Collection
from typing import TYPE_CHECKING

from django.core.validators import MinLengthValidator
from django.db import models
from django.db.models import Count, F, Q, QuerySet
from django.utils import timezone

from api.models.person_group import PersonGroup
from api.models.photo import Photo, visible_photo_q
from api.models.scopes import OwnedQuerySet
from api.models.user import User

if TYPE_CHECKING:
    from typing import Self


class PersonQuerySet(OwnedQuerySet["Person"]):
    """A person belongs to the user whose faces it groups."""

    owner_lookup = "cluster_owner"

    def in_group(self, user: User, group_id: int) -> Self:
        """The people in ``user``'s group ``group_id`` (#1126).

        Through the requester's own groups: another user's group id, or one
        that does not exist, matches nobody.
        """
        return self.filter(
            groups__in=PersonGroup.objects.owned_by(user).filter(pk=group_id)
        )


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
    # The owner's groups this person is in (#1126); a deleted group keeps them.
    groups = models.ManyToManyField(PersonGroup, related_name="persons", blank=True)
    # Optional, and personal data: only the owner's person endpoints carry it
    # (PersonSerializer), never a photo's people or a shared or public payload.
    # The person page shows ages from it (#2751); face training suggests nobody
    # for a face on a photo taken before it (#2752).
    birth_date = models.DateField(null=True, blank=True)
    # What the users this person is shared with (#668) see of its photos,
    # besides the photos and their dates: where they were taken, and the
    # names of the other people on them. Off until the owner turns them on.
    share_location = models.BooleanField(default=False)
    share_other_people = models.BooleanField(default=False)
    # When the person was first shared (#668): the photos labelled by then
    # were approved at once; every later one waits for review, also after
    # the person was unshared and shared again.
    first_shared_at = models.DateTimeField(null=True, blank=True)
    # Delta-sync ordering key (mobile v2, doc 04). Bumped on every save.
    last_modified = models.DateTimeField(auto_now=True, db_index=True)

    objects = PersonQuerySet.as_manager()

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
            counted_face_q(), photo__owner=self.cluster_owner.id
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


def counted_face_q(through: str = "") -> Q:
    """The faces ``Person.face_count`` counts, as a ``Q``: not deleted, on a
    photo the lists show (``visible_photo_q``, as the faces views count).

    ``through`` reaches the faces through a relation (``"faces__"``).
    """
    return Q(**{f"{through}deleted": False}) & visible_photo_q(f"{through}photo__")


def person_ids_for_photos(photos: QuerySet[Photo]) -> list[int]:
    """The ids of the people with a face on one of ``photos``."""
    return list(
        Person.objects.filter(faces__photo__in=photos)
        .values_list("pk", flat=True)
        .distinct()
    )


def refresh_person_face_counts(person_ids: Collection[int]) -> int:
    """Recompute ``face_count`` for ``person_ids`` (``_calculate_face_count``).

    Hiding, trashing or restoring a photo is a queryset UPDATE, which leaves
    the stored count of the people on it behind. ``last_modified`` is set by
    hand, so the delta-sync feed carries the new count. Returns the number
    of people whose count changed.
    """
    counted = counted_face_q("faces__") & Q(
        faces__photo__owner=F("cluster_owner")  # owner-scope: the person's own photos
    )
    people = Person.objects.filter(pk__in=person_ids).annotate(
        counted=Count("faces", filter=counted)
    )
    now = timezone.now()
    changed = []
    for person in people:
        counted_faces = getattr(person, "counted")
        if person.face_count != counted_faces:
            person.face_count = counted_faces
            person.last_modified = now
            changed.append(person)
    Person.objects.bulk_update(changed, ["face_count", "last_modified"])
    return len(changed)


def get_or_create_person(
    name: str, owner: User | None = None, kind: str = Person.KIND_UNKNOWN
) -> Person:
    return Person.objects.get_or_create(name=name, cluster_owner=owner, kind=kind)[0]
