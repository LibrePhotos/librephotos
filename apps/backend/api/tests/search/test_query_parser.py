import datetime

from django.test import SimpleTestCase

from api.search.query_parser import DateSpec, Vocabulary, parse

TODAY = datetime.date(2026, 11, 27)
PLACES = ["Berlin", "Santa Cruz de Tenerife", "Park Avenue", "Zürich", "France"]
PEOPLE = {"Angelina Jolie": 2, "Angelina": 2, "Tiger Woods": 1}


def parsed(text, **vocabulary):
    words = Vocabulary(
        people=vocabulary.get("people", PEOPLE),
        places=vocabulary.get("places", PLACES),
        translations=vocabulary.get("translations", {}),
    )
    return parse(text, words, TODAY)


class DateWordsTest(SimpleTestCase):
    def test_a_year_is_a_filter(self):
        query = parsed("Halloween 2022")
        self.assertEqual(query.dates, (DateSpec((2022,)),))
        self.assertEqual(query.terms, (("halloween",),))

    def test_a_month_or_season_with_a_year(self):
        self.assertEqual(parsed("October 2026").dates, (DateSpec((2026,), (10,)),))
        self.assertEqual(parsed("summer 2022").dates, (DateSpec((2022,), (6, 7, 8)),))
        self.assertEqual(parsed("Dezember 2020").dates, (DateSpec((2020,), (12,)),))

    def test_a_month_alone_spans_every_year(self):
        self.assertEqual(parsed("snow in january").dates, (DateSpec((), (1,)),))

    def test_ambiguous_month_words_need_a_year(self):
        self.assertEqual(parsed("may").dates, ())
        self.assertEqual(parsed("fall leaves").dates, ())
        self.assertEqual(parsed("may 2021").dates, (DateSpec((2021,), (5,)),))

    def test_this_and_last_year(self):
        self.assertEqual(parsed("last year").dates, (DateSpec((2025,)),))
        self.assertEqual(parsed("dieses Jahr").dates, (DateSpec((2026,)),))

    def test_a_query_of_only_a_date_has_no_words(self):
        query = parsed("2021")
        self.assertEqual(query.terms, ())
        self.assertEqual(query.semantic_text, "")


class PeopleAndPlacesTest(SimpleTestCase):
    def test_a_named_person_is_a_filter(self):
        query = parsed("Tiger Woods playing golf")
        self.assertEqual(query.people, (1,))
        self.assertEqual(query.semantic_text, "playing golf")

    def test_a_first_name_the_vocabulary_lists(self):
        self.assertEqual(parsed("Angelina smiling").people, (2,))

    def test_a_whole_place_title(self):
        query = parsed("selfie in Berlin")
        self.assertEqual(query.places, ("Berlin",))
        self.assertEqual(query.text, "selfie")

    def test_a_long_word_inside_a_place_title(self):
        self.assertEqual(parsed("beach Tenerife").places, ("Santa Cruz de Tenerife",))

    def test_a_short_word_inside_a_place_title_stays_a_word(self):
        query = parsed("park")
        self.assertEqual(query.places, ())
        self.assertEqual(query.terms, (("park",),))

    def test_accents_do_not_matter(self):
        self.assertEqual(parsed("lake in Zurich").places, ("Zürich",))

    def test_connectors_next_to_a_filter_go(self):
        query = parsed("sea in France")
        self.assertEqual(query.text, "sea")
        self.assertEqual(query.places, ("France",))

    def test_connectors_elsewhere_stay_for_the_meaning(self):
        query = parsed("man with a camera")
        self.assertEqual(query.semantic_text, "man with a camera")
        self.assertEqual(query.terms, (("man",), ("camera",)))


class WordsTest(SimpleTestCase):
    def test_quoted_phrases(self):
        query = parsed('"PIN code" letter')
        self.assertEqual(query.phrases, ("PIN code",))
        self.assertEqual(query.terms, (("letter",),))

    def test_a_translated_word_searches_both(self):
        query = parsed("Strand", translations={"strand": "beach"})
        self.assertEqual(query.terms, (("strand", "beach"),))
        self.assertEqual(query.semantic_text, "beach")

    def test_a_plural_finds_its_translation(self):
        query = parsed("Berge", translations={"berg": "mountain"})
        self.assertEqual(query.semantic_text, "mountain")

    def test_foreign_function_words_leave_the_meaning_once_translated(self):
        query = parsed(
            "Mann mit Kamera", translations={"mann": "man", "kamera": "camera"}
        )
        self.assertEqual(query.semantic_text, "man camera")
        self.assertEqual(query.terms, (("mann", "man"), ("kamera", "camera")))

    def test_a_multi_word_thing(self):
        query = parsed(
            "Handschriftliche Notiz",
            translations={"handschriftliche notiz": "handwritten note"},
        )
        self.assertEqual(query.semantic_text, "handwritten note")
        self.assertIn(("handschriftliche", "handwritten note"), query.terms)
