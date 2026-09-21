"""Tests for document detection: the pure heuristic and its job wiring.

The pure classifier (:mod:`api.document_detection`) is exercised directly with
plain inputs -- no DB, no network. The wiring in
:mod:`api.directory_watcher.processing_jobs` (the OCR worker and the
``classify_media`` backfill) is covered with real ``Photo`` rows, mocking
``requests.post`` exactly as ``test_photo_ocr`` does.
"""

import uuid
from unittest.mock import MagicMock, patch

from constance.test import override_config
from django.test import SimpleTestCase, TestCase

from api.directory_watcher import processing_jobs
from api.directory_watcher.processing_jobs import (
    classify_media,
    generate_ocr_job,
)
from api.document_detection import (
    CURRENCY_RE,
    TOTAL_KEYWORD_RE,
    classify_document,
    document_signals,
    has_currency_amount,
    has_total_keyword,
)
from api.models import LongRunningJob, PhotoOcr
from api.models.album_thing import AlbumThing
from api.models.photo_search import PhotoSearch
from api.tests.utils import create_test_photo, create_test_user

ACTIVE_MODEL = "ppocrv6_small"

# A block of prose long enough to clear both the dense (>=40) and moderate
# (>=20) content-char bars without carrying any receipt fingerprint.
DENSE_PROSE = "The quick brown fox jumps over the lazy dog and then keeps on running."


def _make_job(user, job_id, target=1):
    from django.utils import timezone

    return LongRunningJob.objects.create(
        started_by=user,
        job_id=str(job_id),
        job_type=LongRunningJob.JOB_GENERATE_OCR,
        queued_at=timezone.now(),
        progress_target=target,
    )


def _ok_response(text="hello world", area=0.12):
    response = MagicMock()
    response.ok = True
    response.status_code = 201
    response.json.return_value = {
        "text": text,
        "blocks": [{"text": "hello", "box": [0, 0, 10, 10], "confidence": 0.9}],
        "mean_confidence": 0.91,
        "text_area_fraction": area,
    }
    return response


# ---------------------------------------------------------------------------
# Currency regex battery
# ---------------------------------------------------------------------------
class CurrencyRegexTest(SimpleTestCase):
    def test_matches(self):
        for text in ["$12.34", "TOTAL 12,34 €", "£9.99", "¥1200 合計", "12.34 €"]:
            with self.subTest(text=text):
                self.assertTrue(has_currency_amount(text), text)

    def test_non_matches(self):
        # Version numbers, IP addresses and dates carry no currency symbol and
        # must NOT be read as amounts.
        for text in ["version 2.0", "12.34.56.78", "12.03.2024", "released 3.11"]:
            with self.subTest(text=text):
                self.assertFalse(has_currency_amount(text), text)

    def test_symbol_before_and_after(self):
        self.assertIsNotNone(CURRENCY_RE.search("paid $5"))
        self.assertIsNotNone(CURRENCY_RE.search("5€"))

    def test_empty_and_none(self):
        self.assertFalse(has_currency_amount(None))
        self.assertFalse(has_currency_amount(""))


# ---------------------------------------------------------------------------
# Total keyword battery (all listed languages)
# ---------------------------------------------------------------------------
class TotalKeywordTest(SimpleTestCase):
    def test_all_languages(self):
        cases = {
            "TOTAL": "TOTAL 12.00",
            "SUBTOTAL": "SUBTOTAL: 9.00",
            "SUMME": "Summe 4,00",
            "GESAMT": "Gesamt 4,00",
            "MWST": "MwSt 0,76",
            "TVA": "TVA 2,00",
            "IVA": "IVA 1,00",
            "TOTAAL": "Totaal 5,00",
            "ITOGO": "ИТОГО 500",
            "JP_TOTAL": "合計 1200",
            "JP_SUBTOTAL": "小計 1000",
        }
        for name, text in cases.items():
            with self.subTest(name=name):
                self.assertTrue(has_total_keyword(text), text)

    def test_case_insensitive(self):
        self.assertTrue(has_total_keyword("total"))
        self.assertTrue(has_total_keyword("итого"))

    def test_word_boundary_rejects_substring(self):
        # "SUBTOTALLY" / "ANECDOTAL" must not fire the bare TOTAL keyword.
        self.assertIsNone(TOTAL_KEYWORD_RE.search("anecdotal evidence"))

    def test_empty_and_none(self):
        self.assertFalse(has_total_keyword(None))
        self.assertFalse(has_total_keyword(""))


# ---------------------------------------------------------------------------
# Pure classify_document decision rule
# ---------------------------------------------------------------------------
class ClassifyDocumentTest(SimpleTestCase):
    def test_empty_inputs_false(self):
        self.assertFalse(classify_document(None, None, set()))
        self.assertFalse(classify_document("", 0.0, set()))

    # --- STRONG: sufficient alone ---
    def test_strong_siglip_alone_true(self):
        for label in [
            "receipt",
            "document",
            "invoice",
            "business card",
            "identity document",
            "book page",
        ]:
            with self.subTest(label=label):
                self.assertTrue(classify_document(None, None, {label}))

    def test_strong_siglip_case_insensitive(self):
        self.assertTrue(classify_document(None, None, {"Receipt"}))

    # --- each non-strong signal individually insufficient ---
    def test_dense_text_alone_false(self):
        sig = document_signals(DENSE_PROSE, 0.20, set())
        self.assertTrue(sig.dense_text)
        self.assertFalse(sig.moderate_text)  # suppressed when dense fires
        self.assertFalse(classify_document(DENSE_PROSE, 0.20, set()))

    def test_receipt_fingerprint_alone_false(self):
        # Currency + total keyword, but tiny text area and no siglip label.
        self.assertFalse(classify_document("TOTAL $9.99", 0.01, set()))

    def test_weak_siglip_alone_false(self):
        for label in ["ticket", "menu", "whiteboard", "handwritten note"]:
            with self.subTest(label=label):
                self.assertFalse(classify_document(None, None, {label}))

    def test_moderate_text_alone_false(self):
        # ~20-40 content chars, area in [0.08, 0.18): moderate only.
        text = "Twenty five chars here!"
        sig = document_signals(text, 0.10, set())
        self.assertTrue(sig.moderate_text)
        self.assertFalse(sig.dense_text)
        self.assertFalse(classify_document(text, 0.10, set()))

    # --- qualifying pairs -> True ---
    def test_dense_text_plus_receipt_fingerprint(self):
        text = "MARKET STORE\nItem A 4,00\nItem B 6,00\nTOTAL 10,00 €\nThank you"
        self.assertTrue(classify_document(text, 0.30, set()))

    def test_dense_text_plus_weak_siglip(self):
        self.assertTrue(classify_document(DENSE_PROSE, 0.20, {"whiteboard"}))

    def test_receipt_fingerprint_plus_weak_siglip(self):
        self.assertTrue(classify_document("TOTAL $9.99", 0.01, {"ticket"}))

    def test_moderate_text_plus_weak_siglip(self):
        text = "Twenty five chars here!"
        self.assertTrue(classify_document(text, 0.10, {"menu"}))

    def test_moderate_text_plus_receipt_fingerprint(self):
        # Moderate text tier + currency/total in the same short text.
        text = "Cafe latte 3,50 Total 3,50 €"
        sig = document_signals(text, 0.10, set())
        self.assertTrue(sig.moderate_text)
        self.assertTrue(sig.receipt_fingerprint)
        self.assertTrue(classify_document(text, 0.10, set()))

    def test_none_area_does_not_crash(self):
        self.assertFalse(classify_document("some text", None, {"ticket"}))


# ---------------------------------------------------------------------------
# Wiring: OCR worker derives is_document
# ---------------------------------------------------------------------------
@override_config(OCR_MODEL=ACTIVE_MODEL)
class OcrDerivesDocumentTest(TestCase):
    def setUp(self):
        self.user = create_test_user()

    def _add_siglip(self, photo, *labels):
        for label in labels:
            at = AlbumThing.objects.create(
                title=label, thing_type="siglip2_tag", owner=self.user
            )
            at.photos.add(photo)

    @patch("requests.post")
    def test_receipt_fingerprint_and_tag_sets_document(self, mock_post):
        photo = create_test_photo(owner=self.user)
        self._add_siglip(photo, "receipt")
        mock_post.return_value = _ok_response(text="STORE\nTOTAL 12,50 €", area=0.30)
        job_id = uuid.uuid4()
        _make_job(self.user, job_id, target=1)

        generate_ocr_job(photo, job_id)

        photo.refresh_from_db()
        self.assertTrue(photo.is_document)
        # Sanity: OCR row was written too.
        self.assertTrue(PhotoOcr.objects.filter(photo=photo).exists())

    @patch("requests.post")
    def test_plain_photo_not_document(self, mock_post):
        photo = create_test_photo(owner=self.user)
        mock_post.return_value = _ok_response(text="hello world", area=0.02)
        job_id = uuid.uuid4()
        _make_job(self.user, job_id, target=1)

        generate_ocr_job(photo, job_id)

        photo.refresh_from_db()
        self.assertFalse(photo.is_document)

    @patch("requests.post")
    def test_user_corrected_photo_untouched(self, mock_post):
        photo = create_test_photo(
            owner=self.user, category_source="user", is_document=False
        )
        self._add_siglip(photo, "receipt")  # would be STRONG -> True if derived
        mock_post.return_value = _ok_response(text="STORE\nTOTAL 12,50 €", area=0.30)
        job_id = uuid.uuid4()
        _make_job(self.user, job_id, target=1)

        generate_ocr_job(photo, job_id)

        photo.refresh_from_db()
        self.assertFalse(photo.is_document)  # user pin respected

    @patch("requests.post")
    def test_unchanged_value_writes_no_update(self, mock_post):
        # A plain photo stays is_document=False; the derivation must not issue a
        # redundant UPDATE for the unchanged value.
        photo = create_test_photo(owner=self.user)
        mock_post.return_value = _ok_response(text="hello world", area=0.02)
        job_id = uuid.uuid4()
        _make_job(self.user, job_id, target=1)

        with patch.object(processing_jobs.Photo, "save", autospec=True) as mock_save:
            processing_jobs._derive_is_document(photo, "hello world", 0.02)
        mock_save.assert_not_called()


# ---------------------------------------------------------------------------
# Wiring: classify_media backfill re-derives is_document
# ---------------------------------------------------------------------------
class ClassifyMediaDocumentBackfillTest(TestCase):
    def setUp(self):
        self.user = create_test_user()

    def _add_siglip(self, photo, *labels):
        for label in labels:
            at = AlbumThing.objects.create(
                title=label, thing_type="siglip2_tag", owner=self.user
            )
            at.photos.add(photo)

    def _ocr(self, photo, text, area):
        return PhotoOcr.objects.create(
            photo=photo, text=text, engine=ACTIVE_MODEL, text_area_fraction=area
        )

    def test_backfill_derives_for_ocr_having_photos(self):
        # Photo with OCR + strong tag -> becomes a document.
        doc = create_test_photo(owner=self.user)
        self._ocr(doc, "STORE\nTOTAL 12,50 €", 0.30)
        self._add_siglip(doc, "receipt")

        # Photo with OCR but no document evidence -> stays non-document.
        non_doc = create_test_photo(owner=self.user)
        self._ocr(non_doc, "hi", 0.01)

        # Photo WITHOUT OCR -> is_document left alone (even if it were a doc).
        no_ocr = create_test_photo(owner=self.user)

        classify_media(self.user, uuid.uuid4())

        doc.refresh_from_db()
        non_doc.refresh_from_db()
        no_ocr.refresh_from_db()
        self.assertTrue(doc.is_document)
        self.assertFalse(non_doc.is_document)
        self.assertFalse(no_ocr.is_document)

    def test_backfill_leaves_ocrless_document_flag_alone(self):
        # An OCR-less photo that a previous run flagged as a document keeps its
        # flag -- the backfill never re-derives without OCR evidence.
        photo = create_test_photo(owner=self.user, is_document=True)

        classify_media(self.user, uuid.uuid4())

        photo.refresh_from_db()
        self.assertTrue(photo.is_document)

    def test_backfill_skips_user_corrected(self):
        photo = create_test_photo(
            owner=self.user, category_source="user", is_document=False
        )
        self._ocr(photo, "STORE\nTOTAL 12,50 €", 0.30)
        self._add_siglip(photo, "receipt")

        classify_media(self.user, uuid.uuid4())

        photo.refresh_from_db()
        self.assertFalse(photo.is_document)


# ---------------------------------------------------------------------------
# Integration: is_document flows into search captions
# ---------------------------------------------------------------------------
class DocumentSearchCaptionTest(TestCase):
    def setUp(self):
        self.user = create_test_user()

    def test_type_document_in_search_captions(self):
        photo = create_test_photo(owner=self.user, is_document=True)
        search = PhotoSearch.objects.create(photo=photo)
        search.recreate_search_captions()
        self.assertIn("type: document", search.search_captions)

    def test_non_document_absent_from_search_captions(self):
        photo = create_test_photo(owner=self.user, is_document=False)
        search = PhotoSearch.objects.create(photo=photo)
        search.recreate_search_captions()
        self.assertNotIn("type: document", search.search_captions)
