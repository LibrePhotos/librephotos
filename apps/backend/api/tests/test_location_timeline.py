import csv
import os
from unittest import TestCase

from rest_framework.test import APIClient

from api.api_util import get_location_timeline, get_photo_month_counts
from api.models import Photo
from api.tests.utils import create_test_photo, create_test_user


def prepare_database(user):
    data = (
        os.path.dirname(os.path.abspath(__file__))
        + "/fixtures/location_timeline_test_data.csv"
    )
    with open(data) as f:
        reader = csv.reader(f)
        for row in reader:
            if row[0].startswith("#"):
                continue
            country = row[0]
            exif_timestamp = row[1]
            geolocation_json = {"places": [country], "features": [{"text": country}]}
            create_test_photo(
                owner=user,
                exif_timestamp=exif_timestamp,
                geolocation_json=geolocation_json,
            )


expected_location_timeline = [
    {
        "data": [22208418.0],
        "color": "#a6cee3",
        "loc": "Germany",
        "start": 1576286343.0,
        "end": 1598494761.0,
    },
    {
        "data": [9413609.0],
        "color": "#1f78b4",
        "loc": "Canada",
        "start": 1598494761.0,
        "end": 1607908370.0,
    },
    {
        "data": [20648022.0],
        "color": "#b2df8a",
        "loc": "France",
        "start": 1607908370.0,
        "end": 1628556392.0,
    },
    {
        "data": [6132785.0],
        "color": "#33a02c",
        "loc": "Canada",
        "start": 1628556392.0,
        "end": 1634689177.0,
    },
    {
        "data": [79828.0],
        "color": "#fb9a99",
        "loc": "France",
        "start": 1634689177.0,
        "end": 1634769005.0,
    },
]

expected_photo_month_counts = [
    {"month": "2019-12", "count": 4},
    {"month": "2020-1", "count": 0},
    {"month": "2020-2", "count": 0},
    {"month": "2020-3", "count": 0},
    {"month": "2020-4", "count": 0},
    {"month": "2020-5", "count": 0},
    {"month": "2020-6", "count": 0},
    {"month": "2020-7", "count": 0},
    {"month": "2020-8", "count": 4},
    {"month": "2020-9", "count": 0},
    {"month": "2020-10", "count": 0},
    {"month": "2020-11", "count": 0},
    {"month": "2020-12", "count": 4},
    {"month": "2021-1", "count": 0},
    {"month": "2021-2", "count": 0},
    {"month": "2021-3", "count": 0},
    {"month": "2021-4", "count": 0},
    {"month": "2021-5", "count": 0},
    {"month": "2021-6", "count": 0},
    {"month": "2021-7", "count": 0},
    {"month": "2021-8", "count": 4},
    {"month": "2021-9", "count": 0},
    {"month": "2021-10", "count": 4},
]


class LocationTimelineTest(TestCase):
    def setUp(self) -> None:
        self.user = create_test_user()
        self.client = APIClient()
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

    def test_get_photo_month_counts_endpoint(self):
        response = self.client.get("/api/photomonthcounts/")
        result = response.json()
        self.assertEqual(result, expected_photo_month_counts)

    def test_get_photo_month_count(self):
        result = get_photo_month_counts(self.user)
        self.assertEqual(result, expected_photo_month_counts)
