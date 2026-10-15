"""The requester's own public photos: ``/api/photos/public/`` (#2686).

The Sharing overview previews the latest few with ``page_size`` and shows the
page's ``count``. It lists only the requester's photos: another user's public
photos are on that user's public page, and an anonymous caller gets nothing.
"""

from datetime import timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from api.tests.utils import create_test_photo, create_test_user

URL = "/api/photos/public/"


class PublicPhotoListTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user()
        self.other = create_test_user()
        self.client.force_authenticate(user=self.user)

    def _get(self, query: str = "") -> dict:
        response = self.client.get(f"{URL}?{query}" if query else URL)
        self.assertEqual(response.status_code, 200, response.content[:300])
        return response.json()

    def _hashes(self, query: str = "") -> list[str]:
        return [row["image_hash"] for row in self._get(query)["results"]]

    def test_lists_only_the_requesters_public_photos(self):
        public = create_test_photo(owner=self.user, public=True)
        create_test_photo(owner=self.user, public=False)
        create_test_photo(owner=self.other, public=True)

        self.assertEqual(self._hashes(), [public.image_hash])

    def test_hidden_and_trashed_public_photos_stay_out(self):
        visible = create_test_photo(owner=self.user, public=True)
        create_test_photo(owner=self.user, public=True, hidden=True)
        create_test_photo(owner=self.user, public=True, in_trashcan=True)

        self.assertEqual(self._hashes(), [visible.image_hash])

    def test_newest_first_with_undated_photos_last(self):
        now = timezone.now()
        old = create_test_photo(
            owner=self.user, public=True, exif_timestamp=now - timedelta(days=9)
        )
        undated = create_test_photo(owner=self.user, public=True, exif_timestamp=None)
        new = create_test_photo(owner=self.user, public=True, exif_timestamp=now)

        self.assertEqual(
            self._hashes(), [new.image_hash, old.image_hash, undated.image_hash]
        )

    def test_page_size_limits_the_rows_but_count_is_every_public_photo(self):
        now = timezone.now()
        photos = [
            create_test_photo(
                owner=self.user, public=True, exif_timestamp=now - timedelta(days=i)
            )
            for i in range(4)
        ]

        body = self._get("page_size=2")

        self.assertEqual(body["count"], 4)
        self.assertEqual(
            [row["image_hash"] for row in body["results"]],
            [photos[0].image_hash, photos[1].image_hash],
        )

    def test_rows_are_photo_summaries(self):
        photo = create_test_photo(owner=self.user, public=True)

        row = self._get()["results"][0]

        self.assertEqual(row["id"], str(photo.pk))
        self.assertIn("date", row)
        self.assertIn("type", row)

    def test_an_anonymous_caller_is_refused(self):
        create_test_photo(owner=self.user, public=True)

        response = APIClient().get(URL)

        self.assertEqual(response.status_code, 401)
