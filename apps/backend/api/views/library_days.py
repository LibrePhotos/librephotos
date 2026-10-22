"""The day albums of shared libraries (#2731), for the date-album views.

``/api/albums/date/list/`` and ``/api/albums/date/<id>/`` take two more
params: ``library=<owner id>`` reads one owner's library instead of the
requester's, and ``libraries=true`` adds the libraries the requester shows
in their timeline. The rules live in ``api.sharing.library_photos``; this
module turns them into day rows and day pages.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from django.db.models import Count, F, Q, QuerySet
from rest_framework.exceptions import NotFound
from rest_framework.generics import get_object_or_404

from api.models import AlbumDate, LibraryShare, Photo, User
from api.sharing.grants import LibraryGrant, received_grants
from api.sharing.library_photos import (
    library_photos_q,
    library_share,
    merge_days,
    same_date_days,
    set_shared_places,
    timeline_shares,
    with_shared_photos,
)


def _days(albums: QuerySet[AlbumDate], photos_q: Q) -> QuerySet[AlbumDate]:
    """``albums`` with the number of their photos ``photos_q`` keeps, newest first."""
    return (
        albums.filter(photos_q)
        .annotate(photo_count=Count("photos"))
        .filter(photo_count__gt=0)
        .order_by(F("date").desc(nulls_last=True))
    )


def _newest_first(day: AlbumDate) -> tuple[bool, float]:
    return (day.date is None, -day.date.toordinal() if day.date else 0.0)


def library_day_rows(user: User, params: Mapping[str, Any]) -> list[AlbumDate]:
    """The days of the library ``params["library"]`` shares with ``user``."""
    share = library_share(user, params["library"])
    photos_q = library_photos_q(
        user, params, LibraryShare.objects.filter(pk=share.pk), prefix="photos__"
    )
    if photos_q is None:
        return []
    days = list(_days(AlbumDate.objects.owned_by(share.owner), photos_q))
    set_shared_places(days, user, {share.owner_id: LibraryGrant.of(share)})
    return days


def timeline_day_rows(
    user: User, params: Mapping[str, Any], own_days: QuerySet[AlbumDate]
) -> list[AlbumDate]:
    """``own_days`` with the days of the libraries in ``user``'s timeline."""
    shares = timeline_shares(user)
    photos_q = library_photos_q(user, params, shares, prefix="photos__")
    if photos_q is None or not shares.exists():
        return list(own_days)
    others = _days(
        AlbumDate.objects.filter(
            owner__in=shares.values("owner_id")  # owner-scope: library sharers
        ),
        photos_q,
    )
    days = merge_days(sorted([*own_days, *others], key=_newest_first), user)
    set_shared_places(days, user, received_grants(user))
    return days


def library_day(
    user: User, params: Mapping[str, Any], pk: object
) -> tuple[AlbumDate, QuerySet[Photo]]:
    """A day of the library ``params["library"]`` and the photos it shows."""
    share = library_share(user, params["library"])
    photos_q = library_photos_q(user, params, LibraryShare.objects.filter(pk=share.pk))
    if photos_q is None:
        raise NotFound("No such day in this library")
    days = with_shared_photos(AlbumDate.objects.owned_by(share.owner), photos_q)
    day = get_object_or_404(days, pk=pk)
    set_shared_places([day], user, {share.owner_id: LibraryGrant.of(share)})
    return day, day.photos.filter(photos_q)


def timeline_day(
    user: User, params: Mapping[str, Any], pk: object, own_photos_q: list[Q]
) -> tuple[AlbumDate, QuerySet[Photo]]:
    """A day of ``user``'s timeline with the libraries in it: their own photos
    of its date (``own_photos_q``) and the shared ones."""
    shares = timeline_shares(user)
    owners = shares.values("owner_id")
    photos_q = library_photos_q(user, params, shares)
    reachable = AlbumDate.objects.owned_by(user)
    if photos_q is not None:
        # Another user's day only while it holds a photo they share.
        reachable = reachable | with_shared_photos(
            AlbumDate.objects.filter(owner__in=owners),  # owner-scope: sharers
            photos_q,
        )
    day = get_object_or_404(reachable, pk=pk)
    grants: dict[int, LibraryGrant] = received_grants(user)
    set_shared_places([day], user, grants)
    own_days = AlbumDate.objects.owned_by(user).filter(same_date_days(day))
    own = Photo.objects.filter(*own_photos_q, albumdate__in=own_days).values("pk")
    match = Q(pk__in=own)
    if photos_q is not None:
        their_days = AlbumDate.objects.filter(
            same_date_days(day),
            owner__in=owners,  # owner-scope: library sharers
        )
        shared = Photo.objects.filter(photos_q, albumdate__in=their_days)
        match |= Q(pk__in=shared.values("pk"))
    return day, Photo.objects.filter(match)
