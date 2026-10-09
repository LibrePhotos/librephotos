from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from api.tests.utils import create_test_photo, create_test_user

SEARCH_URL = "/api/photos/searchlist/"


def _hashes_in_grouped_response(response):
    """Flatten the date-grouped search response into a set of image hashes."""
    hashes = set()
    for group in response.data["results"]:
        for item in group.get("items", []):
            hashes.add(item["image_hash"])
    return hashes


class SearchMediaTypeFilterTest(TestCase):
    """The search endpoint should honor the video/photo media-type filters.

    semantic_search_topk defaults to 0 for a fresh user, so these exercise the
    date-grouped branch of SearchListViewSet.list without needing the CLIP
    embedding service.
    """

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        # Dated, so both land in one day group; undated media are grouped
        # separately at the end (see
        # test_undated_media_are_grouped_last_under_the_legacy_date).
        timestamp = timezone.now()
        self.photo = create_test_photo(
            owner=self.user, video=False, exif_timestamp=timestamp
        )
        self.video = create_test_photo(
            owner=self.user, video=True, exif_timestamp=timestamp
        )

    def test_video_true_returns_only_videos(self):
        response = self.client.get(SEARCH_URL, {"video": "true"})
        self.assertEqual(response.status_code, 200)
        hashes = _hashes_in_grouped_response(response)
        self.assertIn(self.video.image_hash, hashes)
        self.assertNotIn(self.photo.image_hash, hashes)

    def test_photo_true_returns_only_photos(self):
        response = self.client.get(SEARCH_URL, {"photo": "true"})
        self.assertEqual(response.status_code, 200)
        hashes = _hashes_in_grouped_response(response)
        self.assertIn(self.photo.image_hash, hashes)
        self.assertNotIn(self.video.image_hash, hashes)

    def test_no_media_filter_returns_both(self):
        response = self.client.get(SEARCH_URL)
        self.assertEqual(response.status_code, 200)
        hashes = _hashes_in_grouped_response(response)
        self.assertIn(self.photo.image_hash, hashes)
        self.assertIn(self.video.image_hash, hashes)

    def test_video_takes_precedence_over_photo(self):
        # Mirrors build_photo_queryset: video wins when both are supplied.
        response = self.client.get(SEARCH_URL, {"video": "true", "photo": "true"})
        self.assertEqual(response.status_code, 200)
        hashes = _hashes_in_grouped_response(response)
        self.assertIn(self.video.image_hash, hashes)
        self.assertNotIn(self.photo.image_hash, hashes)

    def test_undated_media_are_grouped_last_under_the_legacy_date(self):
        # Not null, as album details send: installed mobile apps parse this
        # group's date as a string and would fail the whole search.
        undated = create_test_photo(owner=self.user, exif_timestamp=None)
        response = self.client.get(SEARCH_URL)
        self.assertEqual(response.status_code, 200)
        last = response.data["results"][-1]
        self.assertEqual(last["date"], "No timestamp")
        self.assertEqual(
            [item["image_hash"] for item in last["items"]], [undated.image_hash]
        )
