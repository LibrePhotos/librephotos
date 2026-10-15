"""The exif sidecar's ``/geolocate`` answer as a ``geolocation_json`` (#2302).

The same contract as the geopy parsers: ``features`` finest first, ``places``
the same names, ``address``, ``center`` and ``_v``. Each feature also says
which level it is (``place_type``: city, subregion, region, country), and the
result says which provider produced it, the country code and how far the
town is from the photo. ``center`` is the town's position, so the Places map
gets one stable marker per town.
"""

from collections.abc import Mapping

from api.geocode import EXIFTOOL_PROVIDER, GEOCODE_VERSION

# The Geolocation tags that name a level, finest first, and the level each is.
LEVELS = (
    ("GeolocationCity", "city"),
    ("GeolocationSubregion", "subregion"),
    ("GeolocationRegion", "region"),
    ("GeolocationCountry", "country"),
)


def no_place() -> dict[str, object]:
    """No town within reach of the photo: looked up, nothing there.

    Stored like a place, so the photo keeps its position and is not looked up
    again until the position changes, but it joins no Places album.
    """
    return {
        "features": [],
        "places": [],
        "address": "",
        "provider": EXIFTOOL_PROVIDER,
        "_v": GEOCODE_VERSION,
    }


def _position(value: object) -> list[float] | None:
    """ExifTool's ``"46.0200 7.7488"`` as ``[46.02, 7.7488]``; None if unreadable."""
    if not isinstance(value, str):
        return None
    try:
        lat, lon = (float(part) for part in value.split())
    except ValueError:
        return None
    return [lat, lon]


def _names(answer: Mapping[str, object]) -> list[tuple[str, str]]:
    """``(name, place_type)`` per level, finest first, a repeated name once.

    Lisbon is city, subregion and region "Lisbon": one Places album, filed as
    the city.
    """
    names: list[tuple[str, str]] = []
    seen: set[str] = set()
    for tag, place_type in LEVELS:
        value = answer.get(tag)
        name = str(value).strip() if value is not None else ""
        if name and name not in seen:
            seen.add(name)
            names.append((name, place_type))
    return names


def parse(
    answer: Mapping[str, object] | None, lat: float, lon: float
) -> dict[str, object]:
    """The place of one ``/geolocate`` answer for the point *lat*, *lon*.

    None (no town within the cap) is ``no_place()``. A town without a readable
    position is placed at the point looked up.
    """
    names = _names(answer) if answer else []
    if not answer or not names:
        return no_place()
    center = _position(answer.get("GeolocationPosition")) or [lat, lon]
    places = [name for name, _ in names]
    return {
        "features": [
            {"text": name, "center": center, "place_type": place_type}
            for name, place_type in names
        ],
        "places": places,
        "address": ", ".join(places),
        "center": center,
        "provider": EXIFTOOL_PROVIDER,
        **_extras(answer),
        "_v": GEOCODE_VERSION,
    }


def _extras(answer: Mapping[str, object]) -> dict[str, object]:
    """The town's ``country_code`` and ``distance_km`` from the photo, where readable."""
    extras: dict[str, object] = {}
    country_code = answer.get("GeolocationCountryCode")
    if isinstance(country_code, str) and country_code:
        extras["country_code"] = country_code
    distance = answer.get("GeolocationDistance")
    if isinstance(distance, int | float) and not isinstance(distance, bool):
        extras["distance_km"] = float(distance)
    return extras
