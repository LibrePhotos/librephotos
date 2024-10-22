from django.test import TestCase
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from api.tests.utils import create_test_photo, create_test_user


class PhotoSummaryViewTest(TestCase):
    def setUp(self):
        self.user = create_test_user(is_admin=True)
        self.photo = create_test_photo(owner=self.user)
        self.photo.save()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_summary_view_existing_photo_regular_user(self):
        regular_user = create_test_user()

        self.client.force_authenticate(user=regular_user)
        photo = create_test_photo(owner=regular_user)
        url = reverse("photos-summary", kwargs={"pk": photo.image_hash})
        response = self.client.get(url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(response.data["processing"])

    def test_summary_view_existing_photo(self):
        url = reverse("photos-summary", kwargs={"pk": self.photo.image_hash})
        response = self.client.get(url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.assertFalse(response.data["processing"])

    def test_summary_view_nonexistent_photo(self):
        url = reverse("photos-summary", kwargs={"pk": "nonexistent_hash"})
        response = self.client.get(url)

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_summary_view_no_aspect_ratio(self):
        # Simulate the case where aspect_ratio is None
        self.photo.aspect_ratio = None
        self.photo.save()

        url = reverse("photos-summary", kwargs={"pk": self.photo.image_hash})
        response = self.client.get(url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.assertTrue(response.data["processing"])
