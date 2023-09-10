from api.geocode import GEOCODE_VERSION

expectations = [
    {
        "_v": GEOCODE_VERSION,
        "features": [
            {"text": "Beach Road", "center": [-33.888145, 151.275085]},
            {"text": "Bondi Beach", "center": [-33.888145, 151.275085]},
            {"text": "New South Wales", "center": [-33.888145, 151.275085]},
            {"text": "Sydney", "center": [-33.888145, 151.275085]},
            {"text": "Australia", "center": [-33.888145, 151.275085]},
        ],
        "places": [
            "Beach Road",
            "Bondi Beach",
            "New South Wales",
            "Sydney",
            "Australia",
        ],
        "address": "17 Beach Road, Bondi Beach, New South Wales, 2026",
        "center": [-33.888145, 151.275085],
    },
    {
        "_v": GEOCODE_VERSION,
        "features": [
            {"text": "Fire Route 47", "center": [44.553463, -78.195114]},
            {"text": "Lakefield", "center": [44.553463, -78.195114]},
            {"text": "Canada", "center": [44.553463, -78.195114]},
        ],
        "places": ["Fire Route 47", "Lakefield", "Canada"],
        "address": "2876 Fire Route 47, Lakefield ON K0L 2H0",
        "center": [44.553463, -78.195114],
    },
    {
        "_v": GEOCODE_VERSION,
        "features": [
            {"text": "Möckernstraße", "center": [52.501957, 13.382298]},
            {"text": "Kreuzberg", "center": [52.501957, 13.382298]},
            {"text": "Berlin", "center": [52.501957, 13.382298]},
            {"text": "Deutschland", "center": [52.501957, 13.382298]},
        ],
        "places": ["Möckernstraße", "Kreuzberg", "Berlin", "Deutschland"],
        "address": "Möckernstraße 138, 10963 Berlin",
        "center": [52.501957, 13.382298],
    },
    {
        "_v": GEOCODE_VERSION,
        "features": [
            {"text": "Thiksey", "center": [33.913391, 78.457077]},
            {"text": "Ladakh", "center": [33.913391, 78.457077]},
            {"text": "Leh", "center": [33.913391, 78.457077]},
            {"text": "India", "center": [33.913391, 78.457077]},
        ],
        "places": ["Thiksey", "Ladakh", "Leh", "India"],
        "address": "Thiksey, Ladakh 194101, Ladakh",
        "center": [33.913391, 78.457077],
    },
    {
        "_v": GEOCODE_VERSION,
        "features": [
            {"text": "Marine Parade", "center": [-33.943535, 151.26181]},
            {"text": "Maroubra", "center": [-33.943535, 151.26181]},
            {"text": "New South Wales", "center": [-33.943535, 151.26181]},
            {"text": "Sydney", "center": [-33.943535, 151.26181]},
            {"text": "Australia", "center": [-33.943535, 151.26181]},
        ],
        "places": [
            "Marine Parade",
            "Maroubra",
            "New South Wales",
            "Sydney",
            "Australia",
        ],
        "address": "106 Marine Parade, Maroubra, New South Wales, 2035",
        "center": [-33.943535, 151.26181],
    },
    {
        "_v": GEOCODE_VERSION,
        "features": [
            {"text": "Leh Ladakh", "center": [34.16209, 77.585808]},
            {"text": "Ladakh", "center": [34.16209, 77.585808]},
            {"text": "Leh", "center": [34.16209, 77.585808]},
            {"text": "India", "center": [34.16209, 77.585808]},
        ],
        "places": ["Leh Ladakh", "Ladakh", "Leh", "India"],
        "address": "Leh Ladakh, Ladakh 194101, Ladakh",
        "center": [34.16209, 77.585808],
    },
]
