"""Search ignores accents and case in both directions (#659).

``fold`` strips them, ``PhotoSearch.search_folded`` stores the folded captions
and location wherever either is written, and ``SemanticSearchFilter`` matches
the folded term against that column and against the requester's folded tag
names. Runs on SQLite; nothing here depends on a Postgres extension.
"""

from django.test import TestCase
from django.utils import timezone
from rest_framework.request import Request
from rest_framework.test import APIClient, APIRequestFactory

from api.faces.labels import recreate_search_captions
from api.models import PhotoSearch
from api.models.photo_search import fold
from api.search.filters import SemanticSearchFilter, build_folded_search_q
from api.tests.utils import (
    create_test_face,
    create_test_person,
    create_test_photo,
    create_test_tag,
    create_test_user,
)


class FoldTest(TestCase):
    def test_accents_and_case_are_dropped(self):
        cases = {
            "Zürich": "zurich",
            "ZURICH": "zurich",
            "Café": "cafe",
            "Průhonice": "pruhonice",
            "São Paulo": "sao paulo",
            "Ελλάδα": "ελλαδα",
        }
        for text, folded in cases.items():
            with self.subTest(text=text):
                self.assertEqual(fold(text), folded)

    def test_letters_without_a_separate_mark_fold_too(self):
        self.assertEqual(fold("Łódź"), "lodz")
        self.assertEqual(fold("København"), "kobenhavn")
        self.assertEqual(fold("Ærøskøbing"), "aeroskobing")
        self.assertEqual(fold("Straße"), "strasse")

    def test_compatibility_forms_fold(self):
        self.assertEqual(fold("ﬁle"), "file")
        self.assertEqual(fold("Ｔｏｋｙｏ"), "tokyo")

    def test_scripts_whose_marks_change_the_letter_are_kept(self):
        # Dakuten, Hangul syllables and Devanagari signs are not accents:
        # dropping them would make different words match.
        for text in ("がっこう", "한국", "हिन्दी"):
            with self.subTest(text=text):
                self.assertEqual(fold(text), text)


class SearchFoldedColumnTest(TestCase):
    """``search_folded`` follows the captions and the location."""

    def setUp(self):
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)

    def test_update_search_location_folds_the_location(self):
        search = PhotoSearch(photo=self.photo, search_captions="Café")
        search.update_search_location({"address": "Zürich, Schweiz"})
        self.assertEqual(search.search_folded, "cafe zurich, schweiz")

    def test_recreate_search_captions_folds_the_captions(self):
        search = PhotoSearch(photo=self.photo, search_location="Zürich")
        person = create_test_person(name="Zoë", cluster_owner=self.user)
        create_test_face(photo=self.photo, person=person)

        search.recreate_search_captions()

        self.assertIn("zoe", search.search_folded)
        self.assertTrue(search.search_folded.endswith("zurich"))

    def test_empty_row_folds_to_empty(self):
        search = PhotoSearch(photo=self.photo)
        search.update_search_location(None)
        self.assertEqual(search.search_folded, "")

    def test_bulk_face_relabel_writes_the_folded_column(self):
        indexed = create_test_photo(owner=self.user, search_location="Zürich")
        person = create_test_person(name="Zoë", cluster_owner=self.user)
        create_test_face(photo=indexed, person=person)
        unindexed = create_test_photo(owner=self.user)
        create_test_face(photo=unindexed, person=person)

        recreate_search_captions([indexed, unindexed])

        updated = PhotoSearch.objects.get(photo=indexed).search_folded
        self.assertIn("zoe", updated)
        self.assertIn("zurich", updated)
        self.assertIn("zoe", PhotoSearch.objects.get(photo=unindexed).search_folded)


class BuildFoldedSearchQTest(TestCase):
    def test_without_a_matching_tag_only_the_column_is_searched(self):
        query = build_folded_search_q("zurich", {1: "cafe"})
        self.assertEqual(
            query.children, [("search_instance__search_folded__icontains", "zurich")]
        )

    def test_a_matching_tag_adds_its_photos(self):
        query = build_folded_search_q("cafe", {1: "cafe", 2: "zurich"})
        self.assertEqual(query.connector, "OR")
        self.assertEqual(len(query.children), 2)

    def test_tags_are_not_read_when_the_view_does_not_search_them(self):
        request = Request(APIRequestFactory().get("/"))
        with self.assertNumQueries(0):
            folded = SemanticSearchFilter._folded_tags(
                request, ["search_instance__search_captions"]
            )
        self.assertEqual(folded, {})


class AccentInsensitiveSearchTest(TestCase):
    """The searchlist endpoint finds a photo with or without its accents."""

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.now = timezone.now()

    def _search_hashes(self, term):
        resp = self.client.get("/api/photos/searchlist/", {"search": term})
        self.assertEqual(resp.status_code, 200)
        return {
            item["image_hash"]
            for group in resp.json()["results"]
            for item in group["items"]
        }

    def _photo(self, **kwargs):
        return create_test_photo(owner=self.user, exif_timestamp=self.now, **kwargs)

    def test_unaccented_term_finds_accented_location(self):
        zurich = self._photo(search_location="Zürich, Schweiz")
        other = self._photo(search_location="Bern, Schweiz")

        hashes = self._search_hashes("Zurich")

        self.assertEqual(hashes, {zurich.image_hash})
        self.assertNotIn(other.image_hash, hashes)

    def test_accented_term_finds_unaccented_caption(self):
        cafe = self._photo(search_captions="a small cafe by the lake")
        self._photo(search_captions="a bakery")

        self.assertEqual(self._search_hashes("café"), {cafe.image_hash})

    def test_case_and_accents_mix(self):
        prague = self._photo(search_location="Průhonice, Česko")

        self.assertEqual(self._search_hashes("PRUHONICE cesko"), {prague.image_hash})

    def test_every_term_must_still_match(self):
        self._photo(search_location="Zürich")

        self.assertEqual(self._search_hashes("Zurich Bern"), set())

    def test_tags_match_without_accents(self):
        tagged = self._photo()
        tag = create_test_tag(owner=self.user, name="Café")
        tag.photos.add(tagged)
        self._photo()

        self.assertEqual(self._search_hashes("cafe"), {tagged.image_hash})

    def test_another_users_tag_does_not_match(self):
        other_user = create_test_user()
        theirs = create_test_photo(owner=other_user, exif_timestamp=self.now)
        create_test_tag(owner=other_user, name="Café").photos.add(theirs)
        mine = self._photo()
        # Same folded name on my side, but on none of my photos.
        create_test_tag(owner=self.user, name="cafe")

        hashes = self._search_hashes("cafe")

        self.assertNotIn(theirs.image_hash, hashes)
        self.assertNotIn(mine.image_hash, hashes)

    def test_a_photo_matching_twice_is_listed_once(self):
        photo = self._photo(search_location="Zürich")
        create_test_tag(owner=self.user, name="Zürich").photos.add(photo)

        resp = self.client.get("/api/photos/searchlist/", {"search": "zurich"})

        items = [i for g in resp.json()["results"] for i in g["items"]]
        self.assertEqual([i["image_hash"] for i in items], [photo.image_hash])
