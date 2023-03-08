from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from api.tests.utils import create_test_photos, create_test_user


class PhotoListWithoutTimestampTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user()
        self.client.force_authenticate(user=self.user)

    def test_retrieve_photos_without_exif_timestamp(self):
        now = timezone.now()
        create_test_photos(number_of_photos=1, owner=self.user, added_on=now)
        create_test_photos(
            number_of_photos=1, owner=self.user, added_on=now, exif_timestamp=now
        )

        response = self.client.get("/api/photos/notimestamp/")
        json = response.json()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(1, len(json["results"]))
