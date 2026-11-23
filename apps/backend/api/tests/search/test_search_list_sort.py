from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from api.tests.utils import create_test_photo, create_test_user

SEARCH_URL = "/api/photos/searchlist/"


def _hashes_of_grouped(response):
    return [
        item["image_hash"]
        for group in response.data["results"]
        for item in group.get("items", [])
    ]


def _hashes_of_flat(response):
    return [item["image_hash"] for item in response.data["results"]]


class SearchListSortTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        day = timezone.now()
        self.small = create_test_photo(owner=self.user, size=100, exif_timestamp=day)
        self.large = create_test_photo(owner=self.user, size=900, exif_timestamp=day)
        self.medium = create_test_photo(owner=self.user, size=500, exif_timestamp=day)

    def test_sort_largest_answers_a_flat_list_largest_first(self):
        response = self.client.get(SEARCH_URL, {"sort": "largest"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            _hashes_of_flat(response),
            [
                self.large.image_hash,
                self.medium.image_hash,
                self.small.image_hash,
            ],
        )

    def test_sort_smallest_answers_a_flat_list_smallest_first(self):
        response = self.client.get(SEARCH_URL, {"sort": "smallest"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            _hashes_of_flat(response),
            [
                self.small.image_hash,
                self.medium.image_hash,
                self.large.image_hash,
            ],
        )

    def test_sorted_flat_list_carries_each_photo_size(self):
        response = self.client.get(SEARCH_URL, {"sort": "largest"})
        self.assertEqual(response.status_code, 200)
        sizes = {item["image_hash"]: item["size"] for item in response.data["results"]}
        self.assertEqual(sizes[self.small.image_hash], 100)
        self.assertEqual(sizes[self.large.image_hash], 900)

    def test_sort_largest_still_filters_by_media_type(self):
        video = create_test_photo(
            owner=self.user, video=True, size=5000, exif_timestamp=timezone.now()
        )
        response = self.client.get(SEARCH_URL, {"sort": "largest", "video": "true"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(_hashes_of_flat(response), [video.image_hash])

    def test_default_sort_groups_by_day_newest_first(self):
        older = timezone.now() - timezone.timedelta(days=3)
        old_photo = create_test_photo(owner=self.user, size=1, exif_timestamp=older)
        response = self.client.get(SEARCH_URL)
        self.assertEqual(response.status_code, 200)
        groups = response.data["results"]
        self.assertEqual(len(groups), 2)
        self.assertNotIn(
            old_photo.image_hash,
            [item["image_hash"] for item in groups[0]["items"]],
        )
        self.assertIn(
            old_photo.image_hash,
            [item["image_hash"] for item in groups[1]["items"]],
        )

    def test_sort_oldest_groups_by_day_oldest_first(self):
        older = timezone.now() - timezone.timedelta(days=3)
        old_photo = create_test_photo(owner=self.user, size=1, exif_timestamp=older)
        response = self.client.get(SEARCH_URL, {"sort": "oldest"})
        self.assertEqual(response.status_code, 200)
        groups = response.data["results"]
        self.assertEqual(len(groups), 2)
        self.assertEqual(
            [item["image_hash"] for item in groups[0]["items"]],
            [old_photo.image_hash],
        )

    def test_unknown_sort_is_a_400_naming_sort(self):
        response = self.client.get(SEARCH_URL, {"sort": "weight"})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["errors"][0]["field"], "sort")
