"""The public gallery (#434): the public photos of every user who takes part.

The admin's ``PUBLIC_GALLERY`` site setting opens it to nobody (``off``, the
default), to signed-in users (``members``) or to everyone (``everyone``); the
server's address then opens it for visitors without an account. A user takes
part only after turning on ``User.in_public_gallery``; their public photos keep
working on their own links either way.

Built on the public pages' rule (``api.sharing.grants.public_grant``): each
photo is shown as its owner's public sharing switches allow, owner by owner,
with these limits on top for a page that mixes owners:

* only public photos that the public view shows (not hidden, trashed, removed
  or archived, the primary photo of a stack);
* dates only of owners who share them: the others' photos are one undated
  group, in an order that says nothing about when they were taken (by id),
  never in a day;
* places only as town names, only of owners who share locations, and never a
  photo's coordinates or address on a list (the photo itself still shows what
  its owner shares);
* people only the named people of owners who share people's names, one entry
  per owner and person: two owners' "Mia" stay two;
* filters by a place or a person only reach the owners who share those.

Everything here takes the owners from ``GalleryOwners.load``: one query for
every owner's switches, so a page costs the same number of queries for two
owners as for two hundred.
"""

from __future__ import annotations

import datetime
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from functools import cached_property
from typing import Any, Final, Literal, TypedDict

from constance import config as site_config
from django.db.models import Count, Exists, F, Min, OuterRef, Q, QuerySet, Window
from django.db.models.functions import RowNumber, TruncDate

from api.models import Face, Person, Photo, PhotoStack, User
from api.models.user import public_sharing_settings
from api.sharing.grants import (
    NEVER,
    SUMMARY_FIELDS,
    FieldRules,
    LibraryGrant,
    Switch,
    public_grant,
)

GalleryStage = Literal["off", "members", "everyone"]
_STAGES: Final[dict[str, GalleryStage]] = {
    "off": "off",
    "members": "members",
    "everyone": "everyone",
}

# The id of the undated group in the day list. A day's id is its date as
# YYYYMMDD, so no day has it.
UNDATED_DAY_ID: Final = 1
# Cover photos per place or photographer, as on the place lists.
COVERS_PER_ROW: Final = 4

# A photo on a list of the gallery: what its owner shares on public pages,
# but never its coordinates or address. A list mixes owners and is browsed
# by place, so it gives places only as town names (``place_rows``).
GALLERY_SUMMARY_FIELDS: FieldRules = {
    **SUMMARY_FIELDS,
    "location": (NEVER, ""),
    "exif_gps_lat": (NEVER, None),
    "exif_gps_lon": (NEVER, None),
}


def gallery_stage() -> GalleryStage:
    """Who the gallery is open to; a value this version does not know is off."""
    return _STAGES.get(str(site_config.PUBLIC_GALLERY), "off")


def gallery_indexable() -> bool:
    """Whether search engines may index the gallery (``noindex`` otherwise)."""
    return site_config.PUBLIC_GALLERY_INDEXABLE is True


def gallery_open_to(viewer: object) -> bool:
    """Whether ``viewer`` (a request's user) may open the gallery."""
    stage = gallery_stage()
    if stage == "everyone":
        return True
    signed_in = isinstance(viewer, User) and viewer.is_authenticated
    return stage == "members" and signed_in


@dataclass(frozen=True)
class GalleryOwners:
    """The users who take part, each with their public sharing switches."""

    grants: Mapping[int, LibraryGrant]

    @classmethod
    def load(cls, owner_id: int | None = None) -> GalleryOwners:
        """Every active user who takes part (only ``owner_id``, when given)."""
        users = User.objects.filter(in_public_gallery=True, is_active=True)
        if owner_id is not None:
            users = users.filter(pk=owner_id)
        users = users.only("id", "public_sharing_defaults")
        return cls(
            {user.pk: public_grant(public_sharing_settings(user)) for user in users}
        )

    def ids(self, switch: Switch | None = None) -> list[int]:
        """The owners, or those whose ``switch`` is on."""
        return [
            owner_id
            for owner_id, grant in self.grants.items()
            if switch is None or grant.allows(switch)
        ]


def gallery_photos(owner_ids: Iterable[int]) -> QuerySet[Photo]:
    """The photos of ``owner_ids`` the gallery shows."""
    in_no_stack = ~Exists(Photo.stacks.through.objects.filter(photo_id=OuterRef("pk")))
    is_primary = Exists(PhotoStack.objects.filter(primary_photo_id=OuterRef("pk")))
    return Photo.visible.filter(
        public=True,
        archived=False,
        owner_id__in=list(owner_ids),  # owner-scope: users who opted in
    ).filter(in_no_stack | is_primary)


def named_faces(photos: QuerySet[Photo]) -> QuerySet[Face]:
    """The live faces on ``photos`` of people their owners named."""
    return Face.objects.filter(
        photo__in=photos, deleted=False, person__kind=Person.KIND_USER
    ).filter(
        # owner-scope: the person must be the photo owner's, not a scope to a user
        person__cluster_owner=F("photo__owner")
    )


def _day() -> TruncDate:
    """The day a photo was taken: its wall-clock date (stored as UTC)."""
    return TruncDate("exif_timestamp", tzinfo=datetime.UTC)


def day_id(day: datetime.date) -> int:
    """The id of ``day`` in the day list: YYYYMMDD."""
    return day.year * 10000 + day.month * 100 + day.day


def day_of(day_id: int) -> datetime.date | None:
    """The day of a day list id, or None for one that names no day."""
    try:
        return datetime.date(day_id // 10000, day_id // 100 % 100, day_id % 100)
    except ValueError, OverflowError:
        return None


class GalleryDayRow(TypedDict):
    id: int
    date: str | None
    location: str
    photo_count: int


class GalleryCover(TypedDict):
    image_hash: str
    video: bool


class GalleryPlaceRow(TypedDict):
    name: str
    photo_count: int
    owner_ids: list[int]
    cover_photos: list[GalleryCover]


class GalleryPersonRow(TypedDict):
    person_id: int
    name: str
    owner_id: int
    photo_count: int
    face_id: int | None


class GalleryPhotographerRow(TypedDict):
    owner_id: int
    photo_count: int


def _add_cover(covers: list[GalleryCover], image_hash: str, video: bool) -> None:
    if len(covers) < COVERS_PER_ROW:
        covers.append({"image_hash": image_hash, "video": video})


class GalleryQuery:
    """The gallery's photos under a visitor's filters: one owner, a town, a
    named person. A filter by a town or a person reaches only the owners who
    share places or people."""

    def __init__(
        self, owners: GalleryOwners, place: str = "", person: int | None = None
    ) -> None:
        self.owners = owners
        self.place = place
        self.person = person

    def _owner_ids(self) -> list[int]:
        ids = set(self.owners.ids())
        if self.place:
            ids &= set(self.owners.ids("location"))
        if self.person is not None:
            ids &= set(self.owners.ids("people"))
        return sorted(ids)

    @cached_property
    def photos(self) -> QuerySet[Photo]:
        """The photos matching every filter."""
        photos = gallery_photos(self._owner_ids())
        if self.place:
            photos = photos.filter(town=self.place)
        if self.person is not None:
            faces = named_faces(photos).filter(person_id=self.person)
            photos = photos.filter(pk__in=faces.values("photo_id"))
        return photos

    def dated(self) -> QuerySet[Photo]:
        """The photos in days: of owners who share dates, with a date."""
        return self.photos.filter(
            owner_id__in=self.owners.ids("timestamps"),  # owner-scope: taking part
            exif_timestamp__isnull=False,
        )

    def undated(self) -> QuerySet[Photo]:
        """The photos of the undated group, in an order that tells nothing."""
        return self.photos.exclude(pk__in=self.dated().values("pk")).order_by("pk")

    def day_rows(self) -> list[GalleryDayRow]:
        """The days, newest first, then the undated group (when not empty)."""
        counts: dict[datetime.date, int] = {}
        owners_of_day: dict[datetime.date, set[int]] = {}
        rows = (
            self.dated()
            .annotate(day=_day())
            .values_list("day", "owner_id")
            .annotate(photo_count=Count("pk"))
            .order_by("-day", "owner_id")
        )
        for day, owner_id, photo_count in rows:
            counts[day] = counts.get(day, 0) + photo_count
            owners_of_day.setdefault(day, set()).add(owner_id)
        places = self._day_places(owners_of_day)
        days: list[GalleryDayRow] = [
            {
                "id": day_id(day),
                "date": day.isoformat(),
                "location": places.get(day, ""),
                "photo_count": photo_count,
            }
            for day, photo_count in counts.items()
        ]
        undated = self.undated().count()
        if undated:
            days.append(
                {
                    "id": UNDATED_DAY_ID,
                    "date": None,
                    "location": "",
                    "photo_count": undated,
                }
            )
        return days

    def _day_places(
        self, owners_of_day: Mapping[datetime.date, set[int]]
    ) -> dict[datetime.date, str]:
        """The town of each day whose photos all come from owners who share
        places: a day that mixes in another owner's photos names none, which
        would tell where those were taken too."""
        located = set(self.owners.ids("location"))
        days = [day for day, owners in owners_of_day.items() if owners <= located]
        if not days:
            return {}
        # The town of each day's first photo that has one.
        rank = Window(
            RowNumber(),
            partition_by=[_day()],
            order_by=[F("exif_timestamp").asc(), "pk"],
        )
        rows = (
            self.dated()
            .exclude(town="")
            .annotate(day=_day(), rank=rank)
            .filter(day__in=days, rank=1)
            .values_list("day", "town")
        )
        return dict(rows)

    def day_photos(self, day_id: int) -> QuerySet[Photo] | None:
        """The photos of a day of the day list; None for an id that names none."""
        if day_id == UNDATED_DAY_ID:
            return self.undated()
        day = day_of(day_id)
        if day is None:
            return None
        return (
            self.dated()
            .annotate(day=_day())
            .filter(day=day)
            .order_by("-exif_timestamp", "pk")
        )


class GalleryTownRow(TypedDict):
    town: str
    photo_count: int


def _located_photos(owners: GalleryOwners) -> QuerySet[Photo]:
    """The gallery photos of owners who share places, with a town."""
    return gallery_photos(owners.ids("location")).exclude(town="")


def place_rows(owners: GalleryOwners) -> QuerySet[Any, GalleryTownRow]:
    """One row per town of the photos of owners who share places, most photos
    first. One entry per town name, owners merged: a town is not a person."""
    return (
        _located_photos(owners)
        .values("town")
        .annotate(photo_count=Count("pk"))
        .order_by("-photo_count", "town")
    )


def place_entries(
    owners: GalleryOwners, rows: Iterable[GalleryTownRow]
) -> list[GalleryPlaceRow]:
    """The page ``rows`` of ``place_rows`` with their photographers and up to
    ``COVERS_PER_ROW`` covers each (by id): two queries for the page."""
    rows = list(rows)
    photos = _located_photos(owners).filter(town__in=[row["town"] for row in rows])
    owner_ids: dict[str, list[int]] = {}
    for town, owner_id in (
        photos.values_list("town", "owner_id").distinct().order_by("town", "owner_id")
    ):
        owner_ids.setdefault(town, []).append(owner_id)
    rank = Window(RowNumber(), partition_by=[F("town")], order_by=["pk"])
    covers: dict[str, list[GalleryCover]] = {}
    for town, image_hash, video in (
        photos.annotate(rank=rank)
        .filter(rank__lte=COVERS_PER_ROW)
        .order_by("town", "rank")
        .values_list("town", "image_hash", "video")
    ):
        _add_cover(covers.setdefault(town, []), image_hash, video)
    return [
        {
            "name": row["town"],
            "photo_count": row["photo_count"],
            "owner_ids": owner_ids.get(row["town"], []),
            "cover_photos": covers.get(row["town"], []),
        }
        for row in rows
    ]


def people_rows(owners: GalleryOwners) -> QuerySet[Any, GalleryPersonRow]:
    """One row per owner and named person on the photos of owners who share
    people's names, by name."""
    photos = gallery_photos(owners.ids("people"))
    has_crop = Q(image__isnull=False) & ~Q(image="")
    return (
        named_faces(photos)
        .values("person_id", name=F("person__name"), owner_id=F("photo__owner_id"))
        .annotate(
            photo_count=Count("photo", distinct=True),
            face_id=Min("id", filter=has_crop),
        )
        .order_by("name", "person_id")
    )


def photographer_rows(owners: GalleryOwners) -> QuerySet[Any, GalleryPhotographerRow]:
    """One row per owner with photos in the gallery, most photos first."""
    return (
        gallery_photos(owners.ids())
        .values("owner_id")
        .annotate(photo_count=Count("pk"))
        .order_by("-photo_count", "owner_id")
    )


def photographer_covers(owner_ids: Iterable[int]) -> dict[int, list[GalleryCover]]:
    """Up to ``COVERS_PER_ROW`` photos of each owner, by id: one query."""
    rank = Window(RowNumber(), partition_by=[F("owner_id")], order_by=["pk"])
    rows = (
        gallery_photos(owner_ids)
        .annotate(rank=rank)
        .filter(rank__lte=COVERS_PER_ROW)
        .order_by("owner_id", "rank")
        .values_list("owner_id", "image_hash", "video")
    )
    covers: dict[int, list[GalleryCover]] = {}
    for owner_id, image_hash, video in rows:
        _add_cover(covers.setdefault(owner_id, []), image_hash, video)
    return covers


class GallerySummary(TypedDict):
    photo_count: int
    photographer_count: int


def gallery_summary(owners: GalleryOwners) -> GallerySummary:
    """How many photos the gallery shows, and of how many owners."""
    photos = gallery_photos(owners.ids())
    return {
        "photo_count": photos.count(),
        "photographer_count": photos.values("owner_id").distinct().count(),
    }


class GalleryPerson(TypedDict):
    id: int
    name: str
    owner: User | None
    photo_count: int
    face_url: str | None


def person_entries(rows: Iterable[GalleryPersonRow]) -> list[GalleryPerson]:
    """The page ``rows`` of ``people_rows`` with their owners and face crops:
    two queries for the whole page."""
    rows = list(rows)
    users = User.objects.only("id", "username", "first_name", "last_name").in_bulk(
        {row["owner_id"] for row in rows}
    )
    faces = Face.objects.only("id", "image").in_bulk(
        [row["face_id"] for row in rows if row["face_id"] is not None]
    )
    entries: list[GalleryPerson] = []
    for row in rows:
        face = faces.get(row["face_id"]) if row["face_id"] is not None else None
        entries.append(
            {
                "id": row["person_id"],
                "name": row["name"],
                "owner": users.get(row["owner_id"]),
                "photo_count": row["photo_count"],
                "face_url": face.crop_url if face is not None else None,
            }
        )
    return entries


class GalleryPhotographer(TypedDict):
    id: int
    username: str
    first_name: str
    last_name: str
    photo_count: int
    cover_photos: list[GalleryCover]


def photographer_entries(
    rows: Iterable[GalleryPhotographerRow],
) -> list[GalleryPhotographer]:
    """The page ``rows`` of ``photographer_rows`` with names and covers: two
    queries for the whole page."""
    rows = list(rows)
    ids = [row["owner_id"] for row in rows]
    users = User.objects.only("id", "username", "first_name", "last_name").in_bulk(ids)
    covers = photographer_covers(ids)
    return [
        {
            "id": user.pk,
            "username": user.username,
            "first_name": user.first_name,
            "last_name": user.last_name,
            "photo_count": row["photo_count"],
            "cover_photos": covers.get(user.pk, []),
        }
        for row in rows
        if (user := users.get(row["owner_id"])) is not None
    ]
