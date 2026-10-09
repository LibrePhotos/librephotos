"""POST /api/photosedit/category/: fix a wrong media category (issue #2130).

Marks photos as photo, screenshot or document, by hash or select-all, only
ever the requester's own, and pins ``category_source="user"`` so a rescan and
the Classify Media job keep the choice. ``category_source="auto"`` is accepted
only to undo a change the lightbox just made. The photo detail endpoint serves
the category, so the lightbox can show and change it.
"""

import uuid

from django.test import TestCase
from rest_framework.test import APIClient

from api.directory_watcher.processing_jobs import classify_media
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

    def test_undo_restores_automatic_source(self):
        photo = create_test_photo(owner=self.user, is_screenshot=True)
        self._post({"image_hashes": [photo.image_hash], "category": "photo"})
        response = self._post(
            {
                "image_hashes": [photo.image_hash],
                "category": "screenshot",
                "category_source": "auto",
            }
        )
        self.assertEqual(response.status_code, 200)
        photo.refresh_from_db()
        self.assertTrue(photo.is_screenshot)
        self.assertEqual(photo.category_source, "auto")

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

    def test_rejects_unknown_values(self):
        photo = create_test_photo(owner=self.user)
        for body in (
            {"image_hashes": [photo.image_hash], "category": "video"},
            {"image_hashes": [photo.image_hash]},
            {
                "image_hashes": [photo.image_hash],
                "category": "photo",
                "category_source": "admin",
            },
        ):
            with self.subTest(body=body):
                self.assertEqual(self._post(body).status_code, 400)
        photo.refresh_from_db()
        self.assertEqual(photo.category_source, "auto")

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
        classify_media(self.user, uuid.uuid4())
        photo.refresh_from_db()
        self.assertFalse(photo.is_screenshot)
        self.assertEqual(photo.category_source, "user")

    def test_classify_media_still_reclassifies_after_undo(self):
        photo = create_test_photo(owner=self.user)
        self.client.post(
            URL,
            {
                "image_hashes": [photo.image_hash],
                "category": "photo",
                "category_source": "auto",
            },
            format="json",
        )
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
