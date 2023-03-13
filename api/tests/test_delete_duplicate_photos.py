from unittest import skip
from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from api.tests.utils import create_test_photo, create_test_user


class DeleteDuplicatePhotosTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user1 = create_test_user()
        self.user2 = create_test_user()
        self.client.force_authenticate(user=self.user1)

    @patch("api.models.Photo.delete_duplicate")
    def test_delete_duplicate_photos_success(self, delete_photo_mock):
        delete_photo_mock.return_value = True
        image = create_test_photo(owner=self.user1)

        response = self.client.delete(
            "/api/photosedit/duplicate/delete",
            format="json",
            data={"image_hash": image.image_hash, "path": "/path/to/file"},
            headers={"Content-Type": "application/json"},
        )

        self.assertEqual(200, response.status_code)

    @patch("api.models.Photo.delete_duplicate")
    def test_delete_duplicate_photos_failure(self, delete_photo_mock):
        delete_photo_mock.return_value = False
        image = create_test_photo(owner=self.user1)

        response = self.client.delete(
            "/api/photosedit/duplicate/delete",
            format="json",
            data={"image_hash": image.image_hash, "path": "/path/to/file"},
            headers={"Content-Type": "application/json"},
        )

        self.assertEqual(400, response.status_code)

    @skip("BUG?: currently user can delete duplicates of other user")
    def test_delete_duplicate_photos_of_other_user(self):
        pass

    def test_delete_non_existent_duplicate_photos(self):
        response = self.client.delete(
            "/api/photosedit/duplicate/delete",
            format="json",
            data={"image_hash": "non-existent-photo-hash", "path": "/path/to/file"},
            headers={"Content-Type": "application/json"},
        )

        self.assertEqual(404, response.status_code)
