"""Search, No-timestamp and Recently-added cost the same number of queries at any size.

Their querysets left local_orientation deferred and (except Recently-added)
did not prefetch stacks and files, which PhotoSummarySerializer reads for every
photo: up to three more queries per result.
"""

from unittest.mock import patch

from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from api.models.photo_stack import PhotoStack
from api.tests.utils import create_test_photo, create_test_user


class PhotoListQueryCountTest(TestCase):
    SMALL = 2
    LARGE = 12

    def setUp(self):
        self.client = APIClient()

    def _user_with_photos(self, count, **user_kwargs):
        user = create_test_user(**user_kwargs)
        now = timezone.now()
        for _ in range(count):
            photo = create_test_photo(
                owner=user,
                exif_timestamp=now,
                added_on=now,
                search_captions="beach",
            )
            # A stacked photo, so a missing stacks prefetch shows up.
            stack = PhotoStack.objects.create(
                owner=user, stack_type=PhotoStack.StackType.MANUAL
            )
            photo.stacks.add(stack)
        return user

    def _queries(self, user, url, params=None):
        self.client.force_authenticate(user=user)
        with CaptureQueriesContext(connection) as ctx:
            response = self.client.get(url, params or {})
            self.assertEqual(response.status_code, 200)
            response.json()
        return len(ctx.captured_queries)

    def _assert_constant(self, url, params=None, **user_kwargs):
        small = self._user_with_photos(self.SMALL, **user_kwargs)
        large = self._user_with_photos(self.LARGE, **user_kwargs)
        self._queries(small, url, params)  # warm up per-request caches (constance)
        self.assertEqual(
            self._queries(large, url, params), self._queries(small, url, params)
        )

    def test_search(self):
        self._assert_constant("/api/photos/searchlist/", {"search": "beach"})

    def test_semantic_search(self):
        with (
            patch(
                "api.filters.calculate_query_embeddings",
                return_value=([0.1] * 512, 1.0),
            ),
            patch("api.filters.search_similar_embedding", return_value=[]),
        ):
            self._assert_constant(
                "/api/photos/searchlist/",
                {"search": "beach"},
                semantic_search_topk=10,
            )

    def test_recently_added(self):
        self._assert_constant("/api/photos/recentlyadded/")

    def test_no_timestamp(self):
        small = create_test_user()
        large = create_test_user()
        for user, count in ((small, self.SMALL), (large, self.LARGE)):
            for _ in range(count):
                photo = create_test_photo(owner=user)
                photo.stacks.add(
                    PhotoStack.objects.create(
                        owner=user, stack_type=PhotoStack.StackType.MANUAL
                    )
                )
        url = "/api/photos/notimestamp/"
        self._queries(small, url)
        self.assertEqual(self._queries(large, url), self._queries(small, url))
