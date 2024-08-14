from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from api.tests.utils import create_test_photos, create_test_user


class DeletePhotosTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user1 = create_test_user()
        self.user2 = create_test_user()
        self.client.force_authenticate(user=self.user1)

    def test_tag_my_photos_for_removal(self):
        photos = create_test_photos(number_of_photos=3, owner=self.user1)
        image_hashes = [p.image_hash for p in photos]

        payload = {"image_hashes": image_hashes, "deleted": True}
        headers = {"Content-Type": "application/json"}
        response = self.client.post(
            "/api/photosedit/setdeleted/", format="json", data=payload, headers=headers
        )
        data = response.json()

        self.assertTrue(data["status"])
        self.assertEqual(3, len(data["results"]))
        self.assertEqual(3, len(data["updated"]))
        self.assertEqual(0, len(data["not_updated"]))

    def test_untag_my_photos_for_removal(self):
        photos1 = create_test_photos(
            number_of_photos=1, owner=self.user1, in_trashcan=True
        )
        photos2 = create_test_photos(number_of_photos=2, owner=self.user1)
        image_hashes = [p.image_hash for p in photos1 + photos2]

        payload = {"image_hashes": image_hashes, "deleted": False}
        headers = {"Content-Type": "application/json"}
        response = self.client.post(
            "/api/photosedit/setdeleted/", format="json", data=payload, headers=headers
        )
        data = response.json()

        self.assertTrue(data["status"])
        self.assertEqual(1, len(data["results"]))
        self.assertEqual(1, len(data["updated"]))
        self.assertEqual(2, len(data["not_updated"]))

    def test_tag_photos_of_other_user_for_removal(self):
        photos = create_test_photos(number_of_photos=2, owner=self.user2)
        image_hashes = [p.image_hash for p in photos]

        payload = {"image_hashes": image_hashes, "deleted": True}
        headers = {"Content-Type": "application/json"}
        response = self.client.post(
            "/api/photosedit/setdeleted/", format="json", data=payload, headers=headers
        )
        data = response.json()

        self.assertTrue(data["status"])
        self.assertEqual(0, len(data["results"]))
        self.assertEqual(0, len(data["updated"]))
        self.assertEqual(2, len(data["not_updated"]))

    @patch("api.views.photos.logger.warning", autospec=True)
    def test_tag_for_removal_nonexistent_photo(self, logger):
        payload = {"image_hashes": ["nonexistent_photo"], "deleted": True}
        headers = {"Content-Type": "application/json"}
        response = self.client.post(
            "/api/photosedit/setdeleted/", format="json", data=payload, headers=headers
        )
        data = response.json()

        self.assertTrue(data["status"])
        self.assertEqual(0, len(data["results"]))
        self.assertEqual(0, len(data["updated"]))
        self.assertEqual(0, len(data["not_updated"]))
        logger.assert_called_with(
            "Could not set photo nonexistent_photo to hidden. It does not exist."
        )

    def test_delete_tagged_photos_for_removal(self):
        photos_to_delete = create_test_photos(
            number_of_photos=2, owner=self.user1, in_trashcan=True
        )
        photos_to_not_delete = create_test_photos(number_of_photos=3, owner=self.user1)
        image_hashes = [p.image_hash for p in photos_to_delete + photos_to_not_delete]

        payload = {"image_hashes": image_hashes}
        headers = {"Content-Type": "application/json"}
        response = self.client.delete(
            "/api/photosedit/delete/", format="json", data=payload, headers=headers
        )
        data = response.json()

        self.assertTrue(data["status"])
        self.assertEqual(2, len(data["results"]))
        self.assertEqual(2, len(data["deleted"]))
        self.assertEqual(3, len(data["not_deleted"]))

    def test_delete_tagged_photos_of_other_user_for_removal(self):
        photos_to_delete = create_test_photos(
            number_of_photos=5, owner=self.user2, in_trashcan=True
        )
        image_hashes = [p.image_hash for p in photos_to_delete]

        payload = {"image_hashes": image_hashes}
        headers = {"Content-Type": "application/json"}
        response = self.client.delete(
            "/api/photosedit/delete/", format="json", data=payload, headers=headers
        )
        data = response.json()

        self.assertTrue(data["status"])
        self.assertEqual(0, len(data["results"]))
        self.assertEqual(0, len(data["deleted"]))
        self.assertEqual(5, len(data["not_deleted"]))
