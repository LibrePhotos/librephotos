from geopy.location import Location

from api.geocode.parsers.levels import typed_place
from api.models.place_names import PlaceType

# OpenCage's components the place is named from, in the order they are
# listed, and the level each one is (#2302). The first is the component the
# answer is about (``_type``: a building, a road, a camp site). The town is
# OpenCage's ``city``, ``town`` or ``village``: until #2302 the parser asked
# for a ``towncity`` component, which OpenCage never sends.
PROPS: tuple[tuple[str, PlaceType], ...] = (
    ("road", "street"),
    ("suburb", "locality"),
    ("municipality", "subregion"),
    ("hamlet", "locality"),
    ("city", "city"),
    ("town", "city"),
    ("village", "city"),
    ("borough", "locality"),
    ("state", "region"),
    ("county", "subregion"),
    ("country", "country"),
)
# The level of the component the answer is about, where it is a level.
OWN_LEVELS: dict[str, PlaceType] = {
    **dict(PROPS),
    "neighbourhood": "locality",
}


def parse(location: Location) -> dict[str, object]:
    data = location.raw["components"]
    center = [location.raw["geometry"]["lat"], location.raw["geometry"]["lng"]]
    own = data["_type"]
    own_level: PlaceType = OWN_LEVELS.get(own, "poi")
    props = [(own, own_level), *PROPS]
    named = [(data[prop], place_type) for prop, place_type in props if prop in data]
    return typed_place("opencage", named, location.address, center)
