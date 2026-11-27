import datetime
from unittest.mock import patch

import requests
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from api.search.ranked import FEW_PLACE_MATCHES
from api.search.semantic import OPENCLIP
from api.tests.utils import (
    create_test_album_place,
    create_test_face,
    create_test_person,
    create_test_photo,
    create_test_photo_ocr,
    create_test_user,
)

SEARCH_URL = "/api/photos/searchlist/"


def _taken(year, month=6, day=1):
    return datetime.datetime(year, month, day, 12, tzinfo=datetime.UTC)


class RankedSearchTest(TestCase):
    def setUp(self):
        self.user = create_test_user(semantic_search_topk=100)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.beach_2022 = create_test_photo(
            owner=self.user,
            exif_timestamp=_taken(2022),
            search_captions="beach",
            captions_json={OPENCLIP: {"tags": ["beach"]}},
        )
        self.beach_path = create_test_photo(
            owner=self.user,
            exif_timestamp=_taken(2023),
            search_captions="/photos/beach/img.jpg",
        )
        self.looks_like_beach = create_test_photo(
            owner=self.user, exif_timestamp=_taken(2021), search_captions="img.jpg"
        )
        self.city = create_test_photo(
            owner=self.user, exif_timestamp=_taken(2024), search_captions="city"
        )

    def _search(self, params, semantic=()):
        with (
            patch(
                "api.search.ranked.calculate_query_embeddings",
                return_value=([0.1] * 512, 1.0),
            ),
            patch(
                "api.search.ranked.search_ranked_embedding",
                return_value=list(semantic),
            ) as ranked,
        ):
            response = self.client.get(SEARCH_URL, params)
        self.assertEqual(response.status_code, 200)
        self.last_semantic_call = ranked.call_args
        return [item["image_hash"] for item in response.data["results"]]

    def test_best_matches_first(self):
        found = self._search(
            {"search": "beach"},
            [
                (self.beach_2022.image_hash, 0.32),
                (self.looks_like_beach.image_hash, 0.30),
            ],
        )
        self.assertEqual(
            found,
            [
                self.beach_2022.image_hash,
                self.beach_path.image_hash,
                self.looks_like_beach.image_hash,
            ],
        )

    def test_weak_meaning_matches_are_left_out(self):
        found = self._search({"search": "beach"}, [(self.city.image_hash, 0.05)])
        self.assertNotIn(self.city.image_hash, found)

    def test_a_year_in_the_words_narrows_the_results(self):
        found = self._search(
            {"search": "beach 2022"}, [(self.looks_like_beach.image_hash, 0.3)]
        )
        self.assertEqual(found, [self.beach_2022.image_hash])

    def test_a_date_alone_lists_its_photos(self):
        found = self._search({"search": "2024"})
        self.assertEqual(found, [self.city.image_hash])
        self.assertIsNone(self.last_semantic_call)

    def test_newest_orders_the_same_matches_by_date(self):
        found = self._search(
            {"search": "beach", "sort": "newest"},
            [(self.looks_like_beach.image_hash, 0.3)],
        )
        self.assertEqual(
            found,
            [
                self.beach_path.image_hash,
                self.beach_2022.image_hash,
                self.looks_like_beach.image_hash,
            ],
        )

    def test_the_photos_of_a_place_in_the_words_come_first(self):
        berlin = create_test_album_place(owner=self.user, title="Berlin")
        berlin.photos.add(self.city)
        found = self._search(
            {"search": "city in Berlin"}, [(self.beach_2022.image_hash, 0.3)]
        )
        self.assertEqual(found, [self.city.image_hash, self.beach_2022.image_hash])

    def test_a_place_with_few_photos_is_filled_with_the_usual_matches(self):
        berlin = create_test_album_place(owner=self.user, title="Berlin")
        berlin.photos.add(self.city)
        found = self._search(
            {"search": "city in Berlin"}, [(self.beach_2022.image_hash, 0.17)]
        )
        self.assertEqual(found, [self.city.image_hash, self.beach_2022.image_hash])

    def test_a_place_with_many_photos_adds_only_strong_matches_elsewhere(self):
        in_berlin = [
            create_test_photo(owner=self.user, exif_timestamp=_taken(2020))
            for _ in range(FEW_PLACE_MATCHES)
        ]
        berlin = create_test_album_place(owner=self.user, title="Berlin")
        berlin.photos.add(*in_berlin)
        found = self._search(
            {"search": "lake in Berlin"},
            [
                (self.beach_2022.image_hash, 0.25),
                (self.looks_like_beach.image_hash, 0.17),
                *((photo.image_hash, 0.1) for photo in in_berlin),
            ],
        )
        self.assertEqual(len(found), FEW_PLACE_MATCHES + 1)
        self.assertEqual(found[-1], self.beach_2022.image_hash)
        self.assertEqual(self.last_semantic_call.args[3], 0.2)

    def test_a_place_that_finds_nothing_is_searched_as_a_word(self):
        create_test_album_place(owner=self.user, title="Beach Town")
        found = self._search({"search": "Beach Town"})
        self.assertEqual(found, [])
        self.assertEqual(self.last_semantic_call.args[0], self.user.id)

    def test_a_named_person_narrows_the_results(self):
        person = create_test_person(name="Ada Lovelace", cluster_owner=self.user)
        create_test_face(photo=self.looks_like_beach, person=person)
        found = self._search(
            {"search": "Ada beach"}, [(self.looks_like_beach.image_hash, 0.2)]
        )
        self.assertEqual(found, [self.looks_like_beach.image_hash])

    def test_a_translated_word_searches_the_thing(self):
        found = self._search({"search": "Strand", "language": "de"})
        self.assertIn(self.beach_2022.image_hash, found)
        self.assertEqual(
            self.last_semantic_call.args[2], self.user.semantic_search_topk
        )

    def test_another_users_photos_never_show(self):
        other = create_test_user()
        theirs = create_test_photo(
            owner=other, exif_timestamp=timezone.now(), search_captions="beach"
        )
        found = self._search({"search": "beach"}, [(theirs.image_hash, 0.9)])
        self.assertNotIn(theirs.image_hash, found)


class RankedSearchTextTest(TestCase):
    def setUp(self):
        self.user = create_test_user(semantic_search_topk=100)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _search(self, text):
        with patch(
            "api.search.ranked.calculate_query_embeddings",
            side_effect=requests.ConnectionError("refused"),
        ):
            response = self.client.get(SEARCH_URL, {"search": text})
        self.assertEqual(response.status_code, 200)
        return [item["image_hash"] for item in response.data["results"]]

    def test_accents_do_not_matter(self):
        photo = create_test_photo(owner=self.user, search_location="Zürich, Schweiz")
        self.assertEqual(self._search("zurich"), [photo.image_hash])

    def test_text_in_the_photo(self):
        photo = create_test_photo(owner=self.user, search_captions="img.jpg")
        create_test_photo_ocr(photo, text="INVOICE 2024-117")
        self.assertEqual(self._search("invoice"), [photo.image_hash])

    def test_words_alone_answer_while_the_clip_sidecar_is_down(self):
        photo = create_test_photo(owner=self.user, search_captions="beach")
        self.assertEqual(self._search("beach"), [photo.image_hash])


class UndatedPhotosLastTest(TestCase):
    def setUp(self):
        self.user = create_test_user(semantic_search_topk=100)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.undated = create_test_photo(owner=self.user, search_captions="beach")
        self.dated = create_test_photo(
            owner=self.user, exif_timestamp=_taken(2022), search_captions="beach"
        )

    def _search(self, params):
        with patch(
            "api.search.ranked.calculate_query_embeddings",
            side_effect=requests.ConnectionError("refused"),
        ):
            response = self.client.get(SEARCH_URL, params)
        self.assertEqual(response.status_code, 200)
        return [item["image_hash"] for item in response.data["results"]]

    def test_equal_word_matches_list_the_undated_photo_last(self):
        found = self._search({"search": "beach"})
        self.assertEqual(found, [self.dated.image_hash, self.undated.image_hash])

    def test_a_place_alone_lists_the_undated_photo_last(self):
        berlin = create_test_album_place(owner=self.user, title="Berlin")
        berlin.photos.add(self.undated, self.dated)
        found = self._search({"search": "Berlin"})
        self.assertEqual(found, [self.dated.image_hash, self.undated.image_hash])

    def test_newest_and_oldest_list_the_undated_photo_last(self):
        older = create_test_photo(
            owner=self.user, exif_timestamp=_taken(2020), search_captions="beach"
        )
        newest = self._search({"search": "beach", "sort": "newest"})
        oldest = self._search({"search": "beach", "sort": "oldest"})
        self.assertEqual(
            newest,
            [self.dated.image_hash, older.image_hash, self.undated.image_hash],
        )
        self.assertEqual(
            oldest,
            [older.image_hash, self.dated.image_hash, self.undated.image_hash],
        )
