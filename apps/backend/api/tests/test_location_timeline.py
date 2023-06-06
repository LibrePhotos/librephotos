import csv
import os
from unittest import TestCase, skip

from rest_framework.test import APIClient

from api.api_util import get_location_timeline, get_location_timeline_orm
from api.models import Photo
from api.tests.utils import create_test_photo, create_test_user


def prepare_database(user):
    data = (
        os.path.dirname(os.path.abspath(__file__))
        + "/fixtures/location_timeline_test_data.csv"
    )
    with open(data, "r") as f:
        reader = csv.reader(f)
        for row in reader:
            if row[0].startswith("#"):
                continue
            country = row[0]
            exif_timestamp = row[1]
            geolocation_json = {"features": [{"text": country}]}
            create_test_photo(
                owner=user,
                exif_timestamp=exif_timestamp,
                geolocation_json=geolocation_json,
            )


expected_location_timeline = [
    {
        "data": [29031374.0],
        "color": "#a6cee3",
        "loc": "Canada",
        "start": 1535336361.0,
        "end": 1564367735.0,
    },
    {
        "data": [11918608.0],
        "color": "#1f78b4",
        "loc": "Australia",
        "start": 1564367735.0,
        "end": 1576286343.0,
    },
    {
        "data": [31622027.0],
        "color": "#b2df8a",
        "loc": "Germany",
        "start": 1576286343.0,
        "end": 1607908370.0,
    },
    {
        "data": [20648022.0],
        "color": "#33a02c",
        "loc": "France",
        "start": 1607908370.0,
        "end": 1628556392.0,
    },
    {
        "data": [6132785.0],
        "color": "#fb9a99",
        "loc": "Canada",
        "start": 1628556392.0,
        "end": 1634689177.0,
    },
    {
        "data": [29030418.0],
        "color": "#e31a1c",
        "loc": "France",
        "start": 1634689177.0,
        "end": 1663719595.0,
    },
    {
        "data": [26007716.0],
        "color": "#fdbf6f",
        "loc": "Japan",
        "start": 1663719595.0,
        "end": 1689727311.0,
    },
    {
        "data": [80993.0],
        "color": "#ff7f00",
        "loc": "China",
        "start": 1689727311.0,
        "end": 1689808304.0,
    },
]

expected_photo_month_counts = [
    {"month": "2018-8", "count": 23},
    {"month": "2018-9", "count": 0},
    {"month": "2018-10", "count": 0},
    {"month": "2018-11", "count": 0},
    {"month": "2018-12", "count": 0},
    {"month": "2019-1", "count": 0},
    {"month": "2019-2", "count": 0},
    {"month": "2019-3", "count": 0},
    {"month": "2019-4", "count": 0},
    {"month": "2019-5", "count": 0},
    {"month": "2019-6", "count": 0},
    {"month": "2019-7", "count": 16},
    {"month": "2019-8", "count": 0},
    {"month": "2019-9", "count": 0},
    {"month": "2019-10", "count": 0},
    {"month": "2019-11", "count": 0},
    {"month": "2019-12", "count": 22},
    {"month": "2020-1", "count": 0},
    {"month": "2020-2", "count": 0},
    {"month": "2020-3", "count": 0},
    {"month": "2020-4", "count": 0},
    {"month": "2020-5", "count": 0},
    {"month": "2020-6", "count": 0},
    {"month": "2020-7", "count": 0},
    {"month": "2020-8", "count": 0},
    {"month": "2020-9", "count": 0},
    {"month": "2020-10", "count": 0},
    {"month": "2020-11", "count": 0},
    {"month": "2020-12", "count": 23},
    {"month": "2021-1", "count": 0},
    {"month": "2021-2", "count": 0},
    {"month": "2021-3", "count": 0},
    {"month": "2021-4", "count": 0},
    {"month": "2021-5", "count": 0},
    {"month": "2021-6", "count": 0},
    {"month": "2021-7", "count": 0},
    {"month": "2021-8", "count": 20},
    {"month": "2021-9", "count": 0},
    {"month": "2021-10", "count": 23},
    {"month": "2021-11", "count": 0},
    {"month": "2021-12", "count": 0},
    {"month": "2022-1", "count": 0},
    {"month": "2022-2", "count": 0},
    {"month": "2022-3", "count": 0},
    {"month": "2022-4", "count": 0},
    {"month": "2022-5", "count": 0},
    {"month": "2022-6", "count": 0},
    {"month": "2022-7", "count": 0},
    {"month": "2022-8", "count": 0},
    {"month": "2022-9", "count": 30},
    {"month": "2022-10", "count": 0},
    {"month": "2022-11", "count": 0},
    {"month": "2022-12", "count": 0},
    {"month": "2023-1", "count": 0},
    {"month": "2023-2", "count": 0},
    {"month": "2023-3", "count": 0},
    {"month": "2023-4", "count": 0},
    {"month": "2023-5", "count": 0},
    {"month": "2023-6", "count": 0},
    {"month": "2023-7", "count": 11},
]


class LocationTimelineTest(TestCase):
    def setUp(self) -> None:
        self.user = create_test_user()
        self.client = APIClient()
        self.user = create_test_user()
        self.client.force_authenticate(user=self.user)
        Photo.objects.all().delete()
        prepare_database(self.user)

    def test_location_timeline_endpoint(self):
        response = self.client.get("/api/locationtimeline/")
        result = response.json()
        self.assertEqual(result, expected_location_timeline)

    def test_get_location_timeline(self):
        result = get_location_timeline(self.user)
        self.assertEqual(result, expected_location_timeline)

    @skip("need to fix")
    def test_get_location_timeline_orm(self):
        result = get_location_timeline_orm(self.user)
        self.assertEqual(result, expected_location_timeline)
