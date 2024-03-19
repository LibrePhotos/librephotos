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
    center = [
        float(location.raw["geometry"]["coordinates"][1]),
        float(location.raw["geometry"]["coordinates"][0]),
    ]
    return {
        "features": [{"text": place, "center": center} for place in places],
        "places": places,
        "address": location.address,
        "center": center,
        "_v": GEOCODE_VERSION,
    }
