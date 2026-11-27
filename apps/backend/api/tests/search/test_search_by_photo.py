import datetime
from unittest.mock import patch

import numpy as np
from django.test import TestCase
from rest_framework.test import APIClient

from api.search.semantic import OPENCLIP
from api.tests.utils import (
    create_test_library_share,
    create_test_photo,
    create_test_user,
)

SEARCH_URL = "/api/photos/searchlist/"
PHOTO_VECTOR = [3.0, 4.0] + [0.0] * 510
TEXT_VECTOR = [0.0, 0.0, 2.0] + [0.0] * 509


def _taken(year):
    return datetime.datetime(year, 6, 1, 12, tzinfo=datetime.UTC)


class SearchByPhotoTest(TestCase):
    def setUp(self):
        self.user = create_test_user(semantic_search_topk=100)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.reference = create_test_photo(
            owner=self.user,
            clip_embeddings=PHOTO_VECTOR,
            clip_embeddings_model=OPENCLIP,
        )
        self.close = create_test_photo(owner=self.user, exif_timestamp=_taken(2020))
        self.far = create_test_photo(owner=self.user, exif_timestamp=_taken(2024))
        self.beach = create_test_photo(
            owner=self.user,
            exif_timestamp=_taken(2022),
            search_captions="beach",
            captions_json={OPENCLIP: {"tags": ["beach"]}},
        )
        self.scores = {
            self.user.id: [
                (self.reference.image_hash, 1.0),
                (self.close.image_hash, 0.8),
                (self.far.image_hash, 0.3),
            ]
        }

    def _search(self, params):
        def ranked(user_id, embedding, count, threshold):
            return self.scores.get(user_id, [])

        with (
            patch(
                "api.search.ranked.calculate_query_embeddings",
                return_value=(TEXT_VECTOR, 2.0),
            ) as text,
            patch(
                "api.search.ranked.search_ranked_embedding", side_effect=ranked
            ) as search,
        ):
            response = self.client.get(SEARCH_URL, params)
        self.text_calls = text.call_args_list
        self.search_calls = search.call_args_list
        return response

    def _found(self, params):
        response = self._search(params)
        self.assertEqual(response.status_code, 200, response.content[:300])
        return [item["image_hash"] for item in response.json()["results"]]

    def test_ranks_by_the_photo_and_leaves_the_photo_out(self):
        found = self._found({"similar_to": str(self.reference.pk)})
        self.assertEqual(found, [self.close.image_hash, self.far.image_hash])
        self.assertEqual(self.text_calls, [])
        self.assertEqual(list(self.search_calls[0].args[1]), PHOTO_VECTOR)

    def test_the_words_add_their_meaning_and_their_matches(self):
        found = self._found({"similar_to": str(self.reference.pk), "search": "beach"})
        self.assertIn(self.beach.image_hash, found)
        self.assertIn(self.close.image_hash, found)
        sent = np.asarray(self.search_calls[0].args[1])
        expected = np.asarray(PHOTO_VECTOR) / 5.0 + np.asarray(TEXT_VECTOR) / 2.0
        np.testing.assert_allclose(sent, expected, rtol=1e-6)

    def test_newest_orders_the_same_matches_by_date(self):
        found = self._found({"similar_to": str(self.reference.pk), "sort": "newest"})
        self.assertEqual(found, [self.far.image_hash, self.close.image_hash])

    def test_a_flat_list_with_semantic_search_off(self):
        self.user.semantic_search_topk = 0
        self.user.save()
        found = self._found({"similar_to": str(self.reference.pk)})
        self.assertEqual(found, [self.close.image_hash, self.far.image_hash])

    def test_a_photo_without_an_embedding_finds_nothing(self):
        found = self._found({"similar_to": str(self.close.pk)})
        self.assertEqual(found, [])
        self.assertEqual(self.search_calls, [])

    def test_another_users_photo_is_refused(self):
        stranger = create_test_photo(
            owner=create_test_user(),
            clip_embeddings=PHOTO_VECTOR,
            clip_embeddings_model=OPENCLIP,
        )
        response = self._search({"similar_to": str(stranger.pk)})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["errors"][0]["field"], "similar_to")
        self.assertEqual(self.search_calls, [])

    def test_a_photo_of_a_shared_library_can_be_searched_by(self):
        owner = create_test_user()
        create_test_library_share(owner=owner, recipient=self.user)
        shared = create_test_photo(
            owner=owner, clip_embeddings=PHOTO_VECTOR, clip_embeddings_model=OPENCLIP
        )
        found = self._found({"similar_to": str(shared.pk)})
        self.assertEqual(
            found,
            [self.reference.image_hash, self.close.image_hash, self.far.image_hash],
        )

    def test_a_hidden_photo_of_a_shared_library_is_refused(self):
        owner = create_test_user()
        create_test_library_share(owner=owner, recipient=self.user)
        hidden = create_test_photo(
            owner=owner,
            hidden=True,
            clip_embeddings=PHOTO_VECTOR,
            clip_embeddings_model=OPENCLIP,
        )
        response = self._search({"similar_to": str(hidden.pk)})
        self.assertEqual(response.status_code, 400)

    def test_a_malformed_id_is_a_400(self):
        response = self._search({"similar_to": "not-a-photo"})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["errors"][0]["field"], "similar_to")
