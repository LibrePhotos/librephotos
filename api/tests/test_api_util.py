from django.test import TestCase
from rest_framework.test import APIClient

from api.tests.fixtures.api_util.expectation import wordcloud_expectation
from api.tests.fixtures.api_util.photos import photos
from api.tests.fixtures.api_util.sunburst_expectation import (
    expectation as sunburst_expectation,
)
from api.tests.utils import create_test_photo, create_test_user


def create_photos(user):
    for p in photos:
        create_test_photo(owner=user, **p)


def compare_objects_with_ignored_props(result, expectation, ignore):
    if isinstance(result, dict) and isinstance(expectation, dict):
        result_copy = {k: v for k, v in result.items() if k != ignore}
        expectation_copy = {k: v for k, v in expectation.items() if k != ignore}
        return all(
            compare_objects_with_ignored_props(
                result_copy[k], expectation_copy[k], ignore
            )
            for k in result_copy
        ) and set(result_copy.keys()) == set(expectation_copy.keys())
    if isinstance(result, list) and isinstance(expectation, list):
        return len(result) == len(expectation) and all(
            compare_objects_with_ignored_props(res, exp, ignore)
            for res, exp in zip(result, expectation)
        )
    return result == expectation


class TestApiUtil(TestCase):
    def setUp(self) -> None:
        self.client = APIClient()
        self.user = create_test_user()
        self.client.force_authenticate(user=self.user)

    def test_wordcloud(self):
        create_photos(self.user)
        response = self.client.get("/api/wordcloud/")
        actual = response.json()
        self.assertEqual(actual, wordcloud_expectation)

    def test_photo_month_count(self):
        create_photos(self.user)
        response = self.client.get("/api/photomonthcounts/")
        actual = response.json()
        self.assertEqual(
            actual,
            [
                {"month": "2017-8", "count": 6},
                {"month": "2017-9", "count": 0},
                {"month": "2017-10", "count": 3},
            ],
        )

    def test_photo_month_count_no_photos(self):
        response = self.client.get("/api/photomonthcounts/")
        actual = response.json()
        self.assertEqual(actual, [])

    def test_location_sunburst(self):
        create_photos(self.user)
        response = self.client.get("/api/locationsunburst/")
        actual = response.json()
        assert compare_objects_with_ignored_props(
            actual, sunburst_expectation, ignore="hex"
        )
