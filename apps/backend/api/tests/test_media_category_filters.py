"""Filter plumbing, search captions, stats and the manual-override PATCH path
for the screenshot / document media categories.

The pure classifier and the scan/backfill hooks are covered by
``test_media_categories``. This module covers the request-facing surface added
in work package A/2:

* ``?is_screenshot=true`` / ``?is_document=true`` on the bulk-select helper, the
  album-date detail + list endpoints and the semantic-search endpoint,
* ``type: screenshot`` / ``type: document`` tokens in recreated search captions,
* the ``num_screenshots`` / ``num_documents`` count-stats tiles,
* the PATCH override that flips a flag and pins ``category_source="user"`` so a
  subsequent ``classify_media`` backfill leaves it alone.
"""

import uuid

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from api.directory_watcher.processing_jobs import classify_media
from api.models import AlbumDate
from api.models.photo_search import PhotoSearch
from api.stats import get_count_stats
from api.tests.utils import create_test_photo, create_test_photos, create_test_user
from api.views.photo_filters import build_photo_queryset


class BuildPhotoQuerysetMediaCategoryTest(TestCase):
    """The shared bulk-select helper honors is_screenshot / is_document."""

    def setUp(self):
        self.user = create_test_user()

    def test_filters_by_is_screenshot(self):
        create_test_photos(number_of_photos=2, owner=self.user, is_screenshot=False)
        create_test_photos(number_of_photos=3, owner=self.user, is_screenshot=True)

        qs = build_photo_queryset(self.user, {"is_screenshot": True})
        self.assertEqual(qs.count(), 3)

    def test_filters_by_is_document(self):
        create_test_photos(number_of_photos=2, owner=self.user, is_document=False)
        create_test_photos(number_of_photos=4, owner=self.user, is_document=True)

        qs = build_photo_queryset(self.user, {"is_document": True})
        self.assertEqual(qs.count(), 4)

    def test_is_screenshot_combines_with_photo(self):
        # A screenshot that is also a video must be excluded by photo=true.
        create_test_photo(owner=self.user, is_screenshot=True, video=True)
        create_test_photo(owner=self.user, is_screenshot=True, video=False)

        qs = build_photo_queryset(self.user, {"is_screenshot": True, "photo": True})
        self.assertEqual(qs.count(), 1)

    def test_no_category_param_returns_all(self):
        create_test_photos(number_of_photos=2, owner=self.user, is_screenshot=True)
        create_test_photos(number_of_photos=2, owner=self.user, is_screenshot=False)
        self.assertEqual(build_photo_queryset(self.user, {}).count(), 4)


class SearchListMediaCategoryFilterTest(TestCase):
    """The semantic-search endpoint (SemanticSearchFilter) honors the params."""

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        now = timezone.now()
        self.screenshot = create_test_photo(
            owner=self.user, is_screenshot=True, exif_timestamp=now
        )
        self.document = create_test_photo(
            owner=self.user, is_document=True, exif_timestamp=now
        )
        self.plain = create_test_photo(owner=self.user, exif_timestamp=now)

    @staticmethod
    def _hashes(response):
        return {
            item["image_hash"]
            for group in response.json()["results"]
            for item in group["items"]
        }

    def test_no_filter_returns_all(self):
        hashes = self._hashes(self.client.get("/api/photos/searchlist/"))
        self.assertEqual(
            hashes,
            {
                self.screenshot.image_hash,
                self.document.image_hash,
                self.plain.image_hash,
            },
        )

    def test_is_screenshot_filter(self):
        hashes = self._hashes(
            self.client.get("/api/photos/searchlist/", {"is_screenshot": "true"})
        )
        self.assertEqual(hashes, {self.screenshot.image_hash})

    def test_is_document_filter(self):
        hashes = self._hashes(
            self.client.get("/api/photos/searchlist/", {"is_document": "true"})
        )
        self.assertEqual(hashes, {self.document.image_hash})


class AlbumDateMediaCategoryFilterTest(TestCase):
    """Both albums.py filter sites: the date-album detail and the date list."""

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        now = timezone.now()
        self.screenshot = create_test_photo(
            owner=self.user, is_screenshot=True, exif_timestamp=now
        )
        self.plain = create_test_photo(owner=self.user, exif_timestamp=now)
        self.album = AlbumDate.objects.create(owner=self.user, date=now.date())
        self.album.photos.add(self.screenshot, self.plain)

    @staticmethod
    def _detail_hashes(response):
        return {item["image_hash"] for item in response.json()["results"]["items"]}

    def test_date_album_detail_filter(self):
        url = f"/api/albums/date/{self.album.id}/"
        # No filter -> both photos.
        self.assertEqual(
            self._detail_hashes(self.client.get(url)),
            {self.screenshot.image_hash, self.plain.image_hash},
        )
        # is_screenshot -> only the screenshot.
        self.assertEqual(
            self._detail_hashes(self.client.get(url, {"is_screenshot": "true"})),
            {self.screenshot.image_hash},
        )

    def test_date_album_list_filter(self):
        # An album that only contains a non-screenshot must drop out of the
        # is_screenshot=true listing.
        other_date = (timezone.now() - timezone.timedelta(days=30)).date()
        plain_only = AlbumDate.objects.create(owner=self.user, date=other_date)
        plain_only.photos.add(create_test_photo(owner=self.user))

        resp = self.client.get("/api/albums/date/list/")
        self.assertEqual(len(resp.json()["results"]), 2)

        resp = self.client.get("/api/albums/date/list/", {"is_screenshot": "true"})
        ids = {row["id"] for row in resp.json()["results"]}
        self.assertEqual(ids, {str(self.album.id)})


class SearchCaptionMediaCategoryTest(TestCase):
    """recreate_search_captions emits type tokens and search finds them."""

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _recreate(self, photo):
        search_instance, _ = PhotoSearch.objects.get_or_create(photo=photo)
        search_instance.recreate_search_captions()
        search_instance.save()
        return search_instance

    def test_screenshot_token_in_captions(self):
        photo = create_test_photo(owner=self.user, is_screenshot=True)
        search_instance = self._recreate(photo)
        self.assertIn("type: screenshot", search_instance.search_captions)

    def test_document_token_in_captions(self):
        photo = create_test_photo(owner=self.user, is_document=True)
        search_instance = self._recreate(photo)
        self.assertIn("type: document", search_instance.search_captions)

    def test_plain_photo_has_no_category_token(self):
        photo = create_test_photo(owner=self.user)
        search_instance = self._recreate(photo)
        self.assertNotIn("type: screenshot", search_instance.search_captions)
        self.assertNotIn("type: document", search_instance.search_captions)

    def test_searching_screenshot_finds_photo(self):
        now = timezone.now()
        screenshot = create_test_photo(
            owner=self.user, is_screenshot=True, exif_timestamp=now
        )
        plain = create_test_photo(owner=self.user, exif_timestamp=now)
        self._recreate(screenshot)
        self._recreate(plain)

        resp = self.client.get("/api/photos/searchlist/", {"search": "screenshot"})
        hashes = {
            item["image_hash"]
            for group in resp.json()["results"]
            for item in group["items"]
        }
        self.assertIn(screenshot.image_hash, hashes)
        self.assertNotIn(plain.image_hash, hashes)


class CountStatsMediaCategoryTest(TestCase):
    """The count-stats tiles report num_screenshots / num_documents."""

    def setUp(self):
        self.user = create_test_user()

    def test_counts(self):
        create_test_photos(number_of_photos=3, owner=self.user, is_screenshot=True)
        create_test_photos(number_of_photos=2, owner=self.user, is_document=True)
        create_test_photos(number_of_photos=4, owner=self.user)

        stats = get_count_stats(self.user)
        self.assertEqual(stats["num_screenshots"], 3)
        self.assertEqual(stats["num_documents"], 2)
        self.assertEqual(stats["num_photos"], 9)


class ManualOverridePatchTest(TestCase):
    """PATCH /api/photos/edit/<hash>/ flips a category flag and pins
    category_source="user", which the classify_media backfill then respects."""

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_patch_sets_flag_and_marks_user(self):
        # A camera JPEG the detector would NOT call a screenshot.
        photo = create_test_photo(owner=self.user, camera_model="Canon EOS")
        self.assertFalse(photo.is_screenshot)
        self.assertEqual(photo.category_source, "auto")

        resp = self.client.patch(
            f"/api/photos/edit/{photo.image_hash}/",
            {"is_screenshot": True},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)

        photo.refresh_from_db()
        self.assertTrue(photo.is_screenshot)
        self.assertEqual(photo.category_source, "user")

    def test_patch_is_document_marks_user(self):
        photo = create_test_photo(owner=self.user, camera_model="Canon EOS")
        resp = self.client.patch(
            f"/api/photos/edit/{photo.image_hash}/",
            {"is_document": True},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        photo.refresh_from_db()
        self.assertTrue(photo.is_document)
        self.assertEqual(photo.category_source, "user")

    def test_category_source_is_read_only(self):
        # A PNG with no metadata: the detector WOULD mark it a screenshot.
        photo = create_test_photo(owner=self.user)
        resp = self.client.patch(
            f"/api/photos/edit/{photo.image_hash}/",
            {"category_source": "user"},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        photo.refresh_from_db()
        # Client-supplied category_source is ignored; no category flag was
        # written so it stays "auto".
        self.assertEqual(photo.category_source, "auto")

    def test_backfill_respects_user_override(self):
        # Default PNG has no camera metadata -> classify() returns True. A user
        # override to False must survive a classify_media backfill.
        photo = create_test_photo(owner=self.user)
        resp = self.client.patch(
            f"/api/photos/edit/{photo.image_hash}/",
            {"is_screenshot": False},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        photo.refresh_from_db()
        self.assertEqual(photo.category_source, "user")
        self.assertFalse(photo.is_screenshot)

        classify_media(self.user, uuid.uuid4())

        photo.refresh_from_db()
        self.assertFalse(photo.is_screenshot)
        self.assertEqual(photo.category_source, "user")

    def test_backfill_still_categorises_auto_photos(self):
        # Sanity: an untouched auto PNG IS categorised by the backfill.
        photo = create_test_photo(owner=self.user)
        self.assertEqual(photo.category_source, "auto")

        classify_media(self.user, uuid.uuid4())

        photo.refresh_from_db()
        self.assertTrue(photo.is_screenshot)
