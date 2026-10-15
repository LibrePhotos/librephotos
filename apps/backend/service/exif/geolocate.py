"""Place names from ExifTool's built-in Geolocation database (#2302).

ExifTool ships ``Geolocation.dat``: the towns of GeoNames with a population of
2,000 or more, with their region, subregion and country. ``-api
geolocation=<lat>,<lon>`` looks up the nearest one without a file and without
the network, in about 9 ms on a warm process; the first lookup of a process
loads the database (~0.2 s, ~20 MB).

Options, checked against ExifTool 13.57:

- ``GeolocFeature=-PPLX`` leaves out sections of a town (GeoNames feature code
  ``PPLX``), so central Berlin is "Berlin" rather than "Mitte". Neighbourhoods
  coded ``PPL`` (Graça in Lisbon) stay.
- ``GeolocMaxDist=<km>``: without a town that close ExifTool answers no
  Geolocation tags (it warns and exits 0), which comes back here as None.
  Without it the nearest town answers however far away it is.

The options apply to one command only, so a lookup leaves nothing behind on
the ExifTool process the ``/get-tags`` reads share.

No Flask or Django here: the route in ``service.exif.main`` calls it.
"""

from __future__ import annotations

import math

import exiftool

# GeoNames feature codes ExifTool leaves out: sections of a populated place.
FEATURE_FILTER = "-PPLX"

# What a lookup asks for. Every other Geolocation tag (time zone, population,
# bearing) stays unread: the nearest town's time zone is wrong away from towns.
TAGS = (
    "GeolocationCity",
    "GeolocationSubregion",
    "GeolocationRegion",
    "GeolocationCountry",
    "GeolocationCountryCode",
    "GeolocationPosition",
    "GeolocationDistance",
    "GeolocationFeatureCode",
)

# Points one request may ask for: a lookup takes ~9 ms, so a full batch stays
# well inside the backend's 30 s read timeout.
MAX_POINTS = 1000

Point = tuple[float, float]


class InvalidPointsError(ValueError):
    """The request's points (or its distance cap) are not what the route takes."""


def _number(value: object, low: float, high: float) -> float | None:
    """*value* as a finite float within [low, high], else None."""
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    number = float(value)
    if not math.isfinite(number) or not low <= number <= high:
        return None
    return number


def _point(value: object) -> Point:
    if not isinstance(value, dict):
        raise InvalidPointsError("each point is an object with lat and lon")
    lat = _number(value.get("lat"), -90, 90)
    lon = _number(value.get("lon"), -180, 180)
    if lat is None or lon is None:
        raise InvalidPointsError(
            "lat must be a number from -90 to 90 and lon one from -180 to 180"
        )
    return lat, lon


def parse_points(value: object) -> list[Point]:
    """The ``points`` of a request as ``(lat, lon)`` pairs, in order.

    Raises InvalidPointsError for anything but a list of at most MAX_POINTS
    ``{"lat": <number>, "lon": <number>}`` objects inside the valid ranges.
    The coordinates must be numbers: ExifTool reads text after ``geolocation=``
    as a town name to search for.
    """
    if not isinstance(value, list):
        raise InvalidPointsError("points must be a list")
    if len(value) > MAX_POINTS:
        raise InvalidPointsError(f"at most {MAX_POINTS} points per request")
    return [_point(item) for item in value]


def parse_max_distance(value: object) -> float | None:
    """The request's ``max_distance_km``: None (no cap) or a positive number."""
    if value is None:
        return None
    distance = _number(value, 0, math.inf)
    if distance is None or distance == 0:
        raise InvalidPointsError("max_distance_km must be a positive number")
    return distance


def lookup_args(point: Point, max_distance_km: float | None) -> list[str]:
    """The ExifTool arguments of one lookup."""
    lat, lon = point
    args = [
        "-api",
        # Fixed-point: never an exponent ExifTool would not read as a number.
        f"geolocation={lat:.6f},{lon:.6f}",
        "-api",
        f"GeolocFeature={FEATURE_FILTER}",
    ]
    if max_distance_km is not None:
        args += ["-api", f"GeolocMaxDist={max_distance_km:.3f}"]
    return args + [f"-{tag}" for tag in TAGS]


def _ungrouped(data: dict[str, object]) -> dict[str, object]:
    """``ExifTool:GeolocationCity`` -> ``GeolocationCity``, the lookup's tags only."""
    by_name = {key.rpartition(":")[2]: value for key, value in data.items()}
    return {tag: by_name[tag] for tag in TAGS if tag in by_name}


def geolocate(
    et: exiftool.ExifTool, point: Point, max_distance_km: float | None
) -> dict[str, object] | None:
    """The nearest town to *point*, as ExifTool's Geolocation tags by name.

    None when the database has no town within *max_distance_km*. ExifTool
    runs with ``-n``, so ``GeolocationDistance`` is a number of km and
    ``GeolocationPosition`` the town's ``"<lat> <lon>"``.
    """
    answer = et.execute_json(*lookup_args(point, max_distance_km))
    if not isinstance(answer, list) or len(answer) != 1:
        raise ValueError("ExifTool answered a lookup without one result")
    data = answer[0]
    if not isinstance(data, dict):
        raise ValueError("ExifTool answered a lookup without an object")
    tags = _ungrouped(data)
    if not tags.get("GeolocationCity"):
        return None
    return tags
