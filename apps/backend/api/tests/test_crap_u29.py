"""Characterization tests for api.stats.get_searchterms_wordcloud.

These pin the CURRENT behavior of the wordcloud builder before refactoring:
counting rules, ordering/tie-breaking, filtering rules, malformed-input
tolerance and per-user scoping.  They assert what the code does today, not
what it arguably should do (see the notes on the location first-seen index).
"""

import math

from django.test import TestCase

from api.models import Person
from api.stats import get_searchterms_wordcloud
from api.tests.utils import create_test_face, create_test_photo, create_test_user


def _caps(categories=None, attributes=None, environment=None, extra=None):
    places365 = {}
    if categories is not None:
        places365["categories"] = categories
    if attributes is not None:
        places365["attributes"] = attributes
    if environment is not None:
        places365["environment"] = environment
    caps = {"places365": places365}
    if extra:
        caps.update(extra)
    return caps


def _geo(features):
    return {"features": features}


def _labels(entries):
    return [e["label"] for e in entries]


def _by_label(entries):
    return {e["label"]: e["y"] for e in entries}


class SearchtermsWordcloudStructureTests(TestCase):
    def setUp(self):
        self.user = create_test_user()

    def test_empty_user_returns_three_empty_lists(self):
        out = get_searchterms_wordcloud(self.user)
        self.assertEqual(out, {"captions": [], "people": [], "locations": []})
        # exactly these keys, in this order
        self.assertEqual(list(out.keys()), ["captions", "people", "locations"])

    def test_photos_without_captions_or_geo_are_ignored(self):
        create_test_photo(owner=self.user)
        create_test_photo(owner=self.user)
        out = get_searchterms_wordcloud(self.user)
        self.assertEqual(out, {"captions": [], "people": [], "locations": []})

    def test_entries_are_label_and_log_count(self):
        create_test_photo(owner=self.user, captions_json=_caps(categories=["beach"]))
        out = get_searchterms_wordcloud(self.user)
        self.assertEqual(len(out["captions"]), 1)
        entry = out["captions"][0]
        self.assertEqual(sorted(entry.keys()), ["label", "y"])
        self.assertEqual(entry["label"], "beach")
        # log(1) == 0.0, and y is a plain float
        self.assertIsInstance(entry["y"], float)
        self.assertEqual(entry["y"], 0.0)


class SearchtermsWordcloudCaptionsTests(TestCase):
    def setUp(self):
        self.user = create_test_user()

    def test_categories_attributes_and_environment_all_counted(self):
        create_test_photo(
            owner=self.user,
            captions_json=_caps(
                categories=["beach", "ocean"],
                attributes=["sunny"],
                environment="outdoor",
            ),
        )
        out = get_searchterms_wordcloud(self.user)
        self.assertEqual(
            set(_labels(out["captions"])), {"beach", "ocean", "sunny", "outdoor"}
        )

    def test_counts_accumulate_across_photos_and_sort_desc(self):
        for _ in range(3):
            create_test_photo(
                owner=self.user, captions_json=_caps(categories=["beach"])
            )
        for _ in range(2):
            create_test_photo(
                owner=self.user, captions_json=_caps(categories=["forest"])
            )
        create_test_photo(owner=self.user, captions_json=_caps(categories=["cave"]))

        out = get_searchterms_wordcloud(self.user)
        self.assertEqual(_labels(out["captions"]), ["beach", "forest", "cave"])
        ys = _by_label(out["captions"])
        self.assertAlmostEqual(ys["beach"], math.log(3))
        self.assertAlmostEqual(ys["forest"], math.log(2))
        self.assertAlmostEqual(ys["cave"], math.log(1))

    def test_duplicate_label_within_one_photo_counts_twice(self):
        # No per-photo dedup for captions (unlike locations)
        create_test_photo(
            owner=self.user,
            captions_json=_caps(categories=["beach", "beach"], attributes=["beach"]),
        )
        out = get_searchterms_wordcloud(self.user)
        self.assertEqual(_labels(out["captions"]), ["beach"])
        self.assertAlmostEqual(out["captions"][0]["y"], math.log(3))

    def test_ties_broken_by_first_seen_order(self):
        # Both appear once; "alpha" is seen first within the same photo because
        # categories are processed before attributes before environment.
        create_test_photo(
            owner=self.user,
            captions_json=_caps(
                categories=["alpha"], attributes=["beta"], environment="gamma"
            ),
        )
        out = get_searchterms_wordcloud(self.user)
        self.assertEqual(_labels(out["captions"]), ["alpha", "beta", "gamma"])

    def test_falsy_and_non_string_labels(self):
        # empty string / None / 0 are skipped; other values are str()-ified
        create_test_photo(
            owner=self.user,
            captions_json=_caps(categories=["", None, 0, 42], attributes=[False]),
        )
        out = get_searchterms_wordcloud(self.user)
        self.assertEqual(_labels(out["captions"]), ["42"])

    def test_non_list_categories_and_attributes_are_skipped(self):
        create_test_photo(
            owner=self.user,
            captions_json=_caps(
                categories="beach", attributes="sunny", environment="outdoor"
            ),
        )
        out = get_searchterms_wordcloud(self.user)
        self.assertEqual(_labels(out["captions"]), ["outdoor"])

    def test_non_string_environment_is_skipped(self):
        create_test_photo(
            owner=self.user, captions_json=_caps(categories=["beach"], environment=7)
        )
        out = get_searchterms_wordcloud(self.user)
        self.assertEqual(_labels(out["captions"]), ["beach"])

    def test_empty_string_environment_is_skipped(self):
        create_test_photo(
            owner=self.user, captions_json=_caps(categories=["beach"], environment="")
        )
        out = get_searchterms_wordcloud(self.user)
        self.assertEqual(_labels(out["captions"]), ["beach"])

    def test_missing_places365_key_yields_nothing(self):
        create_test_photo(owner=self.user, captions_json={"im2txt": "a dog"})
        out = get_searchterms_wordcloud(self.user)
        self.assertEqual(out["captions"], [])

    def test_malformed_captions_json_is_swallowed(self):
        # places365 is not a dict -> AttributeError inside the try -> skipped
        create_test_photo(owner=self.user, captions_json={"places365": "nope"})
        # captions_json is a list -> .get() raises -> skipped
        create_test_photo(owner=self.user, captions_json=["not", "a", "dict"])
        # a good photo still contributes
        create_test_photo(owner=self.user, captions_json=_caps(categories=["beach"]))
        out = get_searchterms_wordcloud(self.user)
        self.assertEqual(_labels(out["captions"]), ["beach"])

    def test_empty_dict_captions_json_yields_nothing(self):
        create_test_photo(owner=self.user, captions_json={})
        out = get_searchterms_wordcloud(self.user)
        self.assertEqual(out["captions"], [])

    def test_captions_capped_at_100_labels(self):
        create_test_photo(
            owner=self.user,
            captions_json=_caps(categories=[f"cat{i:03d}" for i in range(150)]),
        )
        out = get_searchterms_wordcloud(self.user)
        self.assertEqual(len(out["captions"]), 100)
        # all tied at count 1 -> first-seen order wins
        self.assertEqual(_labels(out["captions"])[0], "cat000")
        self.assertEqual(_labels(out["captions"])[-1], "cat099")

    def test_captions_are_scoped_to_owner(self):
        other = create_test_user()
        create_test_photo(owner=other, captions_json=_caps(categories=["beach"]))
        create_test_photo(owner=self.user, captions_json=_caps(categories=["forest"]))
        out = get_searchterms_wordcloud(self.user)
        self.assertEqual(_labels(out["captions"]), ["forest"])


class SearchtermsWordcloudPeopleTests(TestCase):
    def setUp(self):
        self.user = create_test_user()

    def _person(self, name):
        return Person.objects.create(name=name, kind=Person.KIND_USER)

    def test_faces_counted_per_person_sorted_desc(self):
        alice = self._person("Alice")
        bob = self._person("Bob")
        for _ in range(3):
            create_test_face(photo=create_test_photo(owner=self.user), person=alice)
        create_test_face(photo=create_test_photo(owner=self.user), person=bob)

        out = get_searchterms_wordcloud(self.user)
        self.assertEqual(_labels(out["people"]), ["Alice", "Bob"])
        ys = _by_label(out["people"])
        self.assertAlmostEqual(ys["Alice"], math.log(3))
        self.assertAlmostEqual(ys["Bob"], math.log(1))

    def test_faces_without_person_are_excluded(self):
        create_test_face(photo=create_test_photo(owner=self.user), person=None)
        out = get_searchterms_wordcloud(self.user)
        self.assertEqual(out["people"], [])

    def test_multiple_faces_on_same_photo_counted_individually(self):
        alice = self._person("Alice")
        photo = create_test_photo(owner=self.user)
        create_test_face(photo=photo, person=alice)
        create_test_face(photo=photo, person=alice)
        out = get_searchterms_wordcloud(self.user)
        self.assertAlmostEqual(_by_label(out["people"])["Alice"], math.log(2))

    def test_people_scoped_to_photo_owner(self):
        other = create_test_user()
        alice = self._person("Alice")
        create_test_face(photo=create_test_photo(owner=other), person=alice)
        out = get_searchterms_wordcloud(self.user)
        self.assertEqual(out["people"], [])

    def test_people_capped_at_100(self):
        for i in range(105):
            person = self._person(f"P{i:03d}")
            create_test_face(photo=create_test_photo(owner=self.user), person=person)
        out = get_searchterms_wordcloud(self.user)
        self.assertEqual(len(out["people"]), 100)


class SearchtermsWordcloudLocationsTests(TestCase):
    def setUp(self):
        self.user = create_test_user()

    def test_place_text_counted_once_per_photo(self):
        # Same text twice in one photo -> counted once (set-based dedup)
        create_test_photo(
            owner=self.user,
            geolocation_json=_geo(
                [
                    {"place_type": ["place"], "text": "Berlin"},
                    {"place_type": ["region"], "text": "Berlin"},
                ]
            ),
        )
        out = get_searchterms_wordcloud(self.user)
        self.assertEqual(_labels(out["locations"]), ["Berlin"])
        self.assertAlmostEqual(out["locations"][0]["y"], math.log(1))

    def test_counts_accumulate_across_photos(self):
        for _ in range(2):
            create_test_photo(
                owner=self.user,
                geolocation_json=_geo([{"place_type": ["place"], "text": "Berlin"}]),
            )
        create_test_photo(
            owner=self.user,
            geolocation_json=_geo([{"place_type": ["place"], "text": "Paris"}]),
        )
        out = get_searchterms_wordcloud(self.user)
        self.assertEqual(_labels(out["locations"]), ["Berlin", "Paris"])
        self.assertAlmostEqual(_by_label(out["locations"])["Berlin"], math.log(2))

    def test_postcode_and_poi_are_filtered_out(self):
        create_test_photo(
            owner=self.user,
            geolocation_json=_geo(
                [
                    {"place_type": ["postcode"], "text": "10115"},
                    {"place_type": ["poi"], "text": "Brandenburg Gate"},
                    {"place_type": ["place"], "text": "Berlin"},
                ]
            ),
        )
        out = get_searchterms_wordcloud(self.user)
        self.assertEqual(_labels(out["locations"]), ["Berlin"])

    def test_mixed_place_type_list_containing_poi_is_filtered(self):
        create_test_photo(
            owner=self.user,
            geolocation_json=_geo(
                [{"place_type": ["place", "poi"], "text": "Somewhere"}]
            ),
        )
        out = get_searchterms_wordcloud(self.user)
        self.assertEqual(out["locations"], [])

    def test_string_place_type_is_accepted_and_filtered(self):
        create_test_photo(
            owner=self.user,
            geolocation_json=_geo(
                [
                    {"place_type": "postcode", "text": "10115"},
                    {"place_type": "country", "text": "Germany"},
                ]
            ),
        )
        out = get_searchterms_wordcloud(self.user)
        self.assertEqual(_labels(out["locations"]), ["Germany"])

    def test_missing_or_none_place_type_is_kept(self):
        create_test_photo(
            owner=self.user,
            geolocation_json=_geo(
                [{"text": "Nowhere"}, {"place_type": None, "text": "Elsewhere"}]
            ),
        )
        out = get_searchterms_wordcloud(self.user)
        self.assertEqual(set(_labels(out["locations"])), {"Nowhere", "Elsewhere"})

    def test_features_without_text_are_skipped(self):
        create_test_photo(
            owner=self.user,
            geolocation_json=_geo(
                [
                    {"place_type": ["place"]},
                    {"place_type": ["place"], "text": ""},
                    {"place_type": ["place"], "text": None},
                    {"place_type": ["place"], "text": "Berlin"},
                ]
            ),
        )
        out = get_searchterms_wordcloud(self.user)
        self.assertEqual(_labels(out["locations"]), ["Berlin"])

    def test_non_dict_features_are_skipped(self):
        create_test_photo(
            owner=self.user,
            geolocation_json=_geo(
                ["a string", 42, None, {"place_type": ["place"], "text": "Berlin"}]
            ),
        )
        out = get_searchterms_wordcloud(self.user)
        self.assertEqual(_labels(out["locations"]), ["Berlin"])

    def test_missing_features_key_and_non_dict_geo_are_tolerated(self):
        create_test_photo(owner=self.user, geolocation_json={"no_features": 1})
        create_test_photo(owner=self.user, geolocation_json=[1, 2, 3])
        create_test_photo(
            owner=self.user,
            geolocation_json=_geo([{"place_type": ["place"], "text": "Berlin"}]),
        )
        out = get_searchterms_wordcloud(self.user)
        self.assertEqual(_labels(out["locations"]), ["Berlin"])

    def test_locations_scoped_to_owner(self):
        other = create_test_user()
        create_test_photo(
            owner=other,
            geolocation_json=_geo([{"place_type": ["place"], "text": "Berlin"}]),
        )
        out = get_searchterms_wordcloud(self.user)
        self.assertEqual(out["locations"], [])

    def test_locations_capped_at_100(self):
        create_test_photo(
            owner=self.user,
            geolocation_json=_geo(
                [{"place_type": ["place"], "text": f"City{i:03d}"} for i in range(130)]
            ),
        )
        out = get_searchterms_wordcloud(self.user)
        self.assertEqual(len(out["locations"]), 100)

    def test_location_tie_order_is_not_insertion_order(self):
        """Pins the current (surprising) location tie-break.

        Locations from a single photo are collected in a *set*, so the
        first-seen index assigned to tied labels follows set iteration order,
        not document order.  Only the multiset of labels is stable; the code
        does guarantee that a higher count sorts first.
        """
        create_test_photo(
            owner=self.user,
            geolocation_json=_geo(
                [
                    {"place_type": ["place"], "text": "Berlin"},
                    {"place_type": ["country"], "text": "Germany"},
                ]
            ),
        )
        create_test_photo(
            owner=self.user,
            geolocation_json=_geo([{"place_type": ["country"], "text": "Germany"}]),
        )
        out = get_searchterms_wordcloud(self.user)
        # Germany has count 2 so it wins regardless of first-seen index
        self.assertEqual(_labels(out["locations"]), ["Germany", "Berlin"])

    def test_location_first_seen_index_borrows_caption_index(self):
        """Pins a latent quirk: locations reuse captions_first_seen.

        For a label that also exists as a caption term, the location
        first-seen index is taken from ``captions_first_seen``.  Here "Berlin"
        is caption index 0, so among count-1 ties it sorts ahead of "Paris"
        (which gets the running order_index).  A refactor that separates the
        two counters would change this ordering.
        """
        create_test_photo(owner=self.user, captions_json=_caps(categories=["Berlin"]))
        # Paris photo created/streamed first, Berlin second
        create_test_photo(
            owner=self.user,
            geolocation_json=_geo([{"place_type": ["place"], "text": "Paris"}]),
        )
        create_test_photo(
            owner=self.user,
            geolocation_json=_geo([{"place_type": ["place"], "text": "Berlin"}]),
        )
        out = get_searchterms_wordcloud(self.user)
        self.assertEqual(_labels(out["locations"]), ["Berlin", "Paris"])
        self.assertEqual(_labels(out["captions"]), ["Berlin"])


class SearchtermsWordcloudCombinedTests(TestCase):
    def test_all_three_sections_populated_together(self):
        user = create_test_user()
        person = Person.objects.create(name="Alice", kind=Person.KIND_USER)
        photo = create_test_photo(
            owner=user,
            captions_json=_caps(categories=["beach"], environment="outdoor"),
            geolocation_json=_geo(
                [
                    {"place_type": ["place"], "text": "Berlin"},
                    {"place_type": ["poi"], "text": "Gate"},
                ]
            ),
        )
        create_test_face(photo=photo, person=person)

        out = get_searchterms_wordcloud(user)
        self.assertEqual(set(_labels(out["captions"])), {"beach", "outdoor"})
        self.assertEqual(_labels(out["people"]), ["Alice"])
        self.assertEqual(_labels(out["locations"]), ["Berlin"])
