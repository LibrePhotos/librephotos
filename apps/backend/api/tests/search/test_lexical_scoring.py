from django.test import TestCase

from api.models import Photo
from api.search.lexical import FIELD_WEIGHTS, lexical_matches
from api.search.semantic import OPENCLIP
from api.tests.utils import (
    create_test_face,
    create_test_person,
    create_test_photo,
    create_test_photo_ocr,
    create_test_user,
)


class LexicalMatchesTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.on_path = create_test_photo(
            owner=self.user, search_captions="/photos/beach/img_1.jpg"
        )
        self.tagged = create_test_photo(
            owner=self.user,
            search_captions="beach sea /photos/a/img_2.jpg",
            captions_json={OPENCLIP: {"tags": ["beach", "sea"]}},
        )
        self.placed = create_test_photo(
            owner=self.user, search_location="Beach Road, Brighton"
        )
        self.cards = create_test_photo(
            owner=self.user, search_captions="/photos/cards/img_3.jpg"
        )
        self.read = create_test_photo(owner=self.user, search_captions="img_4.jpg")
        create_test_photo_ocr(self.read, text="Welcome to the beach bar")
        self.named = create_test_photo(owner=self.user, search_captions="Beach")
        person = create_test_person(name="Beach", cluster_owner=self.user)
        create_test_face(photo=self.named, person=person)

    def _ranked(self, groups):
        matches = lexical_matches(Photo.objects.owned_by(self.user), groups)
        return list(
            matches.order_by("-lexical_score", "pk").values_list("pk", "lexical_score")
        )

    def test_the_field_a_word_is_found_in_decides_the_order(self):
        ranked = dict(self._ranked([("beach",)]))
        self.assertEqual(ranked[self.named.pk], FIELD_WEIGHTS["people"])
        self.assertEqual(ranked[self.placed.pk], FIELD_WEIGHTS["place"])
        self.assertEqual(ranked[self.tagged.pk], FIELD_WEIGHTS["things"])
        self.assertEqual(ranked[self.read.pk], FIELD_WEIGHTS["ocr"])
        self.assertEqual(ranked[self.on_path.pk], FIELD_WEIGHTS["other"])

    def test_part_of_a_word_does_not_match(self):
        self.assertNotIn(self.cards.pk, dict(self._ranked([("car",)])))

    def test_plurals_match(self):
        dogs = create_test_photo(owner=self.user, search_captions="three dogs")
        self.assertIn(dogs.pk, dict(self._ranked([("dog",)])))

    def test_every_group_must_match(self):
        self.assertNotIn(self.tagged.pk, dict(self._ranked([("beach",), ("dog",)])))
        self.assertEqual(
            dict(self._ranked([("beach",), ("sea",)]))[self.tagged.pk],
            2 * FIELD_WEIGHTS["things"],
        )

    def test_alternatives_of_a_translated_word(self):
        ranked = dict(self._ranked([("strand", "beach")]))
        self.assertEqual(ranked[self.tagged.pk], FIELD_WEIGHTS["things"])
