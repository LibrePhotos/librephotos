"""Where a photo was taken: its GPS fix, its reverse-geocoded place and the
Places albums that follow from it.

Moved out of ``Photo`` so the model does not make network calls. Every function
takes the photo as its first argument.
"""

from __future__ import annotations

import logging
import math
from collections import Counter
from collections.abc import Iterable
from datetime import datetime
from typing import TYPE_CHECKING, Literal, TypedDict

from django.db.models import Count, F, Max, Min, Q, QuerySet

import api.models
from api.geocode import GEOCODE_VERSION
from api.geocode.geocode import reverse_geocode
from api.metadata.photo_datetime import find_album_date
from api.models.photo import LocationSource
from api.models.place_names import short_place_name, town_name

if TYPE_CHECKING:
    from api.models.album_place import AlbumPlace
    from api.models.photo import Photo

logger = logging.getLogger(__name__)

# The columns geolocate_photo writes.
GEOCODED_COLUMNS = ["geolocation_json", "geocoded_lat", "geocoded_lon", "last_modified"]

# How the place lookup for a photo's position went; see ``geocode_status``.
GeocodeStatus = Literal["found", "no_place", "failed"]

# A photo with a position (both coordinates).
HAS_POSITION = Q(exif_gps_lat__isnull=False, exif_gps_lon__isnull=False)
# Geotagged photos the location picker offers to copy from (#2279).
NEARBY_IN_TIME_LIMIT = 20
# Place names a selection's summary lists.
SUMMARY_PLACES = 3
# Located photos a selection's summary reads place names from; a larger
# selection names the places of a sample, which is all the dialog needs.
SUMMARY_PLACE_SAMPLE = 5000


def _coordinate(value: object) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, str | int | float):
        try:
            number = float(value)
        except ValueError:
            return None
        return number if math.isfinite(number) else None
    return None


def usable_coordinates(lat: object, lon: object) -> tuple[float, float] | None:
    """``(lat, lon)`` as floats, or None for a missing position.

    Rejects missing or non-numeric values and the (0, 0) "null island" that
    cameras write when they have no fix. A single zero axis (the equator or
    the prime meridian) is a valid position and is kept.
    """
    latitude, longitude = _coordinate(lat), _coordinate(lon)
    if latitude is None or longitude is None:
        return None
    if latitude == 0 and longitude == 0:
        return None
    return latitude, longitude


def apply_file_position(photo: Photo, lat: object, lon: object) -> None:
    """Bring the photo's position in line with what its file says.

    The scan calls this with the values it read, so the date rules that turn
    a UTC date into the local time at the photo's position see it in the same
    pass (#2263). The position is saved with the photo by the caller; the
    geolocation job then looks up the place of any position that differs from
    the one it last looked up (``needs_geocoding``).

    A position the user set (``location_source == "user"``) is never touched.
    Otherwise the file's position replaces the stored one, and the place of
    the old position goes with it (#2253); when the file has no position any
    more, one that came from the file is cleared together with its place
    (#2264). A position of unknown origin (``NULL``, rows from before the
    column) is replaced but never cleared.
    """
    if photo.location_source == LocationSource.USER:
        return
    position = usable_coordinates(lat, lon)
    if position is None:
        if photo.location_source == LocationSource.FILE:
            clear_location(photo)
        return
    stored = (photo.exif_gps_lat, photo.exif_gps_lon)
    if stored not in ((None, None), position):
        forget_place(photo, find_album_places(photo))
    photo.exif_gps_lat, photo.exif_gps_lon = position
    photo.location_source = LocationSource.FILE


def clear_location(photo: Photo) -> None:
    """Remove the photo's position and everything derived from it: the place
    (``geolocation_json``), the search location and the Places albums.

    The Places albums and the search row are updated here; the photo's own
    columns are saved by the caller.
    """
    forget_place(photo, find_album_places(photo))
    photo.exif_gps_lat = None
    photo.exif_gps_lon = None
    photo.location_source = None
    # No coordinates, rather than coordinates not geocoded yet ({}).
    photo.geolocation_json = None
    photo.geocoded_lat = None
    photo.geocoded_lon = None


def needs_geocoding() -> Q:
    """Photos with a position whose place was not looked up for it yet: never
    geocoded, a lookup that failed, or a position that changed since. A
    lookup that found no place there (``no_place``) counts as looked up."""
    return Q(exif_gps_lat__isnull=False, exif_gps_lon__isnull=False) & (
        Q(geocoded_lat__isnull=True)
        | Q(geocoded_lon__isnull=True)
        | ~Q(geocoded_lat=F("exif_gps_lat"))
        | ~Q(geocoded_lon=F("exif_gps_lon"))
    )


def find_album_places(photo: Photo) -> QuerySet[AlbumPlace]:
    return api.models.album_place.AlbumPlace.objects.filter(Q(photos__in=[photo])).all()


def geolocate_photo(photo: Photo, commit: bool = True, force: bool = False) -> None:
    """Reverse geocode the photo's stored position and file the photo under
    the matching Places albums.

    The position comes from the row, not the file: the scan keeps it in line
    with the file (``apply_file_position``), and reading the file here again
    would bring back a position the user moved or cleared. Nothing happens
    when the place is current for that position already, unless ``force``:
    Look Up Place Names asks the current provider again for every photo
    (#2302), since switching the provider renames nothing by itself.

    The save writes only the columns set here. The geolocation job runs from a
    row loaded before the geocoder's network call, alongside other jobs on the
    same photos -- Probe Videos and the scan among them -- and a whole-row save
    put back whatever the rest of the row held when it was loaded.
    """
    position = usable_coordinates(photo.exif_gps_lat, photo.exif_gps_lon)
    if position is None:
        return
    old_album_places = find_album_places(photo)
    if (
        not force
        and (photo.geocoded_lat, photo.geocoded_lon) == position
        and _has_current_geolocation(photo)
        # A place puts the photo in its Places albums; a position with no
        # place (``no_place``) has none to check (#2567).
        and (old_album_places.exists() or not has_place(photo))
    ):
        return

    res = _reverse_geocode_safely(*position)
    if not res:
        # The lookup failed. The place of other coordinates no longer applies
        # (#2253); for the same coordinates it still does. Left ungeocoded,
        # the photo is looked up again by the next geolocation job. A
        # position with no place is not a failure: it is stored below.
        geocoded = (photo.geocoded_lat, photo.geocoded_lon)
        if geocoded not in ((None, None), position):
            forget_place(photo, old_album_places)
            photo.geocoded_lat = photo.geocoded_lon = None
            if commit:
                photo.save(update_fields=GEOCODED_COLUMNS)
        return

    photo.geolocation_json = res
    photo.geocoded_lat, photo.geocoded_lon = position
    _update_search_location(photo, res)
    _move_to_album_places(photo, old_album_places)

    if commit:
        photo.save(update_fields=GEOCODED_COLUMNS)


def forget_place(photo: Photo, album_places: Iterable[AlbumPlace]) -> None:
    """Undo what the photo's previous place set: its Places albums, its search
    location and its ``geolocation_json``.

    ``geolocation_json`` becomes ``{}``, "coordinates not geocoded", as a new
    photo starts out. The caller saves the photo.
    """
    for album_place in album_places:
        album_place.photos.remove(photo)
        album_place.save()
    photo.geolocation_json = {}
    _update_search_location(photo, None)


def has_place(photo: Photo) -> bool:
    """Whether the photo's coordinates have a reverse-geocoded place."""
    geolocation = photo.geolocation_json or {}
    return bool(geolocation.get("features") or geolocation.get("address"))


def geocode_status(photo: Photo) -> GeocodeStatus | None:
    """How the place lookup for the photo's position went (#2589).

    ``"found"``: it has a place. ``"no_place"``: the provider answered that
    there is no place there (open sea, ``no_place()``), which is not a
    failure. ``"failed"``: the position has not been looked up (the lookup
    failed, or reverse geocoding is off); the geolocation job tries again.
    None for a photo without a position.
    """
    position = usable_coordinates(photo.exif_gps_lat, photo.exif_gps_lon)
    if position is None:
        return None
    if has_place(photo):
        return "found"
    if (photo.geocoded_lat, photo.geocoded_lon) == position:
        return "no_place"
    return "failed"


def _has_current_geolocation(photo: Photo) -> bool:
    return bool(
        photo.geolocation_json
        and "_v" in photo.geolocation_json
        and photo.geolocation_json["_v"] == GEOCODE_VERSION
    )


def _reverse_geocode_safely(lat: float, lon: float) -> dict[str, object] | None:
    try:
        return reverse_geocode(lat, lon)
    except Exception as e:
        logger.warning(e)
        logger.warning("Something went wrong with geolocating")
        return None


def _update_search_location(photo: Photo, res: dict[str, object] | None) -> None:
    from api.models.photo_search import PhotoSearch

    search_instance, _ = PhotoSearch.objects.get_or_create(photo=photo)
    search_instance.update_search_location(res)
    search_instance.save()


def _move_to_album_places(photo: Photo, old_album_places: QuerySet[AlbumPlace]) -> None:
    # Delete photo from album places if location has changed
    if old_album_places is not None:
        for old_album_place in old_album_places:
            old_album_place.photos.remove(photo)
            old_album_place.save()

    # geolocate_photo sets geolocation_json before it calls this.
    assert photo.geolocation_json is not None
    features = photo.geolocation_json["features"]
    for geolocation_level, feature in enumerate(features):
        if "text" not in feature.keys() or feature["text"].isnumeric():
            continue
        album_place = api.models.album_place.get_album_place(
            feature["text"], owner=photo.owner
        )
        if not album_place.photos.filter(image_hash=photo.image_hash).exists():
            album_place.geolocation_level = len(features) - geolocation_level
        album_place.photos.add(photo)
        album_place.save()


def add_location_to_album_dates(photo: Photo) -> None:
    """Add the photo's town (``town_name``) to the location of its day album."""
    city_name = town_name(photo.geolocation_json)
    if city_name is None:
        return

    album_date = find_album_date(photo)
    # find_album_date returns None when the photo is in no day album. That
    # crashed here before the typing too (AttributeError), so it still does.
    assert album_date is not None
    if album_date.location and len(album_date.location) > 0:
        prev_value = album_date.location
        new_value = prev_value
        if city_name not in prev_value["places"]:
            new_value["places"].append(city_name)
            new_value["places"] = list(set(new_value["places"]))
            album_date.location = new_value
    else:
        album_date.location = {"places": [city_name]}
    # Safe geolocation_json
    album_date.save()


class PlaceCount(TypedDict):
    place: str
    count: int


class LocationSummary(TypedDict):
    """Where a selection of photos stands before a bulk location edit."""

    count: int
    with_location: int
    places: list[PlaceCount]
    first_taken: datetime | None
    last_taken: datetime | None


def location_summary(photos: QuerySet[Photo]) -> LocationSummary:
    """How many of ``photos`` have a location, the most frequent place names
    among those (``short_place_name``), and when the first and the last of
    them were taken (#2279).

    ``photos`` may be a distinct, joined queryset (``build_photo_queryset``),
    so the counts run over its ids rather than over its rows.
    """
    selected = api.models.Photo.objects.filter(id__in=photos.values("id"))
    totals = selected.aggregate(
        count=Count("id"),
        with_location=Count("id", filter=HAS_POSITION),
        first_taken=Min("exif_timestamp"),
        last_taken=Max("exif_timestamp"),
    )
    names = Counter(
        name
        for geolocation in selected.filter(HAS_POSITION).values_list(
            "geolocation_json", flat=True
        )[:SUMMARY_PLACE_SAMPLE]
        if (name := short_place_name(geolocation))
    )
    places = sorted(names.items(), key=lambda item: (-item[1], item[0]))
    return {
        "count": totals["count"],
        "with_location": totals["with_location"],
        "places": [
            {"place": name, "count": count} for name, count in places[:SUMMARY_PLACES]
        ],
        "first_taken": totals["first_taken"],
        "last_taken": totals["last_taken"],
    }


def located_nearby_in_time(
    photos: QuerySet[Photo], start: datetime, end: datetime
) -> list[Photo]:
    """The geotagged ``photos`` taken from ``start`` to ``end``, nearest to the
    middle of that window first, at most ``NEARBY_IN_TIME_LIMIT`` (#2279).

    Each one carries its place name as ``place`` (None without a search row).
    The nearest rows on either side of the middle come from two indexed,
    limited queries, so a busy window costs no more than a quiet one.
    """
    middle = start + (end - start) / 2
    located = (
        photos.filter(HAS_POSITION, exif_timestamp__range=(start, end))
        .annotate(place=F("search_instance__search_location"))
        .order_by()
    )
    before = located.filter(exif_timestamp__lte=middle).order_by("-exif_timestamp")
    after = located.filter(exif_timestamp__gt=middle).order_by("exif_timestamp")
    nearest: list[Photo] = [
        *before[:NEARBY_IN_TIME_LIMIT],
        *after[:NEARBY_IN_TIME_LIMIT],
    ]
    nearest.sort(key=lambda photo: abs(_taken(photo) - middle))
    return nearest[:NEARBY_IN_TIME_LIMIT]


def _taken(photo: Photo) -> datetime:
    # located_nearby_in_time only reads photos taken inside its window.
    assert photo.exif_timestamp is not None
    return photo.exif_timestamp
