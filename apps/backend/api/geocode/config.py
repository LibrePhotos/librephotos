from collections.abc import Callable
from typing import TypedDict

from constance import config as settings
from geopy.location import Location

from api.geocode import EXIFTOOL_PROVIDER

from .parsers.mapbox import parse as parse_mapbox
from .parsers.nominatim import parse as parse_nominatim
from .parsers.opencage import parse as parse_opencage
from .parsers.tomtom import parse as parse_tomtom

GEOCODE_TIMEOUT_SECONDS = 10
"""HTTP timeout passed to each geopy geocoder. The library default is 1 second,
which is too aggressive against public nominatim under any load and turns
every reverse_geocode call into a near-guaranteed ReadTimeoutError."""


# Every value the Map Provider setting may hold: the geopy services of
# ``_get_config`` and the offline lookup. The admin form's choices
# (CONSTANCE_ADDITIONAL_FIELDS in settings) list the same.
MAP_API_PROVIDERS = frozenset(
    {"mapbox", "maptiler", "tomtom", "nominatim", "opencage", EXIFTOOL_PROVIDER}
)


# The providers geopy can ask for place names in a language (GEOCODE_LANGUAGE,
# #2745), as the ``language`` keyword of ``reverse`` and ``geocode``. Mapbox's
# reverse lookup has no such argument, and ExifTool's database is English.
LANGUAGE_PROVIDERS = frozenset({"nominatim", "opencage", "tomtom", "maptiler"})
# Nominatim sends the value as Accept-Language, which takes a list of
# languages in order of preference ("de,en"); the others take one.
LANGUAGE_LIST_PROVIDERS = frozenset({"nominatim"})


def language_args(provider: str, language: str) -> dict[str, str]:
    """The keyword arguments that ask *provider* for place names in *language*.

    None for an empty setting (the provider's default, as before the setting
    existed) or a provider that cannot be asked; the first language of a list
    for a provider that takes one.
    """
    if not language or provider not in LANGUAGE_PROVIDERS:
        return {}
    if provider not in LANGUAGE_LIST_PROVIDERS:
        language = language.split(",", maxsplit=1)[0]
    return {"language": language}


class _ProviderConfig(TypedDict):
    geocode_args: dict[str, object]
    parser: Callable[[Location], dict[str, object]]


def _get_config() -> dict[str, _ProviderConfig]:
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


def get_provider_config(provider: str) -> dict[str, object]:
    config = _get_config()
    if provider not in config:
        raise Exception(f"Map provider not found: {provider}.")
    return config[provider]["geocode_args"]


def get_provider_parser(provider: str) -> Callable[[Location], dict[str, object]]:
    config = _get_config()
    if provider not in config:
        raise Exception(f"Map provider not found: {provider}.")
    return config[provider]["parser"]
