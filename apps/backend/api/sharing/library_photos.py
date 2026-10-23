"""The photos of a shared library as the recipient's pages reach them (#2731).

Two ways in, both through the day albums the timeline is built from:

* ``library=<owner id>``: one owner's library page, read-only, archived
  photos included (as the owner's own library lists them);
* ``libraries=true``: the recipient's timeline with the libraries they turned
  "Show in my timeline" on for. A day both have is one day.

Views of what only the owner has (hidden photos, the trash, a public page,
folders, a person, a search, the sync feed) or of what is never shared
(favourites) never take another user's photos: ``library_photos_q`` answers
None for them, so no filter can be used to learn a hidden field.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

from django.db.models import Exists, F, Model, OuterRef, Q, QuerySet, Window
from django.db.models.functions import RowNumber
from rest_framework.exceptions import NotFound

from api.albums.timeline_filter import resolve_timeline_filter
from api.models import AlbumDate, LibraryShare, Photo, PhotoStack, User
from api.models.photo import shared_library_q
from api.models.place_names import town_name
from api.sharing.grants import LibraryGrant

# Params that make a day-album read a view of the requester's own library.
OWNER_ONLY_PARAMS = (
    "hidden",
    "in_trashcan",
    "public",
    "username",
    "folder",
    "person",
    "search",
    "last_modified",
)

# Set on a day album row of another user's library: the place the
# requester sees for it ("" when the owner does not share locations).
SHARED_PLACE_ATTR = "shared_place"
# How many of a day's located photos are asked for its town: the first one
# with a town name wins, as on a public day.
PLACE_CANDIDATES = 5


def owner_only_view(params: Mapping[str, Any]) -> bool:
    """Whether ``params`` ask for a view no library photo belongs in."""
    return any(params.get(name) not in (None, "", False) for name in OWNER_ONLY_PARAMS)


def timeline_shares(user: User) -> QuerySet[LibraryShare]:
    """The libraries ``user`` shows in their timeline."""
    return LibraryShare.objects.received_by(user).filter(show_in_timeline=True)


def library_share(user: User, owner_id: int) -> LibraryShare:
    """The share of ``owner_id``'s library with ``user``; a 404 without one."""
    share = (
        LibraryShare.objects.received_by(user)
        .filter(owner_id=owner_id)  # owner-scope: the library asked for
        .select_related("owner")
        .first()
    )
    if share is None:
        raise NotFound("No such library shared with you")
    return share


def _stack_q(prefix: str) -> Q:
    """Photos in no stack, or the primary of theirs, as the timeline shows."""
    in_no_stack = ~Exists(Photo.stacks.through.objects.filter(photo_id=OuterRef("pk")))
    is_primary = Exists(PhotoStack.objects.filter(primary_photo_id=OuterRef("pk")))
    shown = Photo.objects.filter(in_no_stack | is_primary).values("pk")
    return Q(**{f"{prefix}pk__in": shown})


def library_photos_q(
    user: User,
    params: Mapping[str, Any],
    shares: QuerySet[LibraryShare],
    prefix: str = "",
) -> Q | None:
    """The photos of ``shares`` a day-album read with ``params`` shows.

    None when the read takes no library photos at all (``owner_only_view``,
    or a favourites filter: ratings are never shared). The media filters
    (photos, videos, screenshots, documents, archived) apply as on the
    requester's own photos.
    """
    if owner_only_view(params):
        return None
    timeline_filter = resolve_timeline_filter(user, params)
    if timeline_filter.favorites:
        return None
    q = shared_library_q(user, shares, prefix) & Q(
        **{f"{prefix}thumbnail__aspect_ratio__isnull": False}
    )
    for condition in timeline_filter.q(user, prefix=prefix):
        q &= condition
    if not params.get("show_all_stack_photos"):
        q &= _stack_q(prefix)
    return q


def _towns(day_ids: Iterable[int]) -> dict[int, str]:
    """The town of each day in ``day_ids``, from its visible photos only.

    ``AlbumDate.location`` collects the town of every photo of the day,
    hidden and trashed ones included, so a shared day names the town of its
    earliest visible located photo instead, as the public view does. One
    query for all the days.
    """
    # Typed as a plain model: the stubs know no ``rank`` on the through table.
    through: type[Model] = AlbumDate.photos.through
    links = (
        through._default_manager.filter(
            albumdate_id__in=list(day_ids),
            photo__hidden=False,
            photo__in_trashcan=False,
            photo__removed=False,
            photo__geolocation_json__isnull=False,
        )
        .annotate(
            rank=Window(
                RowNumber(),
                partition_by=[F("albumdate_id")],
                order_by=[F("photo__exif_timestamp").asc(nulls_last=True), "photo_id"],
            )
        )
        .filter(rank__lte=PLACE_CANDIDATES)
        .order_by("albumdate_id", "rank")
        .values_list("albumdate_id", "photo__geolocation_json")
    )
    towns: dict[int, str] = {}
    for day_id, geolocation in links:
        name = town_name(geolocation)
        if name and day_id not in towns:
            towns[day_id] = name
    return towns


def set_shared_places(
    days: Iterable[AlbumDate], user: User, grants: Mapping[int, LibraryGrant]
) -> None:
    """Name the place of every day of another user's library in ``days``:
    from its visible photos when the owner shares locations, else none."""
    shared = [day for day in days if day.owner_id != user.pk]
    located = [day.pk for day in shared if _shares_location(grants, day.owner_id)]
    towns = _towns(located) if located else {}
    for day in shared:
        setattr(day, SHARED_PLACE_ATTR, towns.get(day.pk, ""))


def _shares_location(grants: Mapping[int, LibraryGrant], owner_id: int | None) -> bool:
    grant = grants.get(owner_id) if owner_id is not None else None
    return grant is not None and grant.location


def with_shared_photos(albums: QuerySet[AlbumDate], photos_q: Q) -> QuerySet[AlbumDate]:
    """The day albums of ``albums`` holding a photo ``photos_q`` keeps: a day
    of only hidden or trashed photos is not part of a shared library."""
    return albums.filter(pk__in=Photo.objects.filter(photos_q).values("albumdate"))


def merge_days(days: Iterable[AlbumDate], user: User) -> list[AlbumDate]:
    """One row per date, in the order of ``days``: the requester's own day
    where they have one, with the other owners' photos of that date in its count.

    ``days`` is ordered by date (either way, undated last) and annotated
    with ``photo_count``. A date only others have keeps the first of their
    rows; ``set_shared_places`` names its place.
    """
    merged: dict[object, AlbumDate] = {}
    for day in days:
        kept = merged.get(day.date)
        if kept is None:
            merged[day.date] = day
            continue
        if day.owner_id == user.pk:
            # The requester's own day leads, with what was counted so far.
            setattr(day, "photo_count", day_count(day) + day_count(kept))
            merged[day.date] = day
        else:
            setattr(kept, "photo_count", day_count(kept) + day_count(day))
    return list(merged.values())


def day_count(day: AlbumDate) -> int:
    count = getattr(day, "photo_count", 0)
    return count if isinstance(count, int) else 0


def same_date_days(day: AlbumDate) -> Q:
    """``Q`` for the day albums of ``day``'s date, whoever's."""
    if day.date is None:
        return Q(date__isnull=True)
    return Q(date=day.date)
