from api.geocode import GEOCODE_VERSION

expectations = [
    {
        "features": [
            {
                "text": "Beach Road",
                "center": [-33.888145, 151.275085],
                "place_type": "street",
            },
            {
                "text": "Bondi Beach",
                "center": [-33.888145, 151.275085],
                "place_type": "locality",
            },
            {
                "text": "New South Wales",
                "center": [-33.888145, 151.275085],
                "place_type": "region",
            },
            {
                "text": "Sydney",
                "center": [-33.888145, 151.275085],
                "place_type": "city",
            },
            {
                "text": "Australia",
                "center": [-33.888145, 151.275085],
                "place_type": "country",
            },
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
        "provider": "tomtom",
        "_v": GEOCODE_VERSION,
    },
    {
        "features": [
            {
                "text": "Fire Route 47",
                "center": [44.553463, -78.195114],
                "place_type": "street",
            },
            {
                "text": "Lakefield",
                "center": [44.553463, -78.195114],
                "place_type": "city",
            },
            {
                "text": "Canada",
                "center": [44.553463, -78.195114],
                "place_type": "country",
            },
        ],
        "places": ["Fire Route 47", "Lakefield", "Canada"],
        "address": "2876 Fire Route 47, Lakefield ON K0L 2H0",
        "center": [44.553463, -78.195114],
        "provider": "tomtom",
        "_v": GEOCODE_VERSION,
    },
    {
        "features": [
            {
                "text": "Möckernstraße",
                "center": [52.501957, 13.382298],
                "place_type": "street",
            },
            {
                "text": "Kreuzberg",
                "center": [52.501957, 13.382298],
                "place_type": "locality",
            },
            {"text": "Berlin", "center": [52.501957, 13.382298], "place_type": "city"},
            {
                "text": "Deutschland",
                "center": [52.501957, 13.382298],
                "place_type": "country",
            },
        ],
        "places": ["Möckernstraße", "Kreuzberg", "Berlin", "Deutschland"],
        "address": "Möckernstraße 138, 10963 Berlin",
        "center": [52.501957, 13.382298],
        "provider": "tomtom",
        "_v": GEOCODE_VERSION,
    },
    {
        "features": [
            {
                "text": "Thiksey",
                "center": [33.913391, 78.457077],
                "place_type": "locality",
            },
            {"text": "Ladakh", "center": [33.913391, 78.457077], "place_type": "city"},
            {
                "text": "Leh",
                "center": [33.913391, 78.457077],
                "place_type": "subregion",
            },
            {
                "text": "India",
                "center": [33.913391, 78.457077],
                "place_type": "country",
            },
        ],
        "places": ["Thiksey", "Ladakh", "Leh", "India"],
        "address": "Thiksey, Ladakh 194101, Ladakh",
        "center": [33.913391, 78.457077],
        "provider": "tomtom",
        "_v": GEOCODE_VERSION,
    },
    {
        "features": [
            {
                "text": "Marine Parade",
                "center": [-33.943535, 151.26181],
                "place_type": "street",
            },
            {
                "text": "Maroubra",
                "center": [-33.943535, 151.26181],
                "place_type": "locality",
            },
            {
                "text": "New South Wales",
                "center": [-33.943535, 151.26181],
                "place_type": "region",
            },
            {"text": "Sydney", "center": [-33.943535, 151.26181], "place_type": "city"},
            {
                "text": "Australia",
                "center": [-33.943535, 151.26181],
                "place_type": "country",
            },
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
        "provider": "tomtom",
        "_v": GEOCODE_VERSION,
    },
    {
        "features": [
            {
                "text": "Leh Ladakh",
                "center": [34.16209, 77.585808],
                "place_type": "locality",
            },
            {"text": "Ladakh", "center": [34.16209, 77.585808], "place_type": "city"},
            {"text": "Leh", "center": [34.16209, 77.585808], "place_type": "subregion"},
            {"text": "India", "center": [34.16209, 77.585808], "place_type": "country"},
        ],
        "places": ["Leh Ladakh", "Ladakh", "Leh", "India"],
        "address": "Leh Ladakh, Ladakh 194101, Ladakh",
        "center": [34.16209, 77.585808],
        "provider": "tomtom",
        "_v": GEOCODE_VERSION,
    },
]
