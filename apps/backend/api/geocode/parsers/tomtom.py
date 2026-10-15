from geopy.location import Location

from api.geocode.parsers.levels import typed_place
from api.models.place_names import PlaceType

# TomTom's address parts the place is named from, in the order they are
# listed, and the level each one is (#2302).
PROPS: tuple[tuple[str, PlaceType], ...] = (
    ("street", "street"),
    ("streetName", "street"),
    ("municipalitySubdivision", "locality"),
    ("countrySubdivision", "region"),
    ("countrySecondarySubdivision", "subregion"),
    ("municipality", "city"),
    ("municipalitySubdivision", "locality"),
    ("country", "country"),
)


def parse(location: Location) -> dict[str, object]:
    data = location.raw["address"]
    center = list(map(lambda x: float(x), location.raw["position"].split(",")))
    named = [
        (data[prop], place_type)
        for prop, place_type in PROPS
        if prop in data and len(data[prop]) > 2
    ]
    return typed_place("tomtom", named, location.address, center)
