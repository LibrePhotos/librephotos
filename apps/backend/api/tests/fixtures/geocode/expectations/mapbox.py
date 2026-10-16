from api.geocode import GEOCODE_VERSION

expectations = [
    {
        "features": [
            {
                "text": "Beach Road",
                "center": [-33.888012425, 151.275216500055],
                "place_type": "street",
            },
            {
                "text": "Bondi Beach",
                "center": [-33.888012425, 151.275216500055],
                "place_type": "locality",
            },
            {
                "text": "Sydney",
                "center": [-33.888012425, 151.275216500055],
                "place_type": "city",
            },
            {
                "text": "New South Wales",
                "center": [-33.888012425, 151.275216500055],
                "place_type": "region",
            },
            {
                "text": "Australia",
                "center": [-33.888012425, 151.275216500055],
                "place_type": "country",
            },
        ],
        "places": [
            "Beach Road",
            "Bondi Beach",
            "Sydney",
            "New South Wales",
            "Australia",
        ],
        "address": "17 Beach Road, Bondi Beach New South Wales 2026, Australia",
        "center": [-33.888012425, 151.275216500055],
        "provider": "mapbox",
        "_v": GEOCODE_VERSION,
    },
    {
        "features": [
            {
                "text": "Fire Route 47",
                "center": [44.5540639, -78.1955566],
                "place_type": "street",
            },
            {
                "text": "Lakefield",
                "center": [44.5540639, -78.1955566],
                "place_type": "city",
            },
            {
                "text": "Peterborough County",
                "center": [44.5540639, -78.1955566],
                "place_type": "subregion",
            },
            {
                "text": "Ontario",
                "center": [44.5540639, -78.1955566],
                "place_type": "region",
            },
            {
                "text": "Canada",
                "center": [44.5540639, -78.1955566],
                "place_type": "country",
            },
        ],
        "places": [
            "Fire Route 47",
            "Lakefield",
            "Peterborough County",
            "Ontario",
            "Canada",
        ],
        "address": "2880 Fire Route 47, Lakefield, Ontario K0L 2H0, Canada",
        "center": [44.5540639, -78.1955566],
        "provider": "mapbox",
        "_v": GEOCODE_VERSION,
    },
    {
        "features": [
            {"text": "Roncalli", "center": [52.501711, 13.381502], "place_type": "poi"},
            {
                "text": "Kreuzberg",
                "center": [52.501711, 13.381502],
                "place_type": "locality",
            },
            {"text": "Berlin", "center": [52.501711, 13.381502], "place_type": "city"},
            {
                "text": "Germany",
                "center": [52.501711, 13.381502],
                "place_type": "country",
            },
        ],
        "places": ["Roncalli", "Kreuzberg", "Berlin", "Germany"],
        "address": "Roncalli, Mckernstr, Berlin, 10963, Germany",
        "center": [52.501711, 13.381502],
        "provider": "mapbox",
        "_v": GEOCODE_VERSION,
    },
    {
        "features": [
            {
                "text": "Lakeshore Road",
                "center": [33.913368523661, 78.45710763764029],
                "place_type": "street",
            },
            {
                "text": "Shachokol",
                "center": [33.913368523661, 78.45710763764029],
                "place_type": "locality",
            },
            {
                "text": "Leh",
                "center": [33.913368523661, 78.45710763764029],
                "place_type": "city",
            },
            {
                "text": "Ladakh",
                "center": [33.913368523661, 78.45710763764029],
                "place_type": "region",
            },
            {
                "text": "India",
                "center": [33.913368523661, 78.45710763764029],
                "place_type": "country",
            },
        ],
        "places": ["Lakeshore Road", "Shachokol", "Leh", "Ladakh", "India"],
        "address": "Lakeshore Road ، 194201 Leh، India",
        "center": [33.913368523661, 78.45710763764029],
        "provider": "mapbox",
        "_v": GEOCODE_VERSION,
    },
    {
        "features": [
            {
                "text": "Mahon Rock Pool",
                "center": [-33.94292, 151.263303],
                "place_type": "poi",
            },
            {
                "text": "Maroubra",
                "center": [-33.94292, 151.263303],
                "place_type": "locality",
            },
            {"text": "Sydney", "center": [-33.94292, 151.263303], "place_type": "city"},
            {
                "text": "New South Wales",
                "center": [-33.94292, 151.263303],
                "place_type": "region",
            },
            {
                "text": "Australia",
                "center": [-33.94292, 151.263303],
                "place_type": "country",
            },
        ],
        "places": [
            "Mahon Rock Pool",
            "Maroubra",
            "Sydney",
            "New South Wales",
            "Australia",
        ],
        "address": "Mahon Rock Pool, Marine Pde., Sydney, New South Wales, Australia",
        "center": [-33.94292, 151.263303],
        "provider": "mapbox",
        "_v": GEOCODE_VERSION,
    },
    {
        "features": [
            {
                "text": "Main Bazaar",
                "center": [34.1622089, 77.585527],
                "place_type": "street",
            },
            {
                "text": "Chuchat Yakma",
                "center": [34.1622089, 77.585527],
                "place_type": "locality",
            },
            {"text": "Leh", "center": [34.1622089, 77.585527], "place_type": "city"},
            {
                "text": "Ladakh",
                "center": [34.1622089, 77.585527],
                "place_type": "region",
            },
            {
                "text": "India",
                "center": [34.1622089, 77.585527],
                "place_type": "country",
            },
        ],
        "places": ["Main Bazaar", "Chuchat Yakma", "Leh", "Ladakh", "India"],
        "address": "Main Bazaar ، 194101 Leh، India",
        "center": [34.1622089, 77.585527],
        "provider": "mapbox",
        "_v": GEOCODE_VERSION,
    },
]
