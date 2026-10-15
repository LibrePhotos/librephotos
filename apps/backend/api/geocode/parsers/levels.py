"""The ``geolocation_json`` the geopy parsers build from their typed names.

Each feature carries its level (``place_type``, see ``api.models.place_names``)
and the result names the provider, as the ExifTool parser's does (#2302).
"""

from collections.abc import Iterable

from api.geocode import GEOCODE_VERSION
from api.models.place_names import PlaceType

# Finest first: a name listed at several levels is filed as the finest.
_FINENESS: tuple[PlaceType, ...] = (
    "street",
    "poi",
    "locality",
    "city",
    "subregion",
    "region",
    "country",
)


def _dedup(named: Iterable[tuple[str, PlaceType]]) -> list[tuple[str, PlaceType]]:
    """Each name once, where it is first listed, as the finest level it is listed at.

    Sydney is TomTom's secondary subdivision and its municipality, Berlin
    OpenCage's city and state: one feature each, the city, and one Places
    album, as ExifTool's Lisbon.
    """
    levels: dict[str, PlaceType] = {}
    for name, place_type in named:
        known = levels.get(name)
        if known is None or _FINENESS.index(place_type) < _FINENESS.index(known):
            levels[name] = place_type
    return list(levels.items())


def typed_place(
    provider: str,
    named: Iterable[tuple[str, PlaceType]],
    address: str,
    center: list[float],
) -> dict[str, object]:
    """``features``, ``places``, ``address``, ``center``, ``provider`` and ``_v``
    for the ``(name, place_type)`` pairs, finest first, each name once."""
    unique = _dedup(named)
    return {
        "features": [
            {"text": name, "center": center, "place_type": place_type}
            for name, place_type in unique
        ],
        "places": [name for name, _ in unique],
        "address": address,
        "center": center,
        "provider": provider,
        "_v": GEOCODE_VERSION,
    }
