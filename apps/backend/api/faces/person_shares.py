"""Sharing a person with other users (#668).

The owner shares a person they named with users of the server, who may only
look. Face recognition can be wrong, and one wrong match would hand someone
a photo that has nothing to do with the person, so a recipient sees a photo
only while:

* a live face on it is labelled with the person (an automatic suggestion or
  a cluster never counts), and
* the owner approved the photo for this person (``PersonSharePhoto``).

The photos labelled when the person is first shared are approved at once:
the owner shares what they labelled (``Person.first_shared_at`` makes that
happen once, never again on a later share). Every photo labelled later waits for
the owner's review (``pending_photos``, ``review``); a decision stays with
the photo, so a label taken off and set again needs none. Hidden, trashed
and removed photos are
never shown. What else the recipients see (where the photos were taken, the
names of the other people on them) is the person's ``share_location`` and
``share_other_people``.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable
from typing import Any
from uuid import UUID

from django.contrib.auth.models import AnonymousUser
from django.db import transaction
from django.db.models import Exists, F, OuterRef, QuerySet
from django.utils import timezone
from rest_framework.exceptions import NotFound, ValidationError

from api.models import Face, Person, PersonShare, PersonSharePhoto, Photo, User
from api.sharing.grants import LibraryGrant

logger = logging.getLogger(__name__)


def _account(viewer: User | AnonymousUser | None) -> User | None:
    if isinstance(viewer, User) and viewer.is_authenticated:
        return viewer
    return None


def owned_person(user: User, person_id: int) -> Person:
    """``user``'s named person ``person_id``; a 404 for anyone else's."""
    person = (
        Person.objects.owned_by(user)
        .filter(pk=person_id, kind=Person.KIND_USER)
        .first()
    )
    if person is None:
        raise NotFound("No such person")
    return person


def labelled_photos(person: Person) -> QuerySet[Photo]:
    """The owner's visible photos with a live face labelled ``person``."""
    faces = Face.objects.filter(person=person, deleted=False)
    return Photo.visible.filter(
        pk__in=faces.values("photo_id"),
        owner_id=person.cluster_owner_id,  # owner-scope: the person's owner
    )


def _decided(person: Person) -> QuerySet[PersonSharePhoto]:
    return PersonSharePhoto.objects.filter(person=person)


def approved_photos(person: Person) -> QuerySet[Photo]:
    """What the people ``person`` is shared with see."""
    approved = _decided(person).filter(status=PersonSharePhoto.APPROVED)
    return labelled_photos(person).filter(pk__in=approved.values("photo_id"))


def pending_photos(person: Person) -> QuerySet[Photo]:
    """Labelled photos the owner has not decided on yet, newest first."""
    return (
        labelled_photos(person)
        .exclude(pk__in=_decided(person).values("photo_id"))
        .order_by("-exif_timestamp", "pk")
    )


def _approve_all_labelled(person: Person) -> None:
    rows = [
        PersonSharePhoto(person=person, photo_id=pk, status=PersonSharePhoto.APPROVED)
        for pk in pending_photos(person).values_list("pk", flat=True)
    ]
    PersonSharePhoto.objects.bulk_create(rows, ignore_conflicts=True)


@transaction.atomic
def set_recipients(
    person: Person, recipient_ids: Iterable[int], settings: dict[str, Any]
) -> None:
    """Share ``person`` with exactly ``recipient_ids``, with ``settings``.

    Sharing a person nobody had it before approves the photos labelled
    with it now. Users who no longer get it lose it at once.
    """
    owner_id = person.cluster_owner_id
    wanted = set(recipient_ids)
    if owner_id in wanted:
        raise ValidationError({"recipient_ids": "You cannot share with yourself"})
    found = set(User.objects.filter(pk__in=wanted).values_list("pk", flat=True))
    if found != wanted:
        raise ValidationError({"recipient_ids": "No such user"})
    shares = PersonShare.objects.filter(person=person)
    if wanted and person.first_shared_at is None:
        # Only the very first share approves what is labelled: later photos
        # wait for review even after unsharing and sharing again.
        _approve_all_labelled(person)
        person.first_shared_at = timezone.now()
    shares.exclude(recipient_id__in=wanted).delete()
    present = set(shares.values_list("recipient_id", flat=True))
    PersonShare.objects.bulk_create(
        [PersonShare(person=person, recipient_id=pk) for pk in wanted - present]
    )
    for name in ("share_location", "share_other_people"):
        if name in settings:
            setattr(person, name, bool(settings[name]))
    person.save(
        update_fields=["share_location", "share_other_people", "first_shared_at"]
    )
    logger.info("Person %s shared with %s users", person.pk, len(wanted))


def review(person: Person, approve: Iterable[UUID], decline: Iterable[UUID]) -> None:
    """The owner's decision on photos of ``person``; only labelled ones count."""
    labelled = set(labelled_photos(person).values_list("pk", flat=True))
    for status, ids in (
        (PersonSharePhoto.APPROVED, approve),
        (PersonSharePhoto.DECLINED, decline),
    ):
        for photo_id in set(ids) & labelled:
            PersonSharePhoto.objects.update_or_create(
                person=person, photo_id=photo_id, defaults={"status": status}
            )


def persons_shared_with(viewer: User | AnonymousUser | None) -> QuerySet[Person]:
    """The named people someone else shared with ``viewer``."""
    account = _account(viewer)
    if account is None:
        return Person.objects.none()
    return Person.objects.filter(
        kind=Person.KIND_USER, shares__recipient=account
    ).exclude(Person.objects.owner_q(account))


def _approved_link(person_ref: str, photo_ref: str) -> Exists:
    return Exists(
        PersonSharePhoto.objects.filter(
            person_id=OuterRef(person_ref),
            photo_id=OuterRef(photo_ref),
            status=PersonSharePhoto.APPROVED,
        )
    )


def shared_person_faces(viewer: User | AnonymousUser | None) -> QuerySet[Face]:
    """The live faces of people shared with ``viewer`` on photos they see."""
    return (
        Face.objects.filter(
            deleted=False,
            person__in=persons_shared_with(viewer),
            photo__in=Photo.visible.all(),
        )
        .filter(
            # owner-scope: the person must be the photo owner's, not a scope to a user
            person__cluster_owner=F("photo__owner")
        )
        .filter(_approved_link("person_id", "photo_id"))
    )


def photos_seen_through_people(viewer: User | AnonymousUser | None) -> QuerySet[Photo]:
    """Every photo ``viewer`` sees because a person on it is shared with them."""
    return Photo.objects.filter(pk__in=shared_person_faces(viewer).values("photo_id"))


def person_grants(
    viewer: User | AnonymousUser | None, photo_ids: Iterable[object]
) -> dict[object, LibraryGrant]:
    """Photo id -> what ``viewer`` sees of it through shared people; one query.

    Photos no shared person shows are missing from the answer.
    """
    rows = (
        shared_person_faces(viewer)
        .filter(photo_id__in=list(photo_ids))
        .values_list("photo_id", "person__share_location", "person__share_other_people")
    )
    grants: dict[object, LibraryGrant] = {}
    for photo_id, location, others in rows:
        seen = grants.get(photo_id, LibraryGrant())
        grants[photo_id] = LibraryGrant(
            location=seen.location or location,
            people=seen.people or others,
        )
    return grants
