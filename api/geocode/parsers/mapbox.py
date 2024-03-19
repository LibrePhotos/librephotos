from api.geocode import GEOCODE_VERSION


def parse(location):
    context = location.raw["context"]
    center = [location.raw["center"][1], location.raw["center"][0]]
    local_name = location.raw["text"]
    places = [local_name] + [
        i["text"] for i in context if not i["id"].startswith("post")
    ]
    return {
        "features": [{"text": place, "center": center} for place in places],
        "places": places,
        "address": location.address,
        "center": center,
        "_v": GEOCODE_VERSION,
    }
