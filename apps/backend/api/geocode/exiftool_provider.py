"""The offline Map Provider: ExifTool's Geolocation database (#2302).

The exif sidecar looks the points up (``POST /geolocate``,
``service/exif/geolocate.py``); nothing leaves the server, there is no API
key and no rate limit. It names the nearest town of GeoNames (population
2,000 or more) with its subregion, region and country, not a street, and has
no borders: near one the town can be across it.
"""

from collections.abc import Sequence

import requests

from api.runtime import sidecars
from api.runtime.http_timeouts import EXIF

from .parsers.exiftool import parse

# Farther from every town than this, a photo gets no place rather than a town
# (and a country) it is not in: the nearest town to the open Atlantic is on
# the Azores, 334 km away. Immich uses 25 km with a denser database.
MAX_DISTANCE_KM = 50


class GeolocateError(Exception):
    """The exif sidecar could not look the points up, or answered nonsense."""


def lookup(points: Sequence[tuple[float, float]]) -> list[dict[str, object] | None]:
    """The sidecar's answer for each of *points*, in order: the town's
    Geolocation tags, or None when no town is within ``MAX_DISTANCE_KM``.

    Raises GeolocateError when the sidecar cannot be asked or answers without
    one result per point.
    """
    body = {
        "points": [{"lat": lat, "lon": lon} for lat, lon in points],
        "max_distance_km": MAX_DISTANCE_KM,
    }
    try:
        response = sidecars.post("exif", "/geolocate", json=body, timeout=EXIF)
        places = response.json()["places"]
    except (requests.RequestException, ValueError, KeyError, TypeError) as error:
        raise GeolocateError(sidecars.error_detail(error)) from error
    if not isinstance(places, list) or len(places) != len(points):
        raise GeolocateError("the exif service answered without one place per point")
    if not all(place is None or isinstance(place, dict) for place in places):
        raise GeolocateError("the exif service answered a place that is no object")
    return places


def reverse(lat: float, lon: float) -> dict[str, object]:
    """The place at *lat*, *lon* as ``geolocation_json``; raises GeolocateError."""
    (answer,) = lookup([(lat, lon)])
    return parse(answer, lat, lon)
