"""The owner opens their own hidden and trashed photos; nobody else does.

The Hidden and Trash pages open the lightbox, which reads the photo detail and
edits through /api/photos/edit/. Both used to go through Photo.visible, so the
owner got a 404 for every photo on those pages.
"""

from django.test import TestCase
from rest_framework.test import APIClient

from api.tests.utils import create_test_photo, create_test_user


class HiddenAndTrashedPhotoDetailTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = create_test_user()
        self.other = create_test_user()
        self.hidden = create_test_photo(owner=self.owner, hidden=True)
        self.trashed = create_test_photo(owner=self.owner, in_trashcan=True)

    def _get(self, photo):
        return self.client.get(f"/api/photos/{photo.image_hash}/")

    def test_owner_opens_a_hidden_photo(self):
        self.client.force_authenticate(user=self.owner)
        response = self._get(self.hidden)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["hidden"])

    def test_owner_opens_a_trashed_photo(self):
        self.client.force_authenticate(user=self.owner)
        response = self._get(self.trashed)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["in_trashcan"])

    def test_owner_opens_a_hidden_photo_by_uuid(self):
        self.client.force_authenticate(user=self.owner)
        response = self.client.get(f"/api/photos/{self.hidden.pk}/")
        self.assertEqual(response.status_code, 200)

    def test_a_removed_photo_stays_not_found(self):
        removed = create_test_photo(owner=self.owner, removed=True)
        self.client.force_authenticate(user=self.owner)
        self.assertEqual(self._get(removed).status_code, 404)

    def test_a_hidden_photo_shared_to_someone_else_is_not_found_for_them(self):
        self.hidden.shared_to.add(self.other)
        self.client.force_authenticate(user=self.other)
        self.assertEqual(self._get(self.hidden).status_code, 404)

    def test_a_hidden_public_photo_is_not_found_anonymously(self):
        photo = create_test_photo(owner=self.owner, hidden=True, public=True)
        self.client.force_authenticate(user=None)
        self.assertEqual(self._get(photo).status_code, 404)

    def test_a_visible_photo_shared_to_someone_still_opens_once(self):
        photo = create_test_photo(owner=self.owner)
        photo.shared_to.add(self.other)
        self.client.force_authenticate(user=self.other)
        response = self._get(photo)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["image_hash"], photo.image_hash)

    def test_owner_edits_a_hidden_photo(self):
        self.client.force_authenticate(user=self.owner)
        response = self.client.patch(
            f"/api/photos/edit/{self.hidden.image_hash}/",
            {"is_screenshot": True},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.hidden.refresh_from_db()
        self.assertTrue(self.hidden.is_screenshot)

    def test_someone_else_cannot_edit_a_hidden_photo(self):
        self.hidden.shared_to.add(self.other)
        self.client.force_authenticate(user=self.other)
        response = self.client.patch(
            f"/api/photos/edit/{self.hidden.image_hash}/",
            {"is_screenshot": True},
            format="json",
        )
        self.assertEqual(response.status_code, 404)
        self.hidden.refresh_from_db()
        self.assertFalse(self.hidden.is_screenshot)


class PhotoListNeedsSignInTest(TestCase):
    """GET /api/photos/ rendered every public photo for anyone, a sidecar call each."""

    def setUp(self):
        self.owner = create_test_user()
        self.photo = create_test_photo(owner=self.owner, public=True)

    def test_anonymous_cannot_list_photos(self):
        response = APIClient().get("/api/photos/")
        self.assertIn(response.status_code, (401, 403))

    def test_anonymous_still_opens_a_public_photo(self):
        response = APIClient().get(f"/api/photos/{self.photo.image_hash}/")
        self.assertEqual(response.status_code, 200)

    def test_a_signed_in_user_still_lists_photos(self):
        client = APIClient()
        client.force_authenticate(user=self.owner)
        self.assertEqual(client.get("/api/photos/").status_code, 200)
