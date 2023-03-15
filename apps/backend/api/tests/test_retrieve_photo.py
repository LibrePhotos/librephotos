from django.test import TestCase
from rest_framework.test import APIClient

from api.tests.utils import create_test_photo, create_test_user


class RetrievePhotoTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = create_test_user(is_admin=True)
        self.user = create_test_user()

    def test_should_retrieve_my_photo(self):
        self.client.force_authenticate(user=self.user)
        photo = create_test_photo(owner=self.user)

        headers = {"Content-Type": "application/json"}
        response = self.client.get(
            f"/api/photos/{photo.image_hash}/",
            format="json",
            headers=headers,
        )

        self.assertEqual(200, response.status_code)

    def test_should_not_retrieve_other_user_photo(self):
        self.client.force_authenticate(user=self.user)
        photo = create_test_photo(owner=self.admin)

        headers = {"Content-Type": "application/json"}
        response = self.client.get(
            f"/api/photos/{photo.image_hash}/",
            format="json",
            headers=headers,
        )

        self.assertEqual(403, response.status_code)

    def test_anonymous_user_should_retrieve_public_photo(self):
        self.client.force_authenticate(None)
        photo = create_test_photo(owner=self.user, public=True)

        headers = {"Content-Type": "application/json"}
        response = self.client.get(
            f"/api/photos/{photo.image_hash}/",
            format="json",
            headers=headers,
        )

        self.assertEqual(200, response.status_code)

    def test_anonymous_user_should_not_retrieve_private_photo(self):
        self.client.force_authenticate(None)
        photo = create_test_photo(owner=self.user, public=False)

        headers = {"Content-Type": "application/json"}
        response = self.client.get(
            f"/api/photos/{photo.image_hash}/",
            format="json",
            headers=headers,
        )

        self.assertEqual(404, response.status_code)
