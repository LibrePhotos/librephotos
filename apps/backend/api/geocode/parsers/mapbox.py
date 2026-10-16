from geopy.location import Location

from api.geocode.parsers.levels import typed_place
from api.models.place_names import PlaceType

# Mapbox's feature types (the ``place_type`` of the answer, the prefix of each
# context ``id``) and the level each is (#2302).
LEVELS: dict[str, PlaceType] = {
    "address": "street",
    "poi": "poi",
    "neighborhood": "locality",
    "locality": "locality",
    "place": "city",
    "district": "subregion",
    "region": "region",
    "country": "country",
}


def _level(mapbox_type: object) -> PlaceType:
    """The level of a Mapbox type; an unknown one counts as a POI."""
    return LEVELS.get(str(mapbox_type), "poi")


def parse(location: Location) -> dict[str, object]:
    context = location.raw["context"]
    center = [location.raw["center"][1], location.raw["center"][0]]
    own_types = location.raw.get("place_type") or ["poi"]
    named = [(location.raw["text"], _level(own_types[0]))] + [
        (i["text"], _level(i["id"].split(".", 1)[0]))
        for i in context
        if not i["id"].startswith("post")
    ]
    return typed_place("mapbox", named, location.address, center)
