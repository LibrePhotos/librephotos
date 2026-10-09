"""The public users page counts only the public photos a visitor can open.

``Photo.public`` is never cleared when the photo is hidden, trashed or removed
later, and the media view refuses those to visitors, so the card counted (and
sampled) photos nobody could see.
"""

from django.test import TestCase
from rest_framework.test import APIClient

from api.tests.utils import create_test_photo, create_test_user


class PublicPhotoCountTest(TestCase):
    def setUp(self):
        self.user = create_test_user(public_sharing=True)
        self.visible = create_test_photo(owner=self.user, public=True)
        for flag in ("hidden", "in_trashcan", "removed"):
            photo = create_test_photo(owner=self.user, public=True)
            setattr(photo, flag, True)
            photo.save(update_fields=[flag])

    def _row(self, client):
        response = client.get("/api/user/")
        self.assertEqual(response.status_code, 200)
        return next(u for u in response.json()["results"] if u["id"] == self.user.id)

    def _assert_only_the_visible_photo(self, row):
        self.assertEqual(row["public_photo_count"], 1)
        self.assertEqual(
            [p["image_hash"] for p in row["public_photo_samples"]],
            [self.visible.image_hash],
        )

    def test_anonymous_visitors(self):
        self._assert_only_the_visible_photo(self._row(APIClient()))

    def test_admins(self):
        client = APIClient()
        client.force_authenticate(user=create_test_user(is_admin=True))
        self._assert_only_the_visible_photo(self._row(client))
