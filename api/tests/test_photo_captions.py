from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from api.tests.utils import create_test_photo, create_test_user


class PhotoCaptionsTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user1 = create_test_user()
        self.user2 = create_test_user()
        self.client.force_authenticate(user=self.user1)

    @patch("api.models.Photo._generate_captions_im2txt", autospec=True)
    def test_generate_captions_for_my_photo(self, generate_caption_mock):
        generate_caption_mock.return_value = True
        photo = create_test_photo(owner=self.user1)

        payload = {"image_hash": photo.image_hash}
        headers = {"Content-Type": "application/json"}
        response = self.client.post(
            "/api/photosedit/generateim2txt/",
            format="json",
            data=payload,
            headers=headers,
        )
        data = response.json()

        self.assertTrue(data["status"])

    @patch("api.models.Photo._generate_captions_im2txt", autospec=True)
    def test_fail_to_generate_captions_for_my_photo(self, generate_caption_mock):
        generate_caption_mock.return_value = False
        photo = create_test_photo(owner=self.user1)

        payload = {"image_hash": photo.image_hash}
        headers = {"Content-Type": "application/json"}
        response = self.client.post(
            "/api/photosedit/generateim2txt/",
            format="json",
            data=payload,
            headers=headers,
        )
        data = response.json()

        self.assertFalse(data["status"])

    def test_generate_captions_for_my_photo_of_another_user(self):
        photo = create_test_photo(owner=self.user2)

        payload = {"image_hash": photo.image_hash}
        headers = {"Content-Type": "application/json"}
        response = self.client.post(
            "/api/photosedit/generateim2txt/",
            format="json",
            data=payload,
            headers=headers,
        )
        data = response.json()

        self.assertEqual(400, response.status_code)
        self.assertFalse(data["status"])
        self.assertEqual("you are not the owner of this photo", data["message"])
