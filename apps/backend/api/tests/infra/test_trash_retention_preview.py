"""GET /api/sitesettings/trash-retention-preview/ (#2203).

Before an admin turns the trash retention on or shortens it, the Site
settings card says how many photos the next daily cleanup would delete. The
count covers every user's trash, like the cleanup, so only admins may ask.
"""

from datetime import timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from api.tests.utils import create_test_photo, create_test_user

URL = "/api/sitesettings/trash-retention-preview/"


def _trashed(owner, days_ago: int, **kwargs):
    return create_test_photo(
        owner=owner,
        in_trashcan=True,
        trashed_at=timezone.now() - timedelta(days=days_ago),
        **kwargs,
    )


class TrashRetentionPreviewTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = create_test_user(is_admin=True)
        self.alice = create_test_user()
        self.bob = create_test_user()

    def preview(self, days: object):
        self.client.force_authenticate(user=self.admin)
        return self.client.get(URL, {"days": days})

    def test_counts_every_users_photos_past_the_retention(self):
        _trashed(self.alice, 40)
        _trashed(self.alice, 31)
        _trashed(self.bob, 90)

        response = self.preview(30)

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(
            response.json(), {"days": 30, "photo_count": 3, "user_count": 2}
        )

    def test_leaves_out_what_the_cleanup_keeps(self):
        _trashed(self.alice, 5)  # inside the retention
        _trashed(self.alice, 40, removed=True)  # already deleted
        create_test_photo(owner=self.bob, in_trashcan=True, trashed_at=None)
        create_test_photo(owner=self.bob)  # not in the trash

        response = self.preview(30)

        self.assertEqual(
            response.json(), {"days": 30, "photo_count": 0, "user_count": 0}
        )

    def test_days_must_be_a_retention(self):
        for days in ("", "abc", 0, -3, 36501):
            with self.subTest(days=days):
                response = self.preview(days)

                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json()["errors"][0]["field"], "days")

    def test_days_is_required(self):
        self.client.force_authenticate(user=self.admin)

        response = self.client.get(URL)

        self.assertEqual(response.status_code, 400)

    def test_a_user_cannot_count_other_users_trash(self):
        _trashed(self.bob, 90)
        self.client.force_authenticate(user=self.alice)

        response = self.client.get(URL, {"days": 30})

        self.assertEqual(response.status_code, 403)

    def test_anonymous_is_refused(self):
        response = self.client.get(URL, {"days": 30})

        self.assertEqual(response.status_code, 401)
