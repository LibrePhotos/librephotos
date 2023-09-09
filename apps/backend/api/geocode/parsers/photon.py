from api.geocode import GEOCODE_VERSION


def parse(location):
    data = location.raw["properties"]
    props = [
        "street",
        "locality",
        "district",
        "city",
        "state",
        "country",
    ]
    places = [data[prop] for prop in props if prop in data]
    return {
        "features": [{"text": place} for place in places],
        "places": places,
        "address": location.address,
        "center": location.raw["geometry"]["coordinates"],
        "_v": GEOCODE_VERSION,
    }
