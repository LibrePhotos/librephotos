"""The places and things of the photos shared with a user (#2721).

Sharing > Shared with you groups the photos other users shared with someone
by the owners' place and thing albums. One entry per title: a "Lisbon" of two
owners is one place. Counts and covers come from the shared photos only,
never from an album's stored ``photo_count`` or ``cover_photos``, which
describe the owner's whole library.

A recipient sees the same place and thing names here as on each shared
photo itself; the public link switches (``share_location`` and the others)
only govern public links. An owner who also shares their library with the
recipient with Location off (#2731) adds no places, and an album whose
owner keeps locations (or captions, for things) from its members (#464)
adds none of its photos.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any, TypedDict

from django.db.models import Count, F, Model, Q, QuerySet, Window
from django.db.models.functions import RowNumber

from api.models import AlbumPlace, AlbumThing, Photo, User
from api.sharing.grants import without_switch

# Covers per entry, as on the own place and thing lists.
COVERS_PER_GROUP = 4


class GroupRow(TypedDict):
    """A row of ``group_rows``: a title and its number of shared photos."""

    title: str
    photo_count: int


class GroupCover(TypedDict):
    image_hash: str
    video: bool


@dataclass(frozen=True)
class AlbumKind:
    """The album model a group is made of and its field on the photo link."""

    model: type[AlbumPlace] | type[AlbumThing]
    field: str
    # What a group's title tells about its photos: the album switch that
    # must let members see it (#464).
    album_switch: str

    def links(self, user: User | None) -> QuerySet[Model]:
        """The (album, photo) rows of the photos shared with ``user``."""
        through: type[Model] = self.model.photos.through
        shared = Photo.visible.shared_with_me(user, self.album_switch)
        if self.model is AlbumPlace:
            # A library share with the location switch off wins (#2731).
            shared = shared.exclude(
                owner__in=without_switch(user, "share_location")  # owner-scope: sharers
            )
        return through._default_manager.filter(photo__in=shared)


PLACES = AlbumKind(AlbumPlace, "albumplace", "location")
# Things come from the photos' captions (the OpenCLIP tags).
THINGS = AlbumKind(AlbumThing, "albumthing", "captions")


def place_links(user: User | None) -> QuerySet[Model]:
    """The place album rows of the photos shared with ``user``."""
    return PLACES.links(user)


def thing_links(user: User | None, thing_types: Iterable[str]) -> QuerySet[Model]:
    """The thing album rows of the photos shared with ``user``.

    Only the thing types the own Things page lists (``thing_types``) and
    hashtags, as there.
    """
    return THINGS.links(user).filter(
        Q(albumthing__thing_type__in=list(thing_types))
        | Q(albumthing__thing_type="hashtag_attribute")
    )


def group_rows(links: QuerySet[Model], kind: AlbumKind) -> QuerySet[Any, GroupRow]:
    """One row per title with the number of shared photos, by title.

    ``distinct``: an owner may have two albums of the same title (a city and
    a region both called "Berlin"), and a photo in both counts once.
    """
    return (
        links.values(title=F(f"{kind.field}__title"))
        .annotate(photo_count=Count("photo", distinct=True))
        .order_by("title")
    )


def group_covers(
    links: QuerySet[Model], kind: AlbumKind, titles: Iterable[str]
) -> dict[str, list[GroupCover]]:
    """Up to ``COVERS_PER_GROUP`` of the newest shared photos per title.

    One query for a whole page of titles: a window numbers each title's
    rows, and a photo in two albums of one title is skipped the second time.
    """
    title = F(f"{kind.field}__title")
    rows = (
        links.filter(**{f"{kind.field}__title__in": list(titles)})
        .annotate(
            group_title=title,
            rank=Window(
                RowNumber(),
                partition_by=[title],
                order_by=[F("photo__exif_timestamp").desc(nulls_last=True), "photo_id"],
            ),
        )
        .filter(rank__lte=COVERS_PER_GROUP * 2)
        .order_by("group_title", "rank")
        .values_list("group_title", "photo__image_hash", "photo__video")
    )
    covers: dict[str, list[GroupCover]] = {}
    for group_title, image_hash, video in rows:
        group = covers.setdefault(group_title, [])
        known = {cover["image_hash"] for cover in group}
        if len(group) < COVERS_PER_GROUP and image_hash not in known:
            group.append({"image_hash": image_hash, "video": video})
    return covers


def group_photos(
    links: QuerySet[Model], kind: AlbumKind, title: str
) -> QuerySet[Photo]:
    """The shared photos under ``title``, newest first."""
    photo_ids = links.filter(**{f"{kind.field}__title": title}).values("photo_id")
    return Photo.objects.filter(pk__in=photo_ids).order_by("-exif_timestamp", "pk")
