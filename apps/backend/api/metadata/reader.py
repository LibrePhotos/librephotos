import logging
import os
import os.path
import stat
from typing import Any

import requests

from api.mime import METADATA_EXTENSIONS, XMP_EXTENSION
from api.runtime import sidecars

logger = logging.getLogger(__name__)


class MetadataReadError(RuntimeError):
    """The exif service could not read a file's metadata."""


def get_sidecar_files_in_priority_order(media_file: str) -> list[str]:
    """Every name an XMP sidecar of *media_file* may have, best first.

    ``IMG.xmp`` (LibrePhotos' old name, Lightroom's) before ``IMG.jpg.xmp``
    (digiKam, darktable, Immich), each in lower and upper case. Most of them
    do not exist; ``existing_sidecars`` returns the ones that do.
    """
    image_basename = os.path.splitext(media_file)[0]
    # Looked up on disk, so each spelling is tried, lower case first.
    spellings = [
        spelling
        for extension in sorted(METADATA_EXTENSIONS)
        for spelling in (extension, extension.upper())
    ]
    return [image_basename + spelling for spelling in spellings] + [
        media_file + spelling for spelling in spellings
    ]


def existing_sidecars(media_file: str) -> list[str]:
    """The XMP sidecars of *media_file* on disk, each once, best first.

    The first one's values win on read (``get_metadata``) and it is the one
    a write-back goes to (``sidecar_for_write``), so the value written is the
    value read back. On a case-insensitive file system ``IMG.xmp`` also
    "exists" as ``IMG.XMP``; the file identity check keeps it once.
    """
    found: list[str] = []
    seen: set[object] = set()
    for candidate in get_sidecar_files_in_priority_order(media_file):
        try:
            status = os.stat(candidate)
        except OSError:
            continue
        if not stat.S_ISREG(status.st_mode):
            continue
        # Some file systems report no inode number; fall back to the name the
        # platform compares (case-folded on Windows).
        identity: object = (
            (status.st_dev, status.st_ino)
            if status.st_ino
            else os.path.normcase(os.path.abspath(candidate))
        )
        if identity in seen:
            continue
        seen.add(identity)
        found.append(candidate)
    return found


def sidecar_for_write(media_file: str) -> str:
    """The XMP sidecar a write-back of *media_file* goes to (#2286).

    The existing sidecar the reader ranks first, so a digiKam or darktable
    ``IMG.jpg.xmp`` is updated in place instead of getting a second sidecar
    next to it. Without one, a new ``IMG.jpg.xmp``: the name other apps use,
    and the only one that cannot be mistaken for the sidecar of a RAW file
    grouped with the JPEG (``IMG.CR2`` + ``IMG.jpg``).
    """
    sidecars_on_disk = existing_sidecars(media_file)
    if len(sidecars_on_disk) > 1:
        logger.warning(
            "%d XMP sidecars describe one file; writing to the one read first: %s",
            len(sidecars_on_disk),
            ", ".join(os.path.basename(sidecar) for sidecar in sidecars_on_disk),
        )
    if sidecars_on_disk:
        return sidecars_on_disk[0]
    return media_file + XMP_EXTENSION


def _get_existing_metadata_files_reversed(
    media_file: str, include_sidecar_files: bool
) -> list[str]:
    """*media_file* and its sidecars, the file that wins last."""
    if include_sidecar_files:
        return [media_file, *reversed(existing_sidecars(media_file))]
    return [media_file]


def get_metadata(
    media_file: str, tags: list[str], try_sidecar: bool = True, struct: bool = False
) -> list[Any]:
    """Get values for each metadata tag in *tags* from *media_file*.
    If *try_sidecar* is `True`, use the value set in any XMP sidecar file
    stored alongside *media_file*.
    If *struct* is `True`, use the exiftool instance which returns structured data

    Returns a list with the value of each tag in *tags* or `None` if the
    tag was not found. Raises `MetadataReadError` if the exif service cannot
    be reached, fails to read the file, or returns an unusable response: a list of `None` would be stored as "this file has no metadata",
    and a rescan never reads the unchanged file again. The scan records the
    raise as a failure of that one file.

    """
    files_by_reverse_priority = _get_existing_metadata_files_reversed(
        media_file, try_sidecar
    )

    payload = {
        "tags": tags,
        "files_by_reverse_priority": files_by_reverse_priority,
        "struct": struct,
    }
    from api.runtime.http_timeouts import EXIF

    # A refused or dropped connection and a 503 are retried by the client
    # (api.runtime.sidecars); what still fails here would fail again.
    try:
        response = sidecars.post("exif", "/get-tags", json=payload, timeout=EXIF)
        values = response.json()["values"]
    except (requests.RequestException, ValueError, KeyError, TypeError) as error:
        # ValueError covers JSONDecodeError (empty/non-JSON body); KeyError and
        # TypeError a body without a "values" list; RequestException timeouts,
        # dropped connections and error statuses.
        raise MetadataReadError(
            f"exif service could not read the metadata of {media_file}: "
            f"{sidecars.error_detail(error)}"
        ) from error
    if not isinstance(values, list):
        raise MetadataReadError(
            f"exif service answered for {media_file} without a list of values"
        )

    # Callers unpack the result positionally, so pad a short answer with None
    # to honor the documented one-value-per-tag contract.
    if len(values) < len(tags):
        values = list(values) + [None] * (len(tags) - len(values))
    return values
