from api.geocode import GEOCODE_VERSION


def parse(location):
    data = location.raw["components"]
    center = location.raw["geometry"]
    props = [
        data["_type"],
        "road",
        "suburb",
        "municipality",
        "hamlet",
        "town" "city",
        "borough",
        "state",
        "county",
        "country",
    ]
    places = [data[prop] for prop in props if prop in data]
    return {
        "features": [{"text": place} for place in places],
        "places": places,
        "address": location.address,
        "center": [center["lat"], center["lng"]],
        "_v": GEOCODE_VERSION,
    }
