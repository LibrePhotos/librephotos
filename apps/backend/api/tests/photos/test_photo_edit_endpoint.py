from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from api.tests.utils import create_test_photo, create_test_user


class EditPhotoDetailsTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user1 = create_test_user()
        self.user2 = create_test_user()
        self.client.force_authenticate(user=self.user1)

    @patch("api.models.Photo._extract_date_time_from_exif", autospec=True)
    def test_should_update_timestamp(self, extract_date_time_from_exif_mock):
        photo = create_test_photo(owner=self.user1)

        payload = {"exif_timestamp": "1970-01-01T00:00:00.001Z"}
        headers = {"Content-Type": "application/json"}
        response = self.client.patch(
            f"/api/photos/edit/{photo.image_hash}/",
            format="json",
            data=payload,
            headers=headers,
        )
        data = response.json()

        self.assertEqual(200, response.status_code)
        self.assertEqual("1970-01-01T00:00:00.001000Z", data["timestamp"])
        self.assertEqual(photo.image_hash, data["image_hash"])
        self.assertIsNone(data["exif_timestamp"])
        self.assertEqual(0, data["rating"])
        self.assertFalse(data["hidden"])
        self.assertFalse(data["in_trashcan"])
        self.assertFalse(data["video"])
        extract_date_time_from_exif_mock.assert_called()

    @patch("api.models.Photo._extract_date_time_from_exif", autospec=True)
    def test_should_not_update_other_properties(self, extract_date_time_from_exif_mock):
        photo = create_test_photo(owner=self.user1)

        payload = {
            "timestamp": "1970-01-01T00:00:00.001Z",
            "image_hash": "BLAH-BLAH-BLAH-BLAH",
            "rating": 100,
            "deleted": True,
            "hidden": True,
            "in_trashcan": True,
            "video": True,
        }
        headers = {"Content-Type": "application/json"}
        response = self.client.patch(
            f"/api/photos/edit/{photo.image_hash}/",
            format="json",
            data=payload,
            headers=headers,
        )
        data = response.json()

        self.assertEqual(200, response.status_code)
        self.assertNotEqual(payload["timestamp"], data["timestamp"])
        self.assertNotEqual(payload["image_hash"], data["image_hash"])
        self.assertNotEqual(payload["rating"], data["rating"])
        self.assertNotEqual(payload["hidden"], data["hidden"])
        self.assertNotEqual(payload["in_trashcan"], data["in_trashcan"])
        self.assertNotEqual(payload["video"], data["video"])
        extract_date_time_from_exif_mock.assert_not_called()
