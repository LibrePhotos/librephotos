"""Google Takeout JSON sidecars: the capture time, position and description a
Google Photos export keeps next to each media file (#2270).

The JSON is read during the scan as the lowest-priority metadata source and
never changes the media file: its date is a date rule of its own (rule type
``takeout_json``, after the EXIF rules and before the file name), its position
is used when the file has none, and its description is the last caption
fallback, after XMP, IPTC and EXIF.

Google names the JSON after the media file, with rules this module undoes
(``find_takeout_json``):

* ``IMG_1.jpg.json``, or ``IMG_1.jpg.supplemental-metadata.json`` in newer
  exports;
* the name before ``.json`` is cut to 46 characters, so a long one loses the
  end of ``.supplemental-metadata`` (``.supplemental-metada.json``,
  ``.supp.json``) or of the media name itself (``.jp.json``, ``..json``);
* the second file of the same name, ``IMG_1(1).jpg``, gets the counter at the
  end: ``IMG_1.jpg(1).json``, ``IMG_1.jpg.supplemental-metadata(1).json``;
* an edited copy, ``IMG_1-edited.jpg``, has no JSON of its own and shares the
  original's.

Finding a truncated name takes the names in the directory, so a scan lists
each directory once (``directory_listings``): the walk already has them.
"""

from __future__ import annotations

import json
import logging
import math
import os
import re
import unicodedata
from collections import defaultdict
from collections.abc import Iterable, Iterator, Mapping
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from api.mime import TAKEOUT_JSON_EXTENSION, extension

if TYPE_CHECKING:
    from api.models.photo import Photo

logger = logging.getLogger(__name__)

# A Takeout JSON is a few KB; anything this large is something else.
TAKEOUT_JSON_MAX_BYTES = 512 * 1024
# Google cuts the JSON's name before the counter and ".json" to this length.
NAME_LIMIT = 46
SUPPLEMENTAL_SUFFIX = ".supplemental-metadata"
# A JSON name this long may be cut at another length than NAME_LIMIT (the
# Memories app saw such names in real exports); it is matched by prefix.
PREFIX_MATCH_MIN = 43
# The suffix Google Photos gives an edited copy, in the export's language.
EDITED_SUFFIXES = (
    "-edited",
    "-bearbeitet",
    "-modifié",
    "-editado",
    "-modificato",
    "-bewerkt",
)
_COUNTER = re.compile(r"\(\d+\)$")


@dataclass(frozen=True)
class TakeoutMetadata:
    """What LibrePhotos reads from a Takeout JSON."""

    # When the photo was taken, in UTC (``photoTakenTime.timestamp``).
    taken_at: datetime
    latitude: float | None = None
    longitude: float | None = None
    altitude: float | None = None
    description: str | None = None

    @property
    def position(self) -> tuple[float, float] | None:
        if self.latitude is None or self.longitude is None:
            return None
        return self.latitude, self.longitude


def is_takeout_candidate(path: str) -> bool:
    """Whether ``path`` may be a Takeout JSON (by its extension only)."""
    return extension(path) == TAKEOUT_JSON_EXTENSION


def _nfc(name: str) -> str:
    # macOS writes decomposed accents; Google writes composed ones.
    return unicodedata.normalize("NFC", name)


def _split_counter(stem: str) -> tuple[str, str]:
    """``("IMG_1", "(1)")`` for ``"IMG_1(1)"``; ``(stem, "")`` without one."""
    match = _COUNTER.search(stem)
    if match is None:
        return stem, ""
    return stem[: match.start()], match.group()


def _titles(name: str) -> list[tuple[str, str]]:
    """The (name, counter) pairs Google may have named the JSON of the media
    file ``name`` after, best first."""
    stem, ext = os.path.splitext(name)
    titles = [(name, "")]
    stem, counter = _split_counter(stem)
    if counter:
        titles.append((stem + ext, counter))
    edited = next((s for s in EDITED_SUFFIXES if stem.lower().endswith(s)), None)
    if edited is not None:
        titles.append((stem[: -len(edited)] + ext, counter))
    return titles


def _exact_names(title: str, counter: str) -> list[str]:
    return [
        (title + suffix)[:NAME_LIMIT] + counter + TAKEOUT_JSON_EXTENSION
        for suffix in ("", SUPPLEMENTAL_SUFFIX)
    ]


@dataclass(frozen=True)
class JsonListing:
    """The Takeout JSON names of one directory, indexed for ``find_takeout_json``."""

    # NFC name -> the name on disk.
    names: Mapping[str, str]
    # (first PREFIX_MATCH_MIN characters, counter) -> (stem, name on disk)
    # of each name long enough to be cut.
    long_stems: Mapping[tuple[str, str], list[tuple[str, str]]]

    @classmethod
    def of(cls, names: Iterable[str]) -> JsonListing:
        by_nfc: dict[str, str] = {}
        long_stems: dict[tuple[str, str], list[tuple[str, str]]] = defaultdict(list)
        for name in names:
            if not is_takeout_candidate(name):
                continue
            nfc = _nfc(name)
            by_nfc[nfc] = name
            stem, counter = _split_counter(nfc[: -len(TAKEOUT_JSON_EXTENSION)])
            if len(stem) >= PREFIX_MATCH_MIN:
                long_stems[(stem[:PREFIX_MATCH_MIN], counter)].append((stem, name))
        return cls(by_nfc, dict(long_stems))

    def exact(self, title: str, counter: str) -> str | None:
        return next(
            (
                self.names[name]
                for name in _exact_names(title, counter)
                if name in self.names
            ),
            None,
        )

    def by_prefix(self, title: str, counter: str) -> str | None:
        """The one long JSON name that is a cut of ``title`` (with or without
        the supplemental suffix), or None when none or several are."""
        full = title + SUPPLEMENTAL_SUFFIX
        candidates = self.long_stems.get((full[:PREFIX_MATCH_MIN], counter), [])
        matches = [name for stem, name in candidates if full.startswith(stem)]
        return matches[0] if len(matches) == 1 else None


def find_takeout_json(media_path: str, listing: JsonListing) -> str | None:
    """The path of the Takeout JSON of ``media_path`` among the names in
    ``listing`` (its directory's), or None.

    The names Google gives are tried first (see the module docstring); a long
    name cut at another length is matched by prefix, but only when one JSON
    fits, so a date is never taken from the JSON of another file.
    """
    directory, file_name = os.path.split(media_path)
    titles = _titles(_nfc(file_name))
    found = next(
        (name for title, counter in titles if (name := listing.exact(title, counter))),
        None,
    ) or next(
        (
            name
            for title, counter in titles
            if (name := listing.by_prefix(title, counter))
        ),
        None,
    )
    return os.path.join(directory, found) if found else None


# ---------------------------------------------------------------- reading


def _number(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float | str):
        return None
    try:
        number = float(value)
    except ValueError:
        return None
    return number if math.isfinite(number) else None


def _taken_at(data: Mapping[str, object]) -> datetime | None:
    taken = data.get("photoTakenTime")
    if not isinstance(taken, dict):
        return None
    # Epoch seconds, as a string ("1546300800"); 0 is "unknown".
    seconds = _number(taken.get("timestamp"))
    if not seconds:
        return None
    try:
        return datetime.fromtimestamp(seconds, tz=timezone.utc)
    except (OverflowError, OSError, ValueError):
        return None


def _geo(value: object) -> tuple[float, float, float | None] | None:
    """(lat, lon, altitude) of a ``geoData`` object; None for 0, 0, which
    Google writes for "no position"."""
    if not isinstance(value, dict):
        return None
    lat, lon = _number(value.get("latitude")), _number(value.get("longitude"))
    if lat is None or lon is None or (lat == 0 and lon == 0):
        return None
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    return lat, lon, _number(value.get("altitude"))


def _description(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    return value.strip() or None


def parse_takeout_json(data: object) -> TakeoutMetadata | None:
    """The values of a parsed Takeout JSON; None for JSON that is not one
    (no ``photoTakenTime``: an album's ``metadata.json``, say)."""
    if not isinstance(data, dict):
        return None
    taken_at = _taken_at(data)
    if taken_at is None:
        return None
    # geoData is the position shown in Google Photos, a position set there
    # included; geoDataExif the one the file had when it was uploaded.
    geo = _geo(data.get("geoData")) or _geo(data.get("geoDataExif"))
    lat, lon, altitude = geo if geo else (None, None, None)
    return TakeoutMetadata(
        taken_at=taken_at,
        latitude=lat,
        longitude=lon,
        altitude=altitude,
        description=_description(data.get("description")),
    )


def read_takeout_json(path: str) -> TakeoutMetadata | None:
    """``parse_takeout_json`` of the file at ``path``. A file that is too large
    or not JSON is skipped with a warning, and the scan goes on."""
    try:
        size = os.path.getsize(path)
        if size > TAKEOUT_JSON_MAX_BYTES:
            logger.warning(
                "skipping a Takeout JSON sidecar of %d bytes (more than %d)",
                size,
                TAKEOUT_JSON_MAX_BYTES,
            )
            logger.debug("the oversized Takeout JSON is %s", path)
            return None
        with open(path, "rb") as handle:
            data = json.loads(handle.read())
    except (OSError, ValueError) as error:
        # ValueError covers JSONDecodeError and UnicodeDecodeError.
        logger.warning("skipping an unreadable Takeout JSON sidecar: %s", error)
        logger.debug("the unreadable Takeout JSON is %s", path)
        return None
    return parse_takeout_json(data)


# ------------------------------------------------- directory listings


@dataclass
class _Listings:
    by_directory: dict[str, JsonListing]
    read: dict[str, TakeoutMetadata | None] = field(default_factory=dict)


_active: ContextVar[_Listings | None] = ContextVar("takeout_listings", default=None)


@contextmanager
def directory_listings(
    known: Mapping[str, Iterable[str]] | None = None,
) -> Iterator[None]:
    """Inside this block each directory is listed once and each JSON read once.

    ``known`` maps a directory to the JSON names the caller knows it holds, so
    it is not listed at all: the scan's walk has every name, and a file group
    carries the JSON matched to it. Outside a block every lookup lists the
    directory, which is fine for one photo (an edit, an upload).
    """
    listings = {
        directory: JsonListing.of(names) for directory, names in (known or {}).items()
    }
    token = _active.set(_Listings(listings))
    try:
        yield
    finally:
        _active.reset(token)


def _json_names_in(directory: str) -> list[str]:
    try:
        with os.scandir(directory) as entries:
            return [entry.name for entry in entries if is_takeout_candidate(entry.name)]
    except OSError:
        return []


def _listing(directory: str) -> JsonListing:
    state = _active.get()
    if state is not None and directory in state.by_directory:
        return state.by_directory[directory]
    listing = JsonListing.of(_json_names_in(directory))
    if state is not None:
        state.by_directory[directory] = listing
    return listing


def takeout_json_path(media_paths: Iterable[str]) -> str | None:
    """The Takeout JSON of the first of ``media_paths`` that has one."""
    for path in media_paths:
        found = find_takeout_json(path, _listing(os.path.dirname(path)))
        if found is not None:
            return found
    return None


def takeout_metadata_for(media_path: str) -> TakeoutMetadata | None:
    """What the Takeout JSON of ``media_path`` says, or None without one."""
    path = takeout_json_path([media_path])
    if path is None:
        return None
    state = _active.get()
    if state is not None and path in state.read:
        return state.read[path]
    metadata = read_takeout_json(path)
    if state is not None:
        state.read[path] = metadata
    return metadata


def takeout_metadata_of(photo: Photo) -> TakeoutMetadata | None:
    """What the Takeout JSON of the photo's main file says, or None."""
    if photo.main_file is None:
        return None
    return takeout_metadata_for(photo.main_file.path)
