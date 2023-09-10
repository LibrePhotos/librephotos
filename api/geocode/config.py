from constance import config as settings

from .parsers.mapbox import parse as parse_mapbox
from .parsers.nominatim import parse as parse_nominatim
from .parsers.opencage import parse as parse_opencage
from .parsers.photon import parse as parse_photon
from .parsers.tomtom import parse as parse_tomtom


def _get_config():
    return {
        "mapbox": {
            "geocode_args": {"api_key": settings.MAP_API_KEY},
            "parser": parse_mapbox,
        },
        "maptiler": {
            "geocode_args": {"api_key": settings.MAP_API_KEY},
            "parser": parse_mapbox,
        },
        "tomtom": {
            "geocode_args": {"api_key": settings.MAP_API_KEY},
            "parser": parse_tomtom,
        },
        "photon": {
            "geocode_args": {
                "domain": "photon.komoot.io",
            },
            "parser": parse_photon,
        },
        "nominatim": {
            "geocode_args": {"user_agent": "librephotos"},
            "parser": parse_nominatim,
        },
        "opencage": {
            "geocode_args": {
                "api_key": settings.MAP_API_KEY,
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
