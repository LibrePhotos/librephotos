from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from api.tests.utils import create_test_photos, create_test_user


class FavoritePhotosTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user1 = create_test_user(favorite_min_rating=1)
        self.user2 = create_test_user(favorite_min_rating=1)
        self.client.force_authenticate(user=self.user1)

    def test_tag_my_photos_as_favorite(self):
        photos = create_test_photos(number_of_photos=3, owner=self.user1)
        image_hashes = [p.image_hash for p in photos]

        payload = {"image_hashes": image_hashes, "favorite": True}
        headers = {"Content-Type": "application/json"}
        response = self.client.post(
            "/api/photosedit/favorite/", format="json", data=payload, headers=headers
        )
        data = response.json()

        self.assertTrue(data["status"])
        self.assertEqual(3, len(data["results"]))
        self.assertEqual(3, len(data["updated"]))
        self.assertEqual(0, len(data["not_updated"]))

    def test_untag_my_photos_as_favorite(self):
        photos1 = create_test_photos(
            number_of_photos=1, owner=self.user1, rating=self.user1.favorite_min_rating
        )
        photos2 = create_test_photos(number_of_photos=2, owner=self.user1)
        image_hashes = [p.image_hash for p in photos1 + photos2]

        payload = {"image_hashes": image_hashes, "favorite": False}
        headers = {"Content-Type": "application/json"}
        response = self.client.post(
            "/api/photosedit/favorite/", format="json", data=payload, headers=headers
        )
        data = response.json()

        self.assertTrue(data["status"])
        self.assertEqual(1, len(data["results"]))
        self.assertEqual(1, len(data["updated"]))
        self.assertEqual(2, len(data["not_updated"]))

    def test_tag_photos_of_other_user_as_favorite(self):
        photos = create_test_photos(number_of_photos=2, owner=self.user2)
        image_hashes = [p.image_hash for p in photos]

        payload = {"image_hashes": image_hashes, "favorite": True}
        headers = {"Content-Type": "application/json"}
        response = self.client.post(
            "/api/photosedit/favorite/", format="json", data=payload, headers=headers
        )
        data = response.json()

        self.assertTrue(data["status"])
        self.assertEqual(0, len(data["results"]))
        self.assertEqual(0, len(data["updated"]))
        self.assertEqual(2, len(data["not_updated"]))

    @patch("api.views.photos.logger.warning", autospec=True)
    def test_tag_nonexistent_photo_as_favorite(self, logger):
        payload = {"image_hashes": ["nonexistent_photo"], "favorite": True}
        headers = {"Content-Type": "application/json"}
        response = self.client.post(
            "/api/photosedit/favorite/", format="json", data=payload, headers=headers
        )
        data = response.json()

        self.assertTrue(data["status"])
        self.assertEqual(0, len(data["results"]))
        self.assertEqual(0, len(data["updated"]))
        self.assertEqual(0, len(data["not_updated"]))
        logger.assert_called_with(
            "Could not set photo nonexistent_photo to favorite. It does not exist."
        )
