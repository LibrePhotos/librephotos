"""The Sharing pages' photo lists cost the same number of queries at any size.

Both lists render PhotoSummarySerializer over a queryset that only loaded a
few columns, so every other field and relation it reads was a query per photo
(about 15 each, at up to 2500 photos a page).
"""

from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from api.tests.utils import create_test_photo, create_test_user


class SharedPhotoListQueryCountTest(TestCase):
    SMALL = 2
    LARGE = 12

    def setUp(self):
        self.client = APIClient()

    def _share(self, count):
        owner = create_test_user()
        recipient = create_test_user()
        for _ in range(count):
            create_test_photo(owner=owner).shared_to.add(recipient)
        return owner, recipient

    def _get(self, user, url):
        self.client.force_authenticate(user=user)
        with CaptureQueriesContext(connection) as ctx:
            response = self.client.get(url)
            self.assertEqual(response.status_code, 200)
            results = response.json()["results"]
        return len(ctx.captured_queries), results

    def _assert_constant(self, url, as_owner, photo_of):
        small = self._share(self.SMALL)
        large = self._share(self.LARGE)
        pick = 0 if as_owner else 1
        self._get(small[pick], url)  # warm up per-request caches (constance)
        small_queries, small_results = self._get(small[pick], url)
        large_queries, large_results = self._get(large[pick], url)

        self.assertEqual(len(small_results), self.SMALL)
        self.assertEqual(len(large_results), self.LARGE)
        item = photo_of(large_results[0])
        for key in ("id", "image_hash", "aspectRatio", "type", "stacks"):
            self.assertIn(key, item)
        self.assertEqual(item["owner"]["username"], large[0].username)
        self.assertEqual(large_queries, small_queries)

    def test_shared_with_me(self):
        self._assert_constant(
            "/api/photos/shared/tome/", as_owner=False, photo_of=lambda item: item
        )

    def test_shared_by_me(self):
        self._assert_constant(
            "/api/photos/shared/fromme/",
            as_owner=True,
            photo_of=lambda item: item["photo"],
        )
