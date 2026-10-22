"""Which photos each of a user's places holds (#1365).

Membership is geometric: a photo is in a place when its position lies inside
the circle, and a photo inside two places is in the smaller one, so a photo
of the garden is in "Home" and not in the neighbourhood around it. It is
stored in ``UserPlace.photos`` and refreshed

- for all of an owner's photos when a place is drawn, moved, resized or
  deleted (``refresh_user_places``),
- for the photos whose position changed: a scan that read a new position
  from the file, a location the user set or removed (``refresh_photo_places``).
"""

from __future__ import annotations

import functools
import operator
from collections.abc import Collection, Iterable, Sequence
from uuid import UUID

from django.db.models import Q
from django.utils import timezone

from api.geocode.map_points import in_bounds_q
from api.geocode.photo_location import HAS_POSITION
from api.models import Photo, User
from api.models.user_place import UserPlace
from api.places.geometry import circle_bounds, distance_m

# Links written or removed per statement.
LINK_BATCH = 500


def contains(place: UserPlace, lat: float, lon: float) -> bool:
    """Whether the position lies inside the place's circle, edge included."""
    return distance_m(place.center_lat, place.center_lon, lat, lon) <= place.radius_m


def place_at(places: Sequence[UserPlace], lat: float, lon: float) -> UserPlace | None:
    """The place a photo taken at the position is in: the smallest that holds
    it (``places`` come smallest first), or None."""
    return next((place for place in places if contains(place, lat, lon)), None)


def _smallest_first(owner: User) -> list[UserPlace]:
    return list(UserPlace.objects.owned_by(owner).order_by("radius_m", "pk"))


def _near_any(places: Iterable[UserPlace]) -> Q:
    """Photos inside the bounding box of one of ``places``: the candidates."""
    boxes = [
        in_bounds_q(circle_bounds(p.center_lat, p.center_lon, p.radius_m))
        for p in places
    ]
    return functools.reduce(operator.or_, boxes, Q(pk__in=[]))


def _wanted(
    places: Sequence[UserPlace],
    photos: Iterable[tuple[UUID, float | None, float | None]],
) -> dict[UUID, int]:
    """The place each photo belongs in, by photo id; photos in none are left out."""
    wanted: dict[UUID, int] = {}
    for photo_id, lat, lon in photos:
        if lat is None or lon is None:
            continue
        place = place_at(places, lat, lon)
        if place is not None:
            wanted[photo_id] = place.pk
    return wanted


def _by_place(links: Iterable[tuple[UUID, int]]) -> dict[int, list[UUID]]:
    grouped: dict[int, list[UUID]] = {}
    for photo_id, place_id in links:
        grouped.setdefault(place_id, []).append(photo_id)
    return grouped


def _sync_links(
    places: Sequence[UserPlace],
    wanted: dict[UUID, int],
    photo_ids: Collection[UUID] | None,
) -> None:
    """Make the links of ``places`` (to ``photo_ids``, or to any photo) be
    exactly ``wanted``; touch ``last_modified`` of the places that changed."""
    through = UserPlace.photos.through
    links = through.objects.filter(userplace__in=[place.pk for place in places])
    if photo_ids is not None:
        links = links.filter(photo_id__in=list(photo_ids))
    current = set(links.values_list("photo_id", "userplace_id"))
    wanted_links = set(wanted.items())
    stale = _by_place(current - wanted_links)
    added = _by_place(wanted_links - current)
    for place_id, stale_ids in stale.items():
        for start in range(0, len(stale_ids), LINK_BATCH):
            batch = stale_ids[start : start + LINK_BATCH]
            through.objects.filter(userplace_id=place_id, photo_id__in=batch).delete()
    through.objects.bulk_create(
        [
            through(photo_id=photo_id, userplace_id=place_id)
            for place_id, photo_ids_added in added.items()
            for photo_id in photo_ids_added
        ],
        batch_size=LINK_BATCH,
    )
    changed = stale.keys() | added.keys()
    if changed:
        UserPlace.objects.filter(pk__in=changed).update(last_modified=timezone.now())


def refresh_user_places(owner: User, photo_ids: Collection[UUID] | None = None) -> None:
    """Put ``owner``'s photos into the places they were taken in.

    Without ``photo_ids`` every photo of the owner is looked at (after a place
    changed); with them only those (after their positions changed). A photo
    that lost its position leaves its place.
    """
    places = _smallest_first(owner)
    if not places:
        return
    photos = Photo.objects.owned_by(owner).filter(HAS_POSITION)
    if photo_ids is None:
        photos = photos.filter(_near_any(places))
    else:
        photos = photos.filter(pk__in=list(photo_ids))
    positions = photos.values_list("pk", "exif_gps_lat", "exif_gps_lon")
    _sync_links(places, _wanted(places, positions), photo_ids)


def refresh_photo_places(photos: Iterable[Photo]) -> None:
    """Put ``photos``, whose positions changed, into their owners' places."""
    by_owner: dict[int, list[UUID]] = {}
    for photo in photos:
        if photo.owner_id is not None:
            by_owner.setdefault(photo.owner_id, []).append(photo.pk)
    for owner in User.objects.filter(pk__in=by_owner):
        refresh_user_places(owner, by_owner[owner.pk])
