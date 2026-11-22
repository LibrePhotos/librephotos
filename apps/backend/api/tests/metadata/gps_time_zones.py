from unittest.mock import patch

KNOWN_ZONES = {
    (37.7749, -122.4194): "America/Los_Angeles",
    (52.52, 13.405): "Europe/Berlin",
    (35.6812, 139.7671): "Asia/Tokyo",
}


def known_time_zone(lat: float, lon: float) -> str:
    return KNOWN_ZONES[(lat, lon)]


known_time_zones = patch(
    "api.metadata.datetime_rules.time_zone_name_at", known_time_zone
)
