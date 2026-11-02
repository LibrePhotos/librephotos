"""The media-category flags reach the mobile delta sync.

``GET /api/sync/photos/`` carries ``is_screenshot`` and ``is_document`` so the
phone can filter its timeline offline, and the feed only re-sends a photo whose
``last_modified`` moved. So every writer of the flags must bump it, including
the ones that skip ``auto_now``: ``save(update_fields=...)`` without
``last_modified`` and ``bulk_update``.
"""

import uuid
from datetime import datetime, timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from api.directory_watcher import processing_jobs
from api.directory_watcher.processing_jobs import classify_media
from api.models import Photo, PhotoOcr
from api.serializers.photos import PhotoEditSerializer
from api.tests.utils import (
    create_test_album_thing,
    create_test_photo,
    create_test_user,
)

RECEIPT_TEXT = "STORE\nTOTAL 12,50 €"


def _age(photo: Photo) -> datetime:
    """Put ``last_modified`` a day back and return that time."""
    before = timezone.now() - timedelta(days=1)
    Photo.objects.filter(pk=photo.pk).update(last_modified=before)
    photo.refresh_from_db()
    return before


class SyncFeedCarriesCategoryFlagsTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_the_feed_carries_both_flags(self):
        screenshot = create_test_photo(owner=self.user, is_screenshot=True)
        document = create_test_photo(owner=self.user, is_document=True)
        plain = create_test_photo(owner=self.user)

        items = self.client.get("/api/sync/photos/").json()["items"]
        flags = {
            item["id"]: (item["is_screenshot"], item["is_document"]) for item in items
        }
        self.assertEqual(flags[str(screenshot.pk)], (True, False))
        self.assertEqual(flags[str(document.pk)], (False, True))
        self.assertEqual(flags[str(plain.pk)], (False, False))


class CategoryWritersBumpLastModifiedTest(TestCase):
    def setUp(self):
        self.user = create_test_user()

    def _tag_receipt(self, photo: Photo) -> None:
        create_test_album_thing(
            title="receipt", thing_type="openclip_vitb32_tag", owner=self.user
        ).photos.add(photo)

    def test_ocr_derived_document_bumps(self):
        photo = create_test_photo(owner=self.user)
        self._tag_receipt(photo)
        before = _age(photo)

        self.assertTrue(processing_jobs._derive_is_document(photo, RECEIPT_TEXT, 0.3))

        photo.refresh_from_db()
        self.assertTrue(photo.is_document)
        self.assertGreater(photo.last_modified, before)

    def test_classify_media_bumps_a_changed_screenshot_flag(self):
        photo = create_test_photo(
            owner=self.user, is_screenshot=True, camera_model="Canon EOS"
        )
        before = _age(photo)

        classify_media(self.user, uuid.uuid4())

        photo.refresh_from_db()
        self.assertFalse(photo.is_screenshot)
        self.assertGreater(photo.last_modified, before)

    def test_classify_media_bumps_a_changed_document_flag(self):
        photo = create_test_photo(owner=self.user, camera_model="Canon EOS")
        PhotoOcr.objects.create(
            photo=photo,
            text=RECEIPT_TEXT,
            engine="ppocrv6_small",
            text_area_fraction=0.3,
        )
        self._tag_receipt(photo)
        before = _age(photo)

        classify_media(self.user, uuid.uuid4())

        photo.refresh_from_db()
        self.assertTrue(photo.is_document)
        self.assertGreater(photo.last_modified, before)

    def test_classify_media_leaves_an_unchanged_photo_alone(self):
        photo = create_test_photo(owner=self.user, camera_model="Canon EOS")
        before = _age(photo)

        classify_media(self.user, uuid.uuid4())

        photo.refresh_from_db()
        self.assertFalse(photo.is_screenshot)
        self.assertEqual(photo.last_modified, before)

    def test_photo_edit_category_override_bumps(self):
        photo = create_test_photo(owner=self.user)
        before = _age(photo)

        serializer = PhotoEditSerializer(
            photo, data={"is_document": True}, partial=True
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)
        serializer.save()

        photo.refresh_from_db()
        self.assertTrue(photo.is_document)
        self.assertEqual(photo.category_source, "user")
        self.assertGreater(photo.last_modified, before)
