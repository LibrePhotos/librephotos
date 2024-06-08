import logging
import unittest.mock
from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from api.tests.utils import create_test_photos, create_test_user

logger = logging.getLogger(__name__)


class PublicPhotosTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user1 = create_test_user()
        self.user2 = create_test_user()
        self.client.force_authenticate(user=self.user1)

    def test_set_my_photos_as_public(self):
        photos = create_test_photos(number_of_photos=3, owner=self.user1)
        image_hashes = [p.image_hash for p in photos]

        payload = {"image_hashes": image_hashes, "val_public": True}
        headers = {"Content-Type": "application/json"}
        response = self.client.post(
            "/api/photosedit/makepublic/", format="json", data=payload, headers=headers
        )
        data = response.json()

        self.assertTrue(data["status"])
        self.assertEqual(3, len(data["results"]))
        self.assertEqual(3, len(data["updated"]))
        self.assertEqual(0, len(data["not_updated"]))

    def test_set_my_photos_as_private(self):
        photos = create_test_photos(number_of_photos=2, owner=self.user1, public=True)
        image_hashes = [p.image_hash for p in photos]

        payload = {"image_hashes": image_hashes, "val_public": False}
        headers = {"Content-Type": "application/json"}
        response = self.client.post(
            "/api/photosedit/makepublic/", format="json", data=payload, headers=headers
        )
        data = response.json()

        self.assertTrue(data["status"])
        self.assertEqual(2, len(data["results"]))
        self.assertEqual(2, len(data["updated"]))
        self.assertEqual(0, len(data["not_updated"]))

    def test_set_photos_of_other_user_as_public(self):
        photos = create_test_photos(number_of_photos=2, owner=self.user2)
        image_hashes = [p.image_hash for p in photos]

        payload = {"image_hashes": image_hashes, "val_public": True}
        headers = {"Content-Type": "application/json"}
        response = self.client.post(
            "/api/photosedit/makepublic/", format="json", data=payload, headers=headers
        )
        data = response.json()

        self.assertTrue(data["status"])
        self.assertEqual(0, len(data["results"]))
        self.assertEqual(0, len(data["updated"]))
        self.assertEqual(2, len(data["not_updated"]))

    @patch("api.views.photos.logger.warning", autospec=True)
    def test_tag_nonexistent_photo_as_favorite(self, logger_ext: unittest.mock.Mock):
        payload = {"image_hashes": ["nonexistent_photo"], "val_public": True}
        headers = {"Content-Type": "application/json"}
        response = self.client.post(
            "/api/photosedit/makepublic/", format="json", data=payload, headers=headers
        )
        data = response.json()
        logger.debug(data)

        self.assertTrue(data["status"])
        self.assertEqual(0, len(data["results"]))
        self.assertEqual(0, len(data["updated"]))
        self.assertEqual(0, len(data["not_updated"]))
        logger_ext.assert_called_with(
            "Could not set photo nonexistent_photo to public. It does not exist."
        )
