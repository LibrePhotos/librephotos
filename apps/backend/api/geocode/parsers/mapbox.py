def parse(location):
    context = location.raw["context"]
    center = location.raw["center"]
    local_name = location.raw["text"]
    places = [local_name] + [
        i["text"] for i in context if not i["id"].startswith("post")
    ]
    return {
        "features": [{"text": place} for place in places],
        "places": places,
        "address": location.address,
        "center": [center[0], center[1]],
    }
