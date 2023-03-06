from datetime import timedelta
from unittest import skip

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


class RecentlyAddedPhotosTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user1 = create_test_user()
        self.user2 = create_test_user()

    def test_retrieve_recently_added_photos(self):
        today = timezone.now()
        before_today = timezone.now() - timedelta(days=1)
        create_photos(number_of_photos=3, owner=self.user1, added_on=today)
        create_photos(number_of_photos=4, owner=self.user1, added_on=before_today)
        create_photos(number_of_photos=5, owner=self.user2, added_on=today)

        self.client.force_authenticate(user=self.user1)
        response = self.client.get("/api/photos/recentlyadded/")
        json = response.json()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(3, len(json["results"]))

    @skip("not implemented yet")
    # TODO: implement scenario
    def test_retrieve_empty_result_when_no_photos(self):
        Photo.objects.delete()
        self.client.force_authenticate(user=self.user1)
        response = self.client.get("/api/photos/recentlyadded/")
        json = response.json()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(0, len(json["results"]))
