from functools import reduce

from api.geocode import GEOCODE_VERSION


def _dedup(iterable):
    unique_items = set()

    def reducer(acc, item):
        if item not in unique_items:
            unique_items.add(item)
            acc.append(item)
        return acc

    return reduce(reducer, iterable, [])


def parse(location):
    data = location.raw["address"]
    address = location.address
    center = list(map(lambda x: float(x), location.raw["position"].split(",")))
    props = [
        "street",
        "streetName",
        "municipalitySubdivision",
        "countrySubdivision",
        "countrySecondarySubdivision",
        "municipality",
        "municipalitySubdivision",
        "country",
    ]
    places = _dedup(
        [data[prop] for prop in props if prop in data and len(data[prop]) > 2]
    )
    return {
        "features": [{"text": place, "center": center} for place in places],
        "places": places,
        "address": address,
        "center": center,
        "_v": GEOCODE_VERSION,
    }
