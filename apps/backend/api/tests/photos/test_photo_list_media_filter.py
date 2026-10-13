"""The media filter on Recently added, No timestamp and Trash (#2216).

Recently added and No timestamp take the same ``photo`` / ``video`` /
``is_screenshot`` / ``is_document`` flags as the date-album endpoints, and
nothing else: the user's saved timeline default is for ``/`` only. Trash is
a date-album list, so its select-all purge must reach only the photos the
filter shows.
"""

from datetime import timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from api.tests.utils import create_test_photo, create_test_user


def _kinds(owner, **fields):
    """One still, video, screenshot and document of ``owner``, by name."""
    return {
        "still": create_test_photo(owner=owner, **fields),
        "video": create_test_photo(owner=owner, video=True, **fields),
        "screenshot": create_test_photo(owner=owner, is_screenshot=True, **fields),
        "document": create_test_photo(owner=owner, is_document=True, **fields),
    }


# The flag a list is asked for, and the photo kinds it then answers.
MEDIA_CASES = {
    "photo=true": {"still", "screenshot", "document"},
    "video=true": {"video"},
    "is_screenshot=true": {"screenshot"},
    "is_document=true": {"document"},
    "is_document=false": {"still", "video", "screenshot"},
}


class _MediaListTestCase(TestCase):
    url = ""

    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user()
        self.client.force_authenticate(user=self.user)

    def _hashes(self, query: str = "") -> set[str]:
        response = self.client.get(f"{self.url}?{query}" if query else self.url)
        self.assertEqual(response.status_code, 200)
        return {row["image_hash"] for row in response.json()["results"]}

    def _assert_media_cases(self, photos: dict) -> None:
        names = {photo.image_hash: name for name, photo in photos.items()}
        self.assertEqual({names[h] for h in self._hashes()}, set(photos))
        for query, expected in MEDIA_CASES.items():
            with self.subTest(query=query):
                self.assertEqual({names[h] for h in self._hashes(query)}, expected)

    def _assert_saved_default_ignored(self) -> None:
        # A default that hides documents on "/" must not leak into this list,
        # even when a client asks for it.
        self.user.default_timeline_filter = {"hide_documents": True, "media": "videos"}
        self.user.save(update_fields=["default_timeline_filter"])
        self.assertEqual(len(self._hashes()), 4)
        self.assertEqual(len(self._hashes("apply_default=true")), 4)


class RecentlyAddedMediaFilterTest(_MediaListTestCase):
    url = "/api/photos/recentlyadded/"

    def test_flags_narrow_the_latest_day(self):
        self._assert_media_cases(_kinds(self.user, added_on=timezone.now()))

    def test_saved_default_is_ignored(self):
        _kinds(self.user, added_on=timezone.now())
        self._assert_saved_default_ignored()

    def test_latest_day_is_the_latest_matching_upload(self):
        yesterday = timezone.now() - timedelta(days=1)
        old_video = create_test_photo(owner=self.user, video=True, added_on=yesterday)
        create_test_photo(owner=self.user, added_on=timezone.now())

        response = self.client.get(f"{self.url}?video=true")
        data = response.json()

        self.assertEqual(
            [row["image_hash"] for row in data["results"]], [old_video.image_hash]
        )
        self.assertEqual(data["date"][:10], yesterday.isoformat()[:10])

    def test_no_match_answers_no_day(self):
        create_test_photo(owner=self.user, added_on=timezone.now())

        data = self.client.get(f"{self.url}?is_document=true").json()

        self.assertEqual(data, {"date": None, "results": []})


class NoTimestampMediaFilterTest(_MediaListTestCase):
    url = "/api/photos/notimestamp/"

    def test_flags_narrow_the_list(self):
        photos = _kinds(self.user, added_on=timezone.now())
        # A dated video stays out whatever the filter.
        create_test_photo(
            owner=self.user,
            video=True,
            added_on=timezone.now(),
            exif_timestamp=timezone.now(),
        )
        self._assert_media_cases(photos)

    def test_saved_default_is_ignored(self):
        _kinds(self.user, added_on=timezone.now())
        self._assert_saved_default_ignored()

    def test_count_follows_the_filter(self):
        _kinds(self.user, added_on=timezone.now())

        self.assertEqual(self.client.get(f"{self.url}?video=true").json()["count"], 1)


class TrashSelectAllPurgeMediaFilterTest(TestCase):
    """Trash filtered to videos, then "select all, delete permanently"."""

    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user()
        self.client.force_authenticate(user=self.user)

    def test_purge_reaches_only_the_filtered_photos(self):
        trashed = _kinds(self.user, in_trashcan=True)
        payload = {"select_all": True, "query": {"in_trashcan": True, "video": True}}

        response = self.client.delete(
            "/api/photosedit/delete/", format="json", data=payload
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["count"], 1)
        for name, photo in trashed.items():
            photo.refresh_from_db()
            with self.subTest(photo=name):
                self.assertEqual(photo.removed, name == "video")
                self.assertTrue(photo.in_trashcan)

    def test_document_filter_purges_only_documents(self):
        trashed = _kinds(self.user, in_trashcan=True)
        payload = {
            "select_all": True,
            "query": {"in_trashcan": True, "is_document": True},
        }

        response = self.client.delete(
            "/api/photosedit/delete/", format="json", data=payload
        )

        self.assertEqual(response.json()["count"], 1)
        trashed["document"].refresh_from_db()
        trashed["still"].refresh_from_db()
        self.assertTrue(trashed["document"].removed)
        self.assertFalse(trashed["still"].removed)
