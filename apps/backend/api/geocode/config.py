from constance import config as settings

from .parsers.mapbox import parse as parse_mapbox
from .parsers.nominatim import parse as parse_nominatim
from .parsers.opencage import parse as parse_opencage
from .parsers.tomtom import parse as parse_tomtom


GEOCODE_TIMEOUT_SECONDS = 10
"""HTTP timeout passed to each geopy geocoder. The library default is 1 second,
which is too aggressive against public nominatim under any load and turns
every reverse_geocode call into a near-guaranteed ReadTimeoutError."""


def _get_config():
    return {
        "mapbox": {
            "geocode_args": {
                "api_key": settings.MAP_API_KEY,
                "timeout": GEOCODE_TIMEOUT_SECONDS,
            },
            "parser": parse_mapbox,
        },
        "maptiler": {
            "geocode_args": {
                "api_key": settings.MAP_API_KEY,
                "timeout": GEOCODE_TIMEOUT_SECONDS,
            },
            "parser": parse_mapbox,
        },
        "tomtom": {
            "geocode_args": {
                "api_key": settings.MAP_API_KEY,
                "timeout": GEOCODE_TIMEOUT_SECONDS,
            },
            "parser": parse_tomtom,
        },
        "nominatim": {
            "geocode_args": {
                "user_agent": "librephotos",
                "timeout": GEOCODE_TIMEOUT_SECONDS,
            },
            "parser": parse_nominatim,
        },
        "opencage": {
            "geocode_args": {
                "api_key": settings.MAP_API_KEY,
                "timeout": GEOCODE_TIMEOUT_SECONDS,
            },
            "parser": parse_opencage,
        },
    }


def get_provider_config(provider) -> dict:
    config = _get_config()
    if provider not in config:
        raise Exception(f"Map provider not found: {provider}.")
    return config[provider]["geocode_args"]


def get_provider_parser(provider) -> callable:
    config = _get_config()
    if provider not in config:
        raise Exception(f"Map provider not found: {provider}.")
    return config[provider]["parser"]
