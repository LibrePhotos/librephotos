from django.test import TestCase
from rest_framework.test import APIClient

from api.tests.utils import (
    create_test_photo,
    create_test_user,
    share_test_photos,
)


class PhotoViewSetPermissionsTest(TestCase):
    def setUp(self):
        self.owner = create_test_user()
        self.other_user = create_test_user()
        self.photo = create_test_photo(owner=self.owner)
        self.url = f"/api/photos/{self.photo.image_hash}/"

    def test_owner_can_update_photo(self):
        client = APIClient()
        client.force_authenticate(user=self.owner)

        response = client.patch(self.url, {"rating": 5}, format="json")

        self.assertEqual(200, response.status_code)
        self.photo.refresh_from_db()
        self.assertEqual(5, self.photo.rating)

    def test_non_owner_cannot_update_photo(self):
        share_test_photos([self.photo.image_hash], self.other_user)
        client = APIClient()
        client.force_authenticate(user=self.other_user)

        response = client.patch(self.url, {"rating": 3}, format="json")

        self.assertEqual(403, response.status_code)
        self.photo.refresh_from_db()
        self.assertNotEqual(3, self.photo.rating)
