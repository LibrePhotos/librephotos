from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from api.models import AlbumDate
from api.tests.utils import create_test_photo, create_test_user


class AlbumDatePhotoOrderingTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        timestamp = timezone.now()
        self.photos_by_filename = {}

        for filename in ("d.png", "b.png", "a.png", "c.png"):
            photo = create_test_photo(owner=self.user, exif_timestamp=timestamp)
            photo.main_file.path = f"/tmp/{filename}"
            photo.main_file.save(update_fields=["path"])
            self.photos_by_filename[filename] = photo

        self.album = AlbumDate.objects.create(
            date=timestamp.date(),
            owner=self.user,
        )
        self.album.photos.add(*self.photos_by_filename.values())

    def _page_hashes(self, page):
        response = self.client.get(
            f"/api/albums/date/{self.album.id}/",
            {"page": page, "size": 2},
        )
        self.assertEqual(response.status_code, 200)
        return [item["image_hash"] for item in response.json()["results"]["items"]]

    def test_equal_timestamps_are_ordered_before_pagination(self):
        hashes = self._page_hashes(1) + self._page_hashes(2)

        self.assertEqual(
            hashes,
            [
                self.photos_by_filename[filename].image_hash
                for filename in ("a.png", "b.png", "c.png", "d.png")
            ],
        )
