"""OCR text is searchable, owner-scoped, and never leaks through the API.

Work package B/4. These tests run on SQLite (the CI backend), so they exercise
the ``ocr__text__icontains`` fallback path of the OCR search integration in
``api.filters.SemanticSearchFilter``. The Postgres full-text path (SearchVector
/ SearchQuery + the functional GIN index from migration 0135) cannot be run
under SQLite; its branch-selection logic is unit-tested directly below by
feeding a mocked vendor to :func:`api.filters.build_ocr_search_q`, but the real
``to_tsvector`` matching is only exercised in a production-like Postgres env.

Migration 0135's ``RunPython`` guard is exercised implicitly: the test database
is created (and torn down) here, and the guard must no-op silently on SQLite or
DB setup would fail before any test ran.
"""

import importlib
import pkgutil

from django.test import TestCase
from django.utils import timezone
from rest_framework import serializers
from rest_framework.test import APIClient

import api.serializers as serializers_pkg
from api.filters import build_ocr_search_q
from api.models import PhotoOcr
from api.tests.utils import create_test_photo, create_test_user


def _with_ocr(photo, text, engine="ppocrv6_small"):
    return PhotoOcr.objects.create(photo=photo, text=text, engine=engine)


class OcrSearchTest(TestCase):
    """The searchlist endpoint returns photos matching on OCR text."""

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.now = timezone.now()

    def _search_hashes(self, term):
        resp = self.client.get("/api/photos/searchlist/", {"search": term})
        return {
            item["image_hash"]
            for group in resp.json()["results"]
            for item in group["items"]
        }

    def test_found_by_word_in_ocr_text(self):
        invoice = create_test_photo(owner=self.user, exif_timestamp=self.now)
        _with_ocr(invoice, "invoice total 42.99")
        unrelated = create_test_photo(owner=self.user, exif_timestamp=self.now)
        _with_ocr(unrelated, "a cat sitting on a mat")

        hashes = self._search_hashes("invoice")
        self.assertIn(invoice.image_hash, hashes)
        self.assertNotIn(unrelated.image_hash, hashes)

    def test_found_by_number_in_ocr_text(self):
        invoice = create_test_photo(owner=self.user, exif_timestamp=self.now)
        _with_ocr(invoice, "invoice total 42.99")
        unrelated = create_test_photo(owner=self.user, exif_timestamp=self.now)
        _with_ocr(unrelated, "a cat sitting on a mat")

        hashes = self._search_hashes("42.99")
        self.assertIn(invoice.image_hash, hashes)
        self.assertNotIn(unrelated.image_hash, hashes)

    def test_caption_search_still_works(self):
        # No OCR row at all: this photo can only be found via search_captions,
        # proving the OCR OR-branch did not regress the existing caption match.
        captioned = create_test_photo(
            owner=self.user,
            exif_timestamp=self.now,
            search_captions="a beautiful sunset over the beach",
        )
        other = create_test_photo(owner=self.user, exif_timestamp=self.now)
        _with_ocr(other, "invoice total 42.99")

        hashes = self._search_hashes("sunset")
        self.assertIn(captioned.image_hash, hashes)
        self.assertNotIn(other.image_hash, hashes)

    def test_other_users_ocr_not_returned(self):
        # Ownership scoping is enforced by SearchListViewSet.get_queryset
        # (Photo.visible.filter(owner=request.user)); a matching OCR row owned by
        # someone else must not surface.
        other_user = create_test_user()
        theirs = create_test_photo(owner=other_user, exif_timestamp=self.now)
        _with_ocr(theirs, "invoice total 42.99")

        mine = create_test_photo(owner=self.user, exif_timestamp=self.now)
        _with_ocr(mine, "invoice total 42.99")

        hashes = self._search_hashes("invoice")
        self.assertIn(mine.image_hash, hashes)
        self.assertNotIn(theirs.image_hash, hashes)

    def test_no_duplicate_rows_from_ocr_join(self):
        # ocr is a OneToOne, so the OCR condition cannot fan out rows even when
        # the photo also matches on another field.
        photo = create_test_photo(
            owner=self.user,
            exif_timestamp=self.now,
            search_captions="invoice paperwork",
        )
        _with_ocr(photo, "invoice total 42.99")

        resp = self.client.get("/api/photos/searchlist/", {"search": "invoice"})
        hashes = [
            item["image_hash"]
            for group in resp.json()["results"]
            for item in group["items"]
        ]
        self.assertEqual(hashes.count(photo.image_hash), 1)


class OcrPrivacyTest(TestCase):
    """OCR text must never be serialized to any API surface."""

    SENTINEL = "topsecret invoice total 42.99 acct 8891"

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.photo = create_test_photo(owner=self.user, exif_timestamp=timezone.now())
        _with_ocr(self.photo, self.SENTINEL)

    def test_search_response_excludes_ocr_text(self):
        # The photo IS returned (it matches the search) but its OCR text is not
        # in the payload.
        resp = self.client.get("/api/photos/searchlist/", {"search": "invoice"})
        self.assertEqual(resp.status_code, 200)
        self.assertIn(self.photo.image_hash, resp.content.decode())
        self.assertNotIn("topsecret", resp.content.decode())
        self.assertNotIn(self.SENTINEL, resp.content.decode())

    def test_photo_detail_excludes_ocr_text(self):
        resp = self.client.get(f"/api/photos/{self.photo.image_hash}/")
        self.assertEqual(resp.status_code, 200)
        self.assertNotIn("topsecret", resp.content.decode())
        self.assertNotIn(self.SENTINEL, resp.content.decode())

    def test_no_serializer_declares_ocr_field(self):
        # Statically walk every serializer class in api.serializers and assert
        # none names an "ocr" field (guards against a future accidental add).
        offenders = []
        for module_info in pkgutil.iter_modules(serializers_pkg.__path__):
            module = importlib.import_module(
                f"{serializers_pkg.__name__}.{module_info.name}"
            )
            for attr_name in dir(module):
                attr = getattr(module, attr_name)
                if not isinstance(attr, type) or not issubclass(
                    attr, serializers.BaseSerializer
                ):
                    continue
                meta = getattr(attr, "Meta", None)
                fields = getattr(meta, "fields", None)
                if isinstance(fields, (list, tuple)) and "ocr" in fields:
                    offenders.append(attr.__name__)
                # A declared field attribute named "ocr" would also expose it.
                declared = getattr(attr, "_declared_fields", {})
                if "ocr" in declared:
                    offenders.append(attr.__name__)
        self.assertEqual(offenders, [], f"serializers expose OCR: {offenders}")


class OcrSearchBranchSelectionTest(TestCase):
    """Unit-test the vendor branch selection without a live database.

    ``build_ocr_search_q`` chooses the query shape purely from the vendor
    string, so both branches are constructible in CI even though the Postgres
    branch can only be *executed* against a real Postgres server.
    """

    def test_sqlite_branch_uses_icontains(self):
        from django.db.models import Q

        q = build_ocr_search_q("invoice", "sqlite")
        self.assertEqual(q, Q(ocr__text__icontains="invoice"))

    def test_other_vendor_falls_back_to_icontains(self):
        from django.db.models import Q

        # Any non-postgres vendor (e.g. mysql) uses the substring fallback.
        self.assertEqual(
            build_ocr_search_q("invoice", "mysql"),
            Q(ocr__text__icontains="invoice"),
        )

    def test_postgres_branch_uses_search_query(self):
        from django.contrib.postgres.search import SearchQuery

        q = build_ocr_search_q("invoice", "postgresql")
        # The Q wraps a single lookup: ocr_search = SearchQuery(...).
        self.assertEqual(len(q.children), 1)
        lookup, value = q.children[0]
        self.assertEqual(lookup, "ocr_search")
        self.assertIsInstance(value, SearchQuery)
