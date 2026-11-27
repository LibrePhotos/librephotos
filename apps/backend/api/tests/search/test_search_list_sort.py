from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from api.search.semantic import TAG_THING_TYPE
from api.tests.utils import (
    create_test_album_thing,
    create_test_library_share,
    create_test_photo,
    create_test_user,
)

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
        self.user = create_test_user(semantic_search_topk=0)
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

    def test_size_sort_counts_every_match(self):
        response = self.client.get(SEARCH_URL, {"sort": "largest"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 3)

    def test_grouped_answer_has_no_count(self):
        response = self.client.get(SEARCH_URL, {"sort": "oldest"})
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("count", response.data)


class SearchListSizeSortCapTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        day = timezone.now()
        self.photos = [
            create_test_photo(owner=self.user, size=size, exif_timestamp=day)
            for size in (300, 100, 400, 200)
        ]

    def test_largest_answers_the_capped_largest_with_the_total(self):
        with patch("api.views.search.SIZE_SORT_LIMIT", 2):
            response = self.client.get(SEARCH_URL, {"sort": "largest"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            _hashes_of_flat(response),
            [self.photos[2].image_hash, self.photos[0].image_hash],
        )
        self.assertEqual(response.data["count"], 4)

    def test_smallest_answers_the_capped_smallest_with_the_total(self):
        with patch("api.views.search.SIZE_SORT_LIMIT", 2):
            response = self.client.get(SEARCH_URL, {"sort": "smallest"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            _hashes_of_flat(response),
            [self.photos[1].image_hash, self.photos[3].image_hash],
        )
        self.assertEqual(response.data["count"], 4)

    def test_the_cap_is_a_thousand(self):
        from api.views.search import SIZE_SORT_LIMIT

        self.assertEqual(SIZE_SORT_LIMIT, 1000)


class SearchListSizeSortUnknownSizeTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        day = timezone.now()
        self.unknown = create_test_photo(owner=self.user, size=0, exif_timestamp=day)
        self.small = create_test_photo(owner=self.user, size=10, exif_timestamp=day)
        self.large = create_test_photo(owner=self.user, size=90, exif_timestamp=day)

    def test_unknown_size_comes_last_in_both_size_sorts(self):
        expected = {
            "largest": [self.large, self.small, self.unknown],
            "smallest": [self.small, self.large, self.unknown],
        }
        for sort, photos in expected.items():
            with self.subTest(sort=sort):
                response = self.client.get(SEARCH_URL, {"sort": sort})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(
                    _hashes_of_flat(response), [photo.image_hash for photo in photos]
                )


class SearchListSizeSortVisibilityTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        day = timezone.now()
        self.shown = create_test_photo(owner=self.user, size=10, exif_timestamp=day)
        for flags in ({"hidden": True}, {"in_trashcan": True}, {"removed": True}):
            create_test_photo(owner=self.user, size=9000, exif_timestamp=day, **flags)
        create_test_photo(owner=create_test_user(), size=8000, exif_timestamp=day)

    def test_hidden_trashed_removed_and_others_photos_stay_out(self):
        for sort in ("largest", "smallest"):
            with self.subTest(sort=sort):
                response = self.client.get(SEARCH_URL, {"sort": sort})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(_hashes_of_flat(response), [self.shown.image_hash])
                self.assertEqual(response.data["count"], 1)


class SearchListSizeSortSharedLibraryTest(TestCase):
    def setUp(self):
        self.owner = create_test_user()
        self.recipient = create_test_user()
        day = timezone.now()
        self.shared = create_test_photo(owner=self.owner, size=700, exif_timestamp=day)
        thing = create_test_album_thing(
            owner=self.owner, title="tram", thing_type=TAG_THING_TYPE
        )
        thing.photos.add(self.shared)
        self.own = create_test_photo(
            owner=self.recipient,
            size=300,
            exif_timestamp=day,
            search_captions="a tram in the rain",
        )
        create_test_library_share(
            owner=self.owner, recipient=self.recipient, show_in_timeline=True
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.recipient)

    def test_shared_matches_join_the_size_order_with_their_size(self):
        for sort, photos in {
            "largest": [self.shared, self.own],
            "smallest": [self.own, self.shared],
        }.items():
            with self.subTest(sort=sort):
                response = self.client.get(SEARCH_URL, {"search": "tram", "sort": sort})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(
                    _hashes_of_flat(response), [photo.image_hash for photo in photos]
                )
                sizes = {
                    item["image_hash"]: item["size"]
                    for item in response.data["results"]
                }
                self.assertEqual(sizes[self.shared.image_hash], 700)
                self.assertEqual(response.data["count"], 2)


class SearchListSizeSortSemanticTest(TestCase):
    def setUp(self):
        self.user = create_test_user(semantic_search_topk=10)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        day = timezone.now()
        self.text_match = create_test_photo(
            owner=self.user,
            size=100,
            exif_timestamp=day,
            search_captions="a dog on the beach",
        )
        self.semantic_match = create_test_photo(
            owner=self.user,
            size=500,
            exif_timestamp=day,
            search_captions="a city at night",
        )
        create_test_photo(
            owner=self.user, size=900, exif_timestamp=day, search_captions="a tree"
        )

    def _search(self, sort):
        with (
            patch(
                "api.search.ranked.calculate_query_embeddings",
                return_value=([0.1] * 512, 1.0),
            ),
            patch(
                "api.search.ranked.search_ranked_embedding",
                return_value=[(self.semantic_match.image_hash, 0.3)],
            ),
        ):
            return self.client.get(SEARCH_URL, {"search": "beach", "sort": sort})

    def test_semantic_matches_are_ordered_by_size(self):
        expected = {
            "largest": [self.semantic_match, self.text_match],
            "smallest": [self.text_match, self.semantic_match],
        }
        for sort, photos in expected.items():
            with self.subTest(sort=sort):
                response = self._search(sort)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(
                    _hashes_of_flat(response), [photo.image_hash for photo in photos]
                )
                self.assertEqual(response.data["count"], 2)
