"""Document detection.

Pure, side-effect-free classification of a photo as a *document* (receipt,
invoice, business card, book page, ...). Nothing here reads a file, hits the
network or touches the ORM: the inputs are the already-extracted OCR text, the
OCR text-area fraction and the set of SigLIP 2 tag labels attached to the photo.
The wiring that gathers those inputs lives in
:mod:`api.directory_watcher.processing_jobs`.

The heuristic combines four kinds of evidence:

* **STRONG** — a high-precision SigLIP label (``receipt``, ``document``,
  ``invoice``, ``business card``, ``identity document``, ``book page``). Any one
  of these on its own is enough.
* **MEDIUM — dense text** — a large fraction of the frame is text *and* the OCR
  actually recovered a meaningful amount of it.
* **MEDIUM — receipt fingerprint** — the text carries a currency amount *and* a
  per-language "total" keyword (the shape of a till receipt / invoice).
* **WEAK** — a secondary SigLIP label (``ticket``, ``menu``, ``whiteboard``,
  ``handwritten note``) or a moderate amount of text.

Decision rule: a STRONG signal alone classifies the photo as a document;
otherwise *any two distinct* signals (medium/weak, in any mix) are required.

The numeric thresholds below are deliberately conservative v1 heuristics; they
are expected to be tuned once a labelled corpus / real OCR library is in place.
"""

import re

# --- v1 heuristic thresholds (pending real-library tuning) -------------------
# Dense text (MEDIUM): a document page / receipt fills a large share of the
# frame with characters and the OCR recovered a substantial run of text.
DENSE_TEXT_AREA_FRACTION = 0.18
DENSE_TEXT_MIN_CHARS = 40
# Moderate text (WEAK): enough text to be suggestive but well short of the dense
# bar. Only ever fires when the dense bar is NOT met, so the two text tiers are
# mutually exclusive and count as distinct evidence.
MODERATE_TEXT_AREA_FRACTION = 0.08
MODERATE_TEXT_MIN_CHARS = 20

# High-precision SigLIP labels: any one is sufficient on its own.
STRONG_SIGLIP_LABELS = frozenset(
    {
        "receipt",
        "document",
        "invoice",
        "business card",
        "identity document",
        "book page",
    }
)
# Secondary SigLIP labels: suggestive but not sufficient alone.
WEAK_SIGLIP_LABELS = frozenset(
    {
        "ticket",
        "menu",
        "whiteboard",
        "handwritten note",
    }
)

# Currency amount pattern. A match REQUIRES a currency symbol adjacent to a
# numeric amount (symbol before or after, optional single space). Requiring the
# symbol is what keeps the pattern from firing on version numbers ("version
# 2.0"), IP addresses ("12.34.56.78") or dates ("12.03.2024") -- none of which
# carry a currency glyph. The amount itself allows both "." and "," as decimal
# / thousands separators so "$12.34", "12,34 €", "£9.99" and "¥1200" all match.
_CURRENCY_SYMBOLS = "$€£¥₹₩₽"
_AMOUNT = r"\d(?:[\d.,]*\d)?"
CURRENCY_RE = re.compile(
    rf"[{_CURRENCY_SYMBOLS}]\s?{_AMOUNT}"  # symbol then amount: $12.34, ¥1200
    rf"|{_AMOUNT}\s?[{_CURRENCY_SYMBOLS}]"  # amount then symbol: 12,34 €, 9.99£
)

# Per-language "total" keywords found on receipts / invoices. Latin and Cyrillic
# keywords get word-ish boundaries so "TOTAL" does not fire inside an unrelated
# word; the CJK keywords are matched as bare substrings because ``\b`` does not
# behave usefully between ideographs.
TOTAL_KEYWORD_RE = re.compile(
    r"\b(?:TOTAL|SUBTOTAL|SUMME|GESAMT|MWST|TVA|IVA|TOTAAL|ИТОГО)\b"  # latin/cyrillic
    r"|合計|小計",  # Japanese: total / subtotal
    re.IGNORECASE | re.UNICODE,
)


def _content_length(text: str | None) -> int:
    """Number of non-whitespace characters in *text* (its "actual content")."""
    if not text:
        return 0
    return len(re.sub(r"\s+", "", text))


def has_currency_amount(ocr_text: str | None) -> bool:
    """True if *ocr_text* contains a currency-symbol-anchored amount."""
    if not ocr_text:
        return False
    return CURRENCY_RE.search(ocr_text) is not None


def has_total_keyword(ocr_text: str | None) -> bool:
    """True if *ocr_text* contains a per-language receipt "total" keyword."""
    if not ocr_text:
        return False
    return TOTAL_KEYWORD_RE.search(ocr_text) is not None


class DocumentSignals:
    """The individual document signals, exposed for debuggability.

    Each attribute is an independent, non-overlapping piece of evidence so that
    the decision rule can simply count how many fired. The two text tiers are
    mutually exclusive (``moderate_text`` never fires when ``dense_text`` does).
    """

    __slots__ = (
        "strong_siglip",
        "dense_text",
        "receipt_fingerprint",
        "weak_siglip",
        "moderate_text",
    )

    def __init__(
        self,
        strong_siglip: bool,
        dense_text: bool,
        receipt_fingerprint: bool,
        weak_siglip: bool,
        moderate_text: bool,
    ):
        self.strong_siglip = strong_siglip
        self.dense_text = dense_text
        self.receipt_fingerprint = receipt_fingerprint
        self.weak_siglip = weak_siglip
        self.moderate_text = moderate_text

    def secondary_count(self) -> int:
        """How many non-STRONG (medium/weak) signals fired."""
        return sum(
            (
                self.dense_text,
                self.receipt_fingerprint,
                self.weak_siglip,
                self.moderate_text,
            )
        )

    def __repr__(self):
        fired = [name for name in self.__slots__ if getattr(self, name)]
        return f"DocumentSignals({', '.join(fired) or 'none'})"


def document_signals(
    ocr_text: str | None,
    text_area_fraction: float | None,
    siglip_labels: set[str],
) -> DocumentSignals:
    """Compute the individual document signals for the given evidence.

    Args:
        ocr_text: Plaintext recovered by OCR (may be ``None``/empty).
        text_area_fraction: Fraction of the frame covered by text, in ``[0, 1]``
            (may be ``None`` when unknown).
        siglip_labels: Lower-cased SigLIP 2 tag labels attached to the photo.
    """
    labels = {label.lower() for label in siglip_labels} if siglip_labels else set()
    fraction = text_area_fraction or 0.0
    content_chars = _content_length(ocr_text)

    strong_siglip = bool(labels & STRONG_SIGLIP_LABELS)

    dense_text = (
        fraction >= DENSE_TEXT_AREA_FRACTION and content_chars >= DENSE_TEXT_MIN_CHARS
    )

    receipt_fingerprint = has_currency_amount(ocr_text) and has_total_keyword(ocr_text)

    weak_siglip = bool(labels & WEAK_SIGLIP_LABELS)

    # Moderate text is a strictly weaker text tier; suppress it when the dense
    # tier already fired so a single dense-text page does not count as two.
    moderate_text = (
        fraction >= MODERATE_TEXT_AREA_FRACTION
        and content_chars >= MODERATE_TEXT_MIN_CHARS
        and not dense_text
    )

    return DocumentSignals(
        strong_siglip=strong_siglip,
        dense_text=dense_text,
        receipt_fingerprint=receipt_fingerprint,
        weak_siglip=weak_siglip,
        moderate_text=moderate_text,
    )


def classify_document(
    ocr_text: str | None,
    text_area_fraction: float | None,
    siglip_labels: set[str],
) -> bool:
    """Return ``True`` if the evidence classifies the photo as a document.

    A STRONG SigLIP label alone is sufficient; otherwise any two distinct
    (medium/weak) signals are required. See the module docstring for the full
    rationale.
    """
    signals = document_signals(ocr_text, text_area_fraction, siglip_labels)
    if signals.strong_siglip:
        return True
    return signals.secondary_count() >= 2
