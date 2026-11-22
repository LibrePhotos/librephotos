import math

import requests

from api.metadata.reader import MetadataReadError
from api.runtime import sidecars
from api.runtime.http_timeouts import EXIF

MAX_DISTANCE_KM = 200.0


def nautical_time_zone(lon: float) -> str:
    hours = 12 if lon <= -180 else min(12, math.floor((lon + 7.5) / 15))
    return "Etc/GMT" if hours == 0 else f"Etc/GMT{-hours:+d}"


def time_zone_name_at(lat: float, lon: float) -> str:
    body = {"points": [{"lat": lat, "lon": lon}], "max_distance_km": MAX_DISTANCE_KM}
    try:
        response = sidecars.post("exif", "/time-zones", json=body, timeout=EXIF)
        zones = response.json()["time_zones"]
    except (requests.RequestException, ValueError, KeyError, TypeError) as error:
        raise MetadataReadError(
            "exif service could not look up a time zone: "
            f"{sidecars.error_detail(error)}"
        ) from error
    if not isinstance(zones, list) or len(zones) != 1:
        raise MetadataReadError("exif service answered without one time zone")
    (zone,) = zones
    if zone is None:
        return nautical_time_zone(lon)
    if not isinstance(zone, str):
        raise MetadataReadError("exif service answered a time zone that is no name")
    return zone
