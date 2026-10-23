"""Which people someone who is not a photo's owner sees on it (#2722).

A photo's owner sees every face on it: named people, clusters and
suggestions. Anyone else only ever sees the people the owner named
(``Person.KIND_USER``), never a cluster ("Unknown 012"), an "Unknown - Other"
face or a suggestion, and only when the owner allows it:

* someone the owner shares their whole library with (#2731): when that
  share's ``share_faces`` is on, for every photo of the owner;
* someone the photo is shared with (directly or in a user album): when the
  owner turned on ``User.share_people_names``;
* a public photo's visitor: when the owner's public link defaults share
  faces (``public_sharing_defaults["share_faces"]``), as on a photo link.

Every serializer that hands a photo's people to a viewer goes through
``faces_shown_to``; the "Shared with you" people list goes through
``shared_named_faces``.
"""

from __future__ import annotations

from typing import Any, TypedDict

from django.contrib.auth.models import AnonymousUser
from django.db.models import Count, F, Min, Q, QuerySet

from api.faces.person_shares import shared_person_faces
from api.models import Face, Person, Photo, User
from api.sharing.grants import library_grant, without_switch


def is_named(face: Face) -> bool:
    """Whether ``face`` is a live face of a person its owner named."""
    person = face.person
    return not face.deleted and person is not None and person.kind == Person.KIND_USER


def _owner_shares_with_recipients(photo: Photo, viewer: User) -> bool:
    return (
        photo.owner.share_people_names
        and Photo.objects.shared_with_me(viewer, "faces").filter(pk=photo.pk).exists()
    )


def _owner_shares_publicly(photo: Photo) -> bool:
    defaults = photo.owner.public_sharing_defaults or {}
    return photo.public and bool(defaults.get("share_faces", False))


def people_shown_to(photo: Photo, viewer: User | AnonymousUser | None) -> bool:
    """Whether a viewer who is not the owner sees the named people on ``photo``.

    When the owner shares their library with the viewer (#2731), that share's
    "People names" switch decides, for every photo of the owner.
    """
    grant = library_grant(viewer, photo.owner_id)
    if grant is not None:
        return grant.people
    if _owner_shares_publicly(photo):
        return True
    if isinstance(viewer, User) and viewer.is_authenticated:
        return _owner_shares_with_recipients(photo, viewer)
    return False


def faces_shown_to(photo: Photo, viewer: User | AnonymousUser | None) -> list[Face]:
    """The faces of ``photo`` whose people ``viewer`` sees, in id order.

    Reads ``photo.faces.all()``, so a prefetch of the faces with their people
    keeps it to the one or two queries ``people_shown_to`` asks.
    """
    faces = [face for face in photo.faces.all() if not face.deleted]
    if viewer is not None and viewer == photo.owner:
        return faces
    if not people_shown_to(photo, viewer):
        return []
    return [face for face in faces if is_named(face)]


def shared_named_faces(user: User | None) -> QuerySet[Face]:
    """The faces of named people on the photos shared with ``user``.

    Only photos whose owner shares people's names, only live faces of a
    person that owner named, on a photo the lists show.
    """
    shared = (
        Photo.visible.shared_with_me(user, "faces")
        .filter(owner__share_people_names=True)
        # A library share with the names switch off wins (#2731).
        .exclude(
            owner__in=without_switch(user, "share_faces")  # owner-scope: sharers
        )
    )
    on_shared_photos = Face.objects.filter(
        photo__in=shared, deleted=False, person__kind=Person.KIND_USER
    ).filter(
        # owner-scope: the person must be the photo owner's, not a scope to a user
        person__cluster_owner=F("photo__owner")
    )
    # And the people shared with ``user`` (#668), on their approved photos.
    return Face.objects.filter(
        Q(pk__in=on_shared_photos.values("pk"))
        | Q(pk__in=shared_person_faces(user).values("pk"))
    )


class SharedPersonRow(TypedDict):
    """A row of ``shared_people``."""

    person_id: int
    name: str
    photo_count: int
    face_id: int | None


class SharedPerson(TypedDict):
    """A row of the "Shared with you" people list."""

    id: int
    name: str
    owner: User | None
    photo_count: int
    face_url: str | None


def shared_people(user: User | None) -> QuerySet[Any, SharedPersonRow]:
    """One row per named person on the photos shared with ``user``.

    ``photo_count`` counts those photos only, and ``face_id`` is a face with a
    crop on one of them: never the person's cover or face count, which come
    from the owner's whole library. Ordered by name, then id.
    """
    has_crop = Q(image__isnull=False) & ~Q(image="")
    return (
        shared_named_faces(user)
        .values("person_id", name=F("person__name"))
        .annotate(
            photo_count=Count("photo", distinct=True),
            face_id=Min("id", filter=has_crop),
        )
        .order_by("name", "person_id")
    )


def shared_person_entries(rows: list[SharedPersonRow]) -> list[SharedPerson]:
    """The page ``rows`` of ``shared_people`` with their owners and crops.

    Two queries for the whole page, however many rows it has.
    """
    people = Person.objects.select_related("cluster_owner").in_bulk(
        [row["person_id"] for row in rows]
    )
    faces = Face.objects.only("id", "image").in_bulk(
        [row["face_id"] for row in rows if row["face_id"] is not None]
    )
    entries: list[SharedPerson] = []
    for row in rows:
        face = faces.get(row["face_id"]) if row["face_id"] is not None else None
        entries.append(
            {
                "id": row["person_id"],
                "name": row["name"],
                "owner": people[row["person_id"]].cluster_owner,
                "photo_count": row["photo_count"],
                "face_url": face.crop_url if face is not None else None,
            }
        )
    return entries


def shared_person_photos(user: User, person_id: int) -> QuerySet[Photo]:
    """The photos shared with ``user`` that show the named ``person_id``."""
    faces = shared_named_faces(user).filter(person_id=person_id)
    return Photo.objects.filter(pk__in=faces.values("photo_id")).order_by(
        "-exif_timestamp", "pk"
    )
