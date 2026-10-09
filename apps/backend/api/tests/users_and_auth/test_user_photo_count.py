"""The admin's user list counts the photos the user's Library page counts.

``photo_count`` counted every row the user owns, hidden, trashed and missing
photos included, so the Users table showed more photos than the user's own
Library card for the same library.
"""

from django.test import TestCase
from rest_framework.test import APIClient

from api.tests.utils import create_test_photo, create_test_user


class UserPhotoCountTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        create_test_photo(owner=self.user)
        for flag in ("hidden", "in_trashcan", "removed"):
            photo = create_test_photo(owner=self.user)
            setattr(photo, flag, True)
            photo.save(update_fields=[flag])
        self.client = APIClient()
        self.client.force_authenticate(user=create_test_user(is_admin=True))

    def _count(self, url):
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        rows = response.json()["results"]
        return next(u for u in rows if u["id"] == self.user.id)["photo_count"]

    def test_the_admin_user_list(self):
        self.assertEqual(self._count("/api/manage/user/"), 1)

    def test_the_user_list(self):
        self.assertEqual(self._count("/api/user/"), 1)

    def test_it_matches_the_library_stats(self):
        client = APIClient()
        client.force_authenticate(user=self.user)
        stats = client.get("/api/stats/").json()
        self.assertEqual(stats["num_photos"], self._count("/api/manage/user/"))
