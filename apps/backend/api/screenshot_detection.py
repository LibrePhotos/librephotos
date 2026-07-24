"""Screenshot detection.

Pure, side-effect-free classification of a :class:`~api.models.photo.Photo`
as a screenshot. The only inputs are the photo's file path(s) and its already
extracted :class:`~api.models.photo_metadata.PhotoMetadata`; nothing here reads
the file off disk or re-parses EXIF.

Two rules, in priority order:

* **Rule 1 — path / filename patterns** (primary, high precision): the file is
  named like a screenshot in one of several locales, or lives in a directory
  called ``Screenshots``.
* **Rule 2 — metadata absence** (secondary, conservative): a PNG with no camera
  model, no exposure settings and no GPS. The PNG requirement is load-bearing —
  WhatsApp-forwarded JPEGs also have stripped EXIF and must not be caught here.

EXIF ``UserComment`` / ``Software`` heuristics are deliberately out of scope for
v1.
"""

import os
import re

# Screenshot filename prefixes across the locales LibrePhotos users commonly
# hit. Compared case-insensitively, with ``_``/``-`` normalised to spaces so
# "Screenshot_2020", "Screen-Shot" and "Screen Shot 2020" all match.
_SCREENSHOT_PREFIXES = (
    "screenshot",
    "screen shot",
    "bildschirmfoto",  # German
    "captura de pantalla",  # Spanish
    "capture d'ecran",  # French (apostrophe normalised below)
    "снимок экрана",  # Russian
    "スクリーンショット",  # Japanese
)

_PATH_SEPARATORS = re.compile(r"[\\/]+")


def _normalize(text: str) -> str:
    """Lower-case and fold separators/apostrophes so prefix matching is robust
    against the many ways a screenshot filename can be punctuated."""
    text = text.lower()
    # Curly and straight apostrophes both appear in "Capture d'écran".
    text = text.replace("’", "'")
    text = text.replace("_", " ").replace("-", " ")
    return text


def _matches_screenshot_prefix(basename: str) -> bool:
    normalized = _normalize(basename)
    for prefix in _SCREENSHOT_PREFIXES:
        if normalized.startswith(prefix):
            remainder = normalized[len(prefix) :]
            # Require a boundary after the prefix so "screenshotly.png" does not
            # match while "screenshot 2020.png", "screenshot2020.png" and a bare
            # "screenshot.png" all do.
            if remainder == "" or not remainder[0].isalpha():
                return True
    return False


def _in_screenshots_dir(path: str) -> bool:
    parts = _PATH_SEPARATORS.split(path)
    # Skip the basename (last component) — only parent directories count.
    return any(part.lower() == "screenshots" for part in parts[:-1])


def _is_png(path: str) -> bool:
    return os.path.splitext(path)[1].lower() == ".png"


def _get_metadata(photo):
    """Return the photo's PhotoMetadata, or ``None`` if it has none.

    The reverse one-to-one accessor raises when no row exists, so it is guarded
    rather than allowed to propagate.
    """
    try:
        return photo.metadata
    except Exception:
        return None


def _has_camera_metadata(metadata) -> bool:
    if metadata is None:
        return False
    return bool(
        metadata.camera_model
        or metadata.aperture
        or metadata.iso
        or metadata.focal_length
    )


def _has_gps(photo, metadata) -> bool:
    if photo.exif_gps_lat is not None or photo.exif_gps_lon is not None:
        return True
    if metadata is not None and (
        metadata.gps_latitude is not None or metadata.gps_longitude is not None
    ):
        return True
    return False


def classify(photo) -> bool:
    """Return ``True`` if *photo* looks like a screenshot.

    Operates purely on the photo's file path and its PhotoMetadata; it neither
    reads the file nor mutates the photo.
    """
    main_file = getattr(photo, "main_file", None)
    path = main_file.path if main_file is not None and main_file.path else ""

    # Rule 1 — path / filename patterns (primary).
    if path:
        basename = os.path.basename(path)
        if _matches_screenshot_prefix(basename):
            return True
        if _in_screenshots_dir(path):
            return True

    # Rule 2 — metadata absence (secondary, PNG only).
    if not _is_png(path):
        return False

    metadata = _get_metadata(photo)
    if _has_camera_metadata(metadata):
        return False
    if _has_gps(photo, metadata):
        return False
    return True
