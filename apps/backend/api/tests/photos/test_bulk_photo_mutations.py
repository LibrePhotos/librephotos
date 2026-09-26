"""The bulk flag endpoints: favorite, hide, make public, move to trash.

They used to answer with a full ``PhotoSerializer`` payload per photo, and
``PhotoSerializer.similar_photos`` calls the similarity sidecar over HTTP, so
favoriting 500 photos made 500 sidecar calls inside the request (and one
sidecar error failed the whole operation). No client reads those payloads:
the web and legacy mobile hooks only read ``count``, mobile-v2 re-reads rows
through its delta sync. The response is now the changed hashes and a count.
"""

from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from api.models import Photo
from api.tests.utils import create_test_photos, create_test_user

ENDPOINTS = (
    ("/api/photosedit/favorite/", "favorite"),
    ("/api/photosedit/hide/", "hidden"),
    ("/api/photosedit/makepublic/", "val_public"),
    ("/api/photosedit/setdeleted/", "deleted"),
)


class BulkMutationSidecarTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user(favorite_min_rating=1)
        self.client.force_authenticate(user=self.user)
        self.photos = create_test_photos(number_of_photos=5, owner=self.user)
        self.hashes = [p.image_hash for p in self.photos]

    def test_bulk_mutations_never_call_the_similarity_sidecar(self):
        for url, field in ENDPOINTS:
            with self.subTest(url=url):
                with (
                    patch("api.serializers.photos.search_similar_image") as similar,
                    patch("api.image_similarity.requests.post") as post,
                ):
                    response = self.client.post(
                        url,
                        {"image_hashes": self.hashes, field: True},
                        format="json",
                    )
                self.assertEqual(response.status_code, 200)
                similar.assert_not_called()
                post.assert_not_called()

    def test_response_lists_changed_and_unchanged_hashes(self):
        Photo.objects.filter(pk=self.photos[0].pk).update(rating=3)
        response = self.client.post(
            "/api/photosedit/favorite/",
            {"image_hashes": self.hashes + ["missing"], "favorite": True},
            format="json",
        )
        data = response.json()
        self.assertTrue(data["status"])
        self.assertEqual(data["count"], 4)
        self.assertCountEqual(data["updated_hashes"], self.hashes[1:])
        self.assertEqual(data["not_updated_hashes"], [self.hashes[0]])
        # The heavy per-photo payloads are gone: the web client's zod schema
        # would reject slim objects under these keys, so they are not sent.
        for key in ("results", "updated", "not_updated"):
            self.assertNotIn(key, data)

    def test_select_all_response_is_unchanged(self):
        response = self.client.post(
            "/api/photosedit/hide/",
            {"select_all": True, "query": {}, "hidden": True},
            format="json",
        )
        self.assertEqual(response.json(), {"status": True, "count": 5})
