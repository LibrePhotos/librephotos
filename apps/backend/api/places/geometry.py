"""Circles on the globe: distances and bounding boxes (#1365)."""

from __future__ import annotations

import math

from api.geocode.map_points import MapBounds

# The mean radius of the Earth (IUGG), in metres.
EARTH_RADIUS_M = 6_371_008.8


def distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """The great-circle distance between two positions, in metres (haversine)."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = phi2 - phi1
    dlambda = math.radians(lon2 - lon1)
    a = (
        math.sin(dphi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    )
    return 2 * EARTH_RADIUS_M * math.asin(min(1.0, math.sqrt(a)))


def _wrap(lon: float) -> float:
    """``lon`` brought into -180..180."""
    return (lon + 180) % 360 - 180


def circle_bounds(lat: float, lon: float, radius_m: float) -> MapBounds:
    """A box that holds the circle: the database filters by it, then the
    distance decides. Across the 180th meridian ``west`` is greater than
    ``east``; near a pole the box takes every longitude."""
    dlat = math.degrees(radius_m / EARTH_RADIUS_M)
    south, north = max(-90.0, lat - dlat), min(90.0, lat + dlat)
    cos_lat = math.cos(math.radians(max(abs(south), abs(north))))
    if cos_lat < 1e-6 or dlat / cos_lat >= 180:
        return MapBounds(south=south, west=-180.0, north=north, east=180.0)
    dlon = dlat / cos_lat
    return MapBounds(
        south=south, west=_wrap(lon - dlon), north=north, east=_wrap(lon + dlon)
    )
