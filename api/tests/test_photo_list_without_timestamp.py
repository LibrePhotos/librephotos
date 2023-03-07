from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from api.models import Photo
from api.tests.utils import create_test_user, fake


def create_photos(number_of_photos=1, **kwargs):
    [
        Photo(pk=fake.md5(), aspect_ratio=1, **kwargs).save()
        for _ in range(0, number_of_photos)
    ]


class PhotoListWithoutTimestampTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user()

    def test_retrieve_photos_without_exif_timestamp(self):
        now = timezone.now()
        create_photos(number_of_photos=1, owner=self.user, added_on=now)
        create_photos(
            number_of_photos=1, owner=self.user, added_on=now, exif_timestamp=now
        )

        self.client.force_authenticate(user=self.user)
        response = self.client.get("/api/photos/notimestamp/")
        json = response.json()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(1, len(json["results"]))
