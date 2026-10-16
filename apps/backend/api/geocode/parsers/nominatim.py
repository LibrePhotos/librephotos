from geopy.location import Location

from api.geocode.parsers.levels import typed_place
from api.models.place_names import PlaceType

# Nominatim's address parts the place is named from, in the order they are
# listed, and the level each one is (#2302).
PROPS: tuple[tuple[str, PlaceType], ...] = (
    ("road", "street"),
    ("town", "city"),
    ("neighbourhood", "locality"),
    ("suburb", "locality"),
    ("hamlet", "locality"),
    ("borough", "locality"),
    ("city", "city"),
    ("county", "subregion"),
    ("state", "region"),
    ("country", "country"),
)


def parse(location: Location) -> dict[str, object]:
    data = location.raw["address"]
    center = [float(location.raw["lat"]), float(location.raw["lon"])]
    named = [(data[prop], place_type) for prop, place_type in PROPS if prop in data]
    return typed_place("nominatim", named, location.address, center)
