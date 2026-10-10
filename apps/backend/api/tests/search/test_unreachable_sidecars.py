"""An unreachable similarity or CLIP sidecar costs its feature, not the request.

Only an error *reply* was caught: a stopped, crashed or busy sidecar raises a
ConnectionError or a ReadTimeout instead, which made every photo detail with
CLIP embeddings, and every semantic search, answer 500.
"""

from unittest.mock import patch

import requests
from django.test import SimpleTestCase, TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from api.image_similarity import search_similar_embedding, search_similar_image
from api.tests.utils import create_test_photo, create_test_user

FAILURES = (requests.ConnectionError("refused"), requests.ReadTimeout("busy"))


class _Photo:
    image_hash = "a" * 32
    clip_embeddings_model = "mobileclip_s2"  # the default search model's

    def get_clip_embeddings(self):
        return [0.1] * 512


class SimilaritySearchFailureTest(SimpleTestCase):
    def test_an_unreachable_sidecar_is_no_result(self):
        for failure in FAILURES:
            with (
                self.subTest(failure=type(failure).__name__),
                patch("api.sidecars.http.post", side_effect=failure),
            ):
                self.assertEqual(search_similar_embedding(1, [0.1] * 512), [])
                self.assertEqual(search_similar_image(1, _Photo()), [])


class PhotoDetailWithoutSimilaritySidecarTest(TestCase):
    def test_the_detail_still_opens(self):
        user = create_test_user()
        photo = create_test_photo(owner=user, clip_embeddings=[0.1] * 512)
        client = APIClient()
        client.force_authenticate(user=user)
        with patch(
            "api.sidecars.http.post", side_effect=requests.ConnectionError("refused")
        ):
            response = client.get(f"/api/photos/{photo.image_hash}/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["similar_photos"], [])


class SemanticSearchWithoutClipSidecarTest(TestCase):
    def setUp(self):
        self.user = create_test_user(semantic_search_topk=10)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.match = create_test_photo(
            owner=self.user,
            exif_timestamp=timezone.now(),
            search_captions="a dog on the beach",
        )
        self.other = create_test_photo(
            owner=self.user,
            exif_timestamp=timezone.now(),
            search_captions="a city at night",
        )

    def _hashes(self):
        response = self.client.get("/api/photos/searchlist/", {"search": "beach"})
        self.assertEqual(response.status_code, 200)
        return {item["image_hash"] for item in response.json()["results"]}

    def test_the_text_match_still_answers(self):
        for failure in (*FAILURES, requests.HTTPError("no model")):
            with (
                self.subTest(failure=type(failure).__name__),
                patch("api.filters.calculate_query_embeddings", side_effect=failure),
            ):
                self.assertEqual(self._hashes(), {self.match.image_hash})

    def test_semantic_matches_are_added_when_the_sidecar_answers(self):
        with (
            patch(
                "api.filters.calculate_query_embeddings",
                return_value=([0.1] * 512, 1.0),
            ),
            patch(
                "api.filters.search_similar_embedding",
                return_value=[self.other.image_hash],
            ),
        ):
            self.assertEqual(
                self._hashes(), {self.match.image_hash, self.other.image_hash}
            )
