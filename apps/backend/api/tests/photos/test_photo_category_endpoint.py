"""POST /api/photosedit/category/: fix a wrong media category (issue #2130).

Marks photos as photo, screenshot or document, by hash or select-all, only
ever the requester's own, and pins ``category_source="user"`` so a rescan and
the Classify Media job keep the choice. ``category: "auto"`` hands photos back
to the detectors (the lightbox's Undo of a first correction); clients never
set ``category_source`` themselves. The photo detail endpoint serves the
category read-only, so the lightbox can show it.
"""

import uuid
from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from api.directory_watcher import processing_jobs
from api.directory_watcher.processing_jobs import classify_media
from api.models import PhotoOcr
from api.models.album_thing import AlbumThing
from api.tests.utils import create_test_photo, create_test_user

URL = "/api/photosedit/category/"


class SetPhotosCategoryTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _post(self, body):
        return self.client.post(URL, body, format="json")

    def test_mark_as_screenshot(self):
        photo = create_test_photo(owner=self.user, camera_model="Canon EOS")
        before = photo.last_modified
        response = self._post(
            {"image_hashes": [photo.image_hash], "category": "screenshot"}
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["updated_hashes"], [photo.image_hash])
        photo.refresh_from_db()
        self.assertTrue(photo.is_screenshot)
        self.assertFalse(photo.is_document)
        self.assertEqual(photo.category_source, "user")
        # Mobile delta sync reads last_modified.
        self.assertGreater(photo.last_modified, before)

    def test_categories_are_exclusive(self):
        photo = create_test_photo(owner=self.user, is_screenshot=True)
        self._post({"image_hashes": [photo.image_hash], "category": "document"})
        photo.refresh_from_db()
        self.assertEqual((photo.is_screenshot, photo.is_document), (False, True))

        self._post({"image_hashes": [photo.image_hash], "category": "photo"})
        photo.refresh_from_db()
        self.assertEqual((photo.is_screenshot, photo.is_document), (False, False))
        self.assertEqual(photo.category_source, "user")

    def test_confirming_the_detected_category_pins_it(self):
        # Same flags, but "auto" -> "user" is a change: the choice must stick.
        photo = create_test_photo(owner=self.user)
        response = self._post({"image_hashes": [photo.image_hash], "category": "photo"})
        self.assertEqual(response.json()["updated_hashes"], [photo.image_hash])
        photo.refresh_from_db()
        self.assertEqual(photo.category_source, "user")

    def test_auto_recomputes_both_flags(self):
        # A metadata-less PNG with receipt OCR: the detectors call it both a
        # screenshot and a document. The user said "photo"; "auto" restores
        # what the detectors say, both flags, which a client-sent previous
        # category could not (the UI shows one category).
        photo = create_test_photo(owner=self.user)
        PhotoOcr.objects.create(
            photo=photo, text="STORE\nTOTAL 12,50 EUR", text_area_fraction=0.30
        )
        tag = AlbumThing.objects.create(
            title="receipt", thing_type="siglip2_tag", owner=self.user
        )
        tag.photos.add(photo)
        self._post({"image_hashes": [photo.image_hash], "category": "photo"})
        photo.refresh_from_db()
        before = photo.last_modified

        response = self._post({"image_hashes": [photo.image_hash], "category": "auto"})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["updated_hashes"], [photo.image_hash])
        photo.refresh_from_db()
        self.assertEqual((photo.is_screenshot, photo.is_document), (True, True))
        self.assertEqual(photo.category_source, "auto")
        self.assertGreater(photo.last_modified, before)

    def test_auto_without_ocr_is_not_a_document(self):
        photo = create_test_photo(owner=self.user, camera_model="Canon EOS")
        self._post({"image_hashes": [photo.image_hash], "category": "document"})
        self._post({"image_hashes": [photo.image_hash], "category": "auto"})
        photo.refresh_from_db()
        self.assertEqual((photo.is_screenshot, photo.is_document), (False, False))
        self.assertEqual(photo.category_source, "auto")

    def test_auto_leaves_photos_already_on_automatic(self):
        photo = create_test_photo(owner=self.user, camera_model="Canon EOS")
        response = self._post({"image_hashes": [photo.image_hash], "category": "auto"})
        self.assertEqual(response.json()["not_updated_hashes"], [photo.image_hash])

    def test_client_category_source_is_ignored(self):
        photo = create_test_photo(owner=self.user)
        response = self._post(
            {
                "image_hashes": [photo.image_hash],
                "category": "photo",
                "category_source": "auto",
            }
        )
        self.assertEqual(response.status_code, 200)
        photo.refresh_from_db()
        self.assertEqual(photo.category_source, "user")

    def test_select_all_uses_the_shared_query(self):
        plain = create_test_photo(owner=self.user)
        shot = create_test_photo(owner=self.user, is_screenshot=True)
        doc = create_test_photo(owner=self.user, is_document=True)
        response = self._post(
            {
                "select_all": True,
                "query": {"hide_documents": True},
                "excluded_hashes": [plain.image_hash],
                "category": "document",
            }
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["count"], 1)
        for photo in (plain, shot, doc):
            photo.refresh_from_db()
        self.assertTrue(shot.is_document)
        self.assertEqual(shot.category_source, "user")
        self.assertEqual(plain.category_source, "auto")
        # doc was outside the query: untouched.
        self.assertEqual(doc.category_source, "auto")

    def test_malformed_bodies_are_a_400(self):
        photo = create_test_photo(owner=self.user)
        hashes = [photo.image_hash]
        for body in (
            {"image_hashes": hashes, "category": "video"},
            {"image_hashes": hashes},
            {"image_hashes": hashes, "category": ["photo"]},
            {"image_hashes": hashes, "category": None},
            {"category": "photo"},
            {"category": "photo", "image_hashes": photo.image_hash},
            {"category": "photo", "image_hashes": [1, 2]},
            {"category": "photo", "select_all": True, "query": "all"},
            {"category": "photo", "select_all": True, "excluded_hashes": "x"},
            {"category": "photo", "select_all": "true", "query": {}},
            {"category": "photo", "select_all": True, "excluded_hashes": [None]},
            ["photo"],
        ):
            with self.subTest(body=body):
                self.assertEqual(self._post(body).status_code, 400)
        photo.refresh_from_db()
        self.assertEqual(photo.category_source, "auto")

    def test_videos_are_never_made_screenshots_or_documents(self):
        video = create_test_photo(owner=self.user, video=True)
        still = create_test_photo(owner=self.user, camera_model="Canon EOS")
        for category in ("document", "screenshot"):
            with self.subTest(category=category):
                response = self._post(
                    {
                        "image_hashes": [video.image_hash, still.image_hash],
                        "category": category,
                    }
                )
                self.assertNotIn(video.image_hash, response.json()["updated_hashes"])
                video.refresh_from_db()
                self.assertEqual(
                    (video.is_screenshot, video.is_document), (False, False)
                )
                self.assertEqual(video.category_source, "auto")

        # Select-all "Mark as document" on the timeline leaves videos alone.
        response = self._post({"select_all": True, "query": {}, "category": "document"})
        video.refresh_from_db()
        self.assertFalse(video.is_document)

    def test_photo_clears_a_wrong_flag_on_a_video(self):
        # A screen recording in a Screenshots/ folder is detected as one.
        video = create_test_photo(owner=self.user, video=True, is_screenshot=True)
        response = self._post({"image_hashes": [video.image_hash], "category": "photo"})
        self.assertEqual(response.json()["updated_hashes"], [video.image_hash])
        video.refresh_from_db()
        self.assertFalse(video.is_screenshot)
        self.assertEqual(video.category_source, "user")

    def test_auto_takes_hashes_not_select_all(self):
        photo = create_test_photo(owner=self.user)
        self._post({"image_hashes": [photo.image_hash], "category": "photo"})
        response = self._post({"select_all": True, "query": {}, "category": "auto"})
        self.assertEqual(response.status_code, 400)
        photo.refresh_from_db()
        self.assertEqual(photo.category_source, "user")

    def test_anonymous_is_refused(self):
        photo = create_test_photo(owner=self.user)
        response = APIClient().post(
            URL,
            {"image_hashes": [photo.image_hash], "category": "document"},
            format="json",
        )
        self.assertIn(response.status_code, (401, 403))


class SetPhotosCategoryOwnerScopeTest(TestCase):
    """Another user's photos are never touched, by hash or select-all."""

    def setUp(self):
        self.owner = create_test_user()
        self.other = create_test_user()
        self.photo = create_test_photo(owner=self.owner, public=True)
        self.client = APIClient()
        self.client.force_authenticate(user=self.other)

    def test_hash_of_someone_elses_photo(self):
        response = self.client.post(
            URL,
            {"image_hashes": [self.photo.image_hash], "category": "document"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["count"], 0)
        self.photo.refresh_from_db()
        self.assertFalse(self.photo.is_document)
        self.assertEqual(self.photo.category_source, "auto")

    def test_select_all_never_reaches_someone_else(self):
        response = self.client.post(
            URL,
            {"select_all": True, "query": {"public": True}, "category": "document"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["count"], 0)
        self.photo.refresh_from_db()
        self.assertFalse(self.photo.is_document)


class UserCategorySurvivesClassificationTest(TestCase):
    """A category set through the endpoint survives Classify Media."""

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_classify_media_keeps_user_choice(self):
        # A metadata-less PNG: the detector calls it a screenshot.
        photo = create_test_photo(owner=self.user)
        self.client.post(
            URL,
            {"image_hashes": [photo.image_hash], "category": "photo"},
            format="json",
        )
        with patch.object(processing_jobs.db.connections, "close_all"):
            classify_media(self.user, uuid.uuid4())
        photo.refresh_from_db()
        self.assertFalse(photo.is_screenshot)
        self.assertEqual(photo.category_source, "user")

    def test_classify_media_still_reclassifies_after_auto(self):
        photo = create_test_photo(owner=self.user)
        for category in ("photo", "auto"):
            self.client.post(
                URL,
                {"image_hashes": [photo.image_hash], "category": category},
                format="json",
            )
        photo.is_screenshot = False
        photo.save(update_fields=["is_screenshot"])
        with patch.object(processing_jobs.db.connections, "close_all"):
            classify_media(self.user, uuid.uuid4())
        photo.refresh_from_db()
        self.assertTrue(photo.is_screenshot)


class PhotoDetailCategoryFieldsTest(TestCase):
    def test_detail_serves_category(self):
        user = create_test_user()
        photo = create_test_photo(owner=user, is_document=True, category_source="user")
        client = APIClient()
        client.force_authenticate(user=user)
        data = client.get(f"/api/photos/{photo.image_hash}/").json()
        self.assertEqual(data["is_screenshot"], False)
        self.assertEqual(data["is_document"], True)
        self.assertEqual(data["category_source"], "user")

    def test_photo_patch_cannot_write_the_category(self):
        # PhotoViewSet's PATCH lets an owner write PhotoSerializer fields; the
        # category is read-only there, so category_source stays server-managed.
        user = create_test_user()
        photo = create_test_photo(owner=user)
        client = APIClient()
        client.force_authenticate(user=user)
        response = client.patch(
            f"/api/photos/{photo.image_hash}/",
            {"category_source": "garbage", "is_screenshot": True, "is_document": True},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        photo.refresh_from_db()
        self.assertEqual(photo.category_source, "auto")
        self.assertFalse(photo.is_screenshot)
        self.assertFalse(photo.is_document)


class ClassifyMediaKeepsScreenshotOnDocumentErrorTest(TestCase):
    def test_document_lookup_failure_keeps_screenshot_update(self):
        user = create_test_user()
        photo = create_test_photo(owner=user)  # metadata-less PNG: a screenshot
        with (
            patch.object(processing_jobs.db.connections, "close_all"),
            patch.object(
                processing_jobs, "detect_document", side_effect=RuntimeError("boom")
            ),
        ):
            classify_media(user, uuid.uuid4())
        photo.refresh_from_db()
        self.assertTrue(photo.is_screenshot)
