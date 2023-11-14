from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from api.models.album_date import AlbumDate
from api.tests.utils import create_test_photo, create_test_user


class OnlyPhotosOrOnlyVideosTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user()
        self.client.force_authenticate(user=self.user)

    def test_only_photos(self):
        now = timezone.now()
        photo = create_test_photo(owner=self.user, added_on=now, public=True)

        album = AlbumDate(owner=self.user)
        album.id = 1
        album.photos.add(photo)
        album.save()

        response = self.client.get("/api/albums/date/list?photo=true").url
        response = self.client.get(response)

        data = response.json()
        self.assertEqual(1, len(data["results"]))
