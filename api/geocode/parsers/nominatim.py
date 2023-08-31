def parse(location):
    data = location.raw["address"]
    props = [
        "road",
        "town",
        "neighbourhood",
        "suburb",
        "hamlet",
        "borough",
        "city",
        "county",
        "state",
        "country",
    ]
    places = [data[prop] for prop in props if prop in data]
    return {
        "features": [{"text": place} for place in places],
        "places": places,
        "address": location.address,
        "center": [float(location.raw["lat"]), float(location.raw["lon"])],
    }
