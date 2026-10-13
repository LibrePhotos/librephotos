"""Where a photo was taken: its GPS fix, its reverse-geocoded place and the
Places albums that follow from it.

Moved out of ``Photo`` so the model does not make network calls. Every function
takes the photo as its first argument.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable
from typing import TYPE_CHECKING

from django.db.models import Q, QuerySet

import api.models
from api.geocode import GEOCODE_VERSION
from api.geocode.geocode import reverse_geocode
from api.metadata.photo_datetime import find_album_date
from api.metadata.reader import get_metadata, sidecar_files_for_photo
from api.metadata.tags import Tags
from api.models.photo_metadata import usable_coordinates

if TYPE_CHECKING:
    from api.models.album_place import AlbumPlace
    from api.models.photo import Photo

logger = logging.getLogger(__name__)


def find_album_places(photo: Photo) -> QuerySet[AlbumPlace]:
    return api.models.album_place.AlbumPlace.objects.filter(Q(photos__in=[photo])).all()


def geolocate_photo(photo: Photo, commit: bool = True) -> None:
    """Read the GPS fix from the file, reverse geocode it and file the photo
    under the matching Places albums.

    The new coordinates are saved before the geocoder runs, so a geocoder
    failure still leaves them persisted.

    Both saves write only the columns set here. The geolocation job runs from a
    row loaded before the geocoder's network call, alongside other jobs on the
    same photos -- Probe Videos among them -- and a whole-row save put back
    whatever the rest of the row held when it was loaded, the video fields
    that job had just filled in going back to empty.
    """
    old_gps_lat = photo.exif_gps_lat
    old_gps_lon = photo.exif_gps_lon
    assert photo.main_file is not None
    new_gps_lat, new_gps_lon = get_metadata(
        photo.main_file.path,
        tags=[Tags.LATITUDE, Tags.LONGITUDE],
        sidecar_files=sidecar_files_for_photo(photo),
    )
    old_album_places = find_album_places(photo)
    position = usable_coordinates(new_gps_lat, new_gps_lon)
    if position is None:
        return
    new_gps_lat, new_gps_lon = position
    if (
        old_gps_lat == new_gps_lat
        and old_gps_lon == new_gps_lon
        and old_album_places.exists()
        and _has_current_geolocation(photo)
    ):
        return
    photo.exif_gps_lon = new_gps_lon
    photo.exif_gps_lat = new_gps_lat
    if commit:
        photo.save(update_fields=["exif_gps_lat", "exif_gps_lon", "last_modified"])

    res = _reverse_geocode_safely(new_gps_lat, new_gps_lon)
    if not res:
        # The place of the old coordinates no longer applies (#2253); for the
        # same coordinates it still does.
        if (old_gps_lat, old_gps_lon) != (photo.exif_gps_lat, photo.exif_gps_lon):
            forget_place(photo, old_album_places)
            if commit:
                photo.save(update_fields=["geolocation_json", "last_modified"])
        return

    photo.geolocation_json = res
    _update_search_location(photo, res)
    _move_to_album_places(photo, old_album_places)

    if commit:
        photo.save(update_fields=["geolocation_json", "last_modified"])


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
    """Add the photo's city to the location of the day album it is in."""
    places = (photo.geolocation_json or {}).get("places") or []
    if len(places) < 2:
        return

    album_date = find_album_date(photo)
    # find_album_date returns None when the photo is in no day album. That
    # crashed here before the typing too (AttributeError), so it still does.
    assert album_date is not None
    city_name = places[-2]
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
