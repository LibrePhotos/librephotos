"""A public album photo of unknown size reports 0 x 0, never null.

PhotoMetadata.width/height are nullable. With camera info shared they were
sent as null, which the public client's schema rejects, so a visitor lost the
whole info panel of that photo.
"""

from django.test import TestCase
from rest_framework.test import APIClient

from api.models import AlbumUser
from api.models.album_user_share import AlbumUserShare
from api.tests.utils import create_test_photo, create_test_user


class PublicPhotoDetailDimensionsTest(TestCase):
    def setUp(self):
        self.owner = create_test_user()
        self.album = AlbumUser.objects.create(title="trip", owner=self.owner)
        AlbumUserShare.objects.create(
            album=self.album, enabled=True, slug="trip", share_camera_info=True
        )

    def _detail(self, photo):
        self.album.photos.add(photo)
        response = APIClient().get(
            f"/api/public/albums/s/trip/photos/{photo.image_hash}/"
        )
        self.assertEqual(response.status_code, 200)
        return response.json()["results"]

    def test_an_unknown_size_is_zero(self):
        results = self._detail(create_test_photo(owner=self.owner, camera="X100"))
        self.assertIn("X100", results["camera"])  # camera info is shared
        self.assertEqual((results["width"], results["height"]), (0, 0))

    def test_a_known_size_is_shared(self):
        photo = create_test_photo(owner=self.owner, width=4000, height=3000)
        results = self._detail(photo)
        self.assertEqual((results["width"], results["height"]), (4000, 3000))
