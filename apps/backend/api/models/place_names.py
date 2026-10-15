"""The place name of one level (town, region, country) in ``Photo.geolocation_json``.

Every reverse geocoder parser writes ``features`` finest first, and each
feature says which level it is (``place_type``, #2302). Consumers that need one
level (the day albums, the event titles, the location sunburst) ask for it by
name here instead of picking a feature by its position: the parsers stop at
different depths, so a position names a region for one provider and a town
for another (ExifTool's Zermatt row has the region "Valais" next to last).

Rows stored before ``place_type`` existed are read the way each consumer read
them until then, by position, so their output does not change.

A pure reading of the JSON: it lives with the models because the event title
(``api.models.album_auto``) needs it too.
"""

from collections.abc import Mapping, Sequence
from typing import Literal

# A level a consumer asks for.
PlaceLevel = Literal["city", "region", "country"]
# Every level a parser types a feature as; ``street`` and ``poi`` are never
# a place name of a level.
PlaceType = Literal[
    "street", "poi", "locality", "city", "subregion", "region", "country"
]

# The named levels, finest first: a level missing from a row falls back to
# the nearest finer one (the parser folded the level into it, as ExifTool's
# Lisbon is city, subregion and region at once), then the nearest coarser one.
_RANKED: tuple[PlaceType, ...] = (
    "locality",
    "city",
    "subregion",
    "region",
    "country",
)
# Mapbox's own feature types, which older Mapbox rows carry as their
# ``place_type`` list.
_ALIASES: dict[str, PlaceType] = {
    "neighborhood": "locality",
    "place": "city",
    "district": "subregion",
}
# Where an untyped row (stored before #2302) had each level, counted from the
# end of its names: the sunburst read country, region and city there.
UNTYPED_INDEX: dict[PlaceLevel, int] = {"country": -1, "region": -2, "city": -3}
# The day albums (and the place summaries named like them) took the next to
# last name of an untyped row as its town.
DAY_ALBUM_UNTYPED_INDEX = -2


def _feature_type(feature: Mapping[str, object]) -> str | None:
    """The ranked level of a feature, or None (untyped, or a street or POI).

    Older Mapbox rows list several types; Berlin is ``["region", "place"]``.
    The finest one counts, as the parsers file a name repeated across levels.
    """
    value = feature.get("place_type")
    candidates = value if isinstance(value, list) else [value]
    levels = [
        _ALIASES.get(candidate, candidate)
        for candidate in candidates
        if isinstance(candidate, str)
    ]
    return next((level for level in _RANKED if level in levels), None)


def _features(geolocation_json: Mapping[str, object]) -> list[Mapping[str, object]]:
    features = geolocation_json.get("features")
    if not isinstance(features, list):
        return []
    return [feature for feature in features if isinstance(feature, Mapping)]


def _text(feature: Mapping[str, object]) -> str:
    text = feature.get("text")
    return text.strip() if isinstance(text, str) else ""


def _typed_names(features: Sequence[Mapping[str, object]]) -> dict[str, str]:
    """The first name of each ranked level the features have."""
    names: dict[str, str] = {}
    for feature in features:
        level = _feature_type(feature)
        text = _text(feature)
        if level and text:
            names.setdefault(level, text)
    return names


def _search_order(level: PlaceLevel) -> list[str]:
    """``level``, then the finer levels nearest first, then the coarser ones."""
    index = _RANKED.index(level)
    return [level, *reversed(_RANKED[:index]), *_RANKED[index + 1 :]]


def _untyped_names(
    geolocation_json: Mapping[str, object], features: Sequence[Mapping[str, object]]
) -> list[str]:
    if features:
        return [_text(feature) for feature in features]
    places = geolocation_json.get("places")
    if not isinstance(places, list):
        return []
    return [place.strip() if isinstance(place, str) else "" for place in places]


def place_name(
    geolocation_json: object,
    level: PlaceLevel,
    *,
    untyped_index: int | None = None,
) -> str | None:
    """The name of ``level`` in a reverse-geocoded place, or None without one.

    A typed row answers the feature of that level; without it, the nearest
    finer level, then the nearest coarser one (streets and POIs never). An
    untyped row answers the name at ``untyped_index`` from the end (default
    ``UNTYPED_INDEX[level]``), None when it has fewer names: each consumer
    passes the position it read before, so stored rows keep their names.
    """
    if not isinstance(geolocation_json, Mapping):
        return None
    features = _features(geolocation_json)
    typed = _typed_names(features)
    if typed:
        return next(
            (typed[name] for name in _search_order(level) if name in typed), None
        )
    index = UNTYPED_INDEX[level] if untyped_index is None else untyped_index
    names = _untyped_names(geolocation_json, features)
    if len(names) < abs(index):
        return None
    return names[index] or None


def town_name(geolocation_json: object) -> str | None:
    """The town a photo was taken in, as the day albums name it.

    Typed rows: the city level. Untyped rows: the next to last name, as
    ``add_location_to_album_dates`` always picked it.
    """
    return place_name(geolocation_json, "city", untyped_index=DAY_ALBUM_UNTYPED_INDEX)


def short_place_name(geolocation_json: object) -> str | None:
    """``town_name``, or the only name of an untyped row that has just one.

    For the places a selection or an event is named after, where one name
    (a row from a provider that answered just "Berlin") is better than none.
    """
    name = town_name(geolocation_json)
    if name or not isinstance(geolocation_json, Mapping):
        return name
    names = _untyped_names(geolocation_json, _features(geolocation_json))
    return (names[0] or None) if len(names) == 1 else None
