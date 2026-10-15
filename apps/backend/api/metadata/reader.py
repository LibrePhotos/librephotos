from __future__ import annotations

import logging
import os
import os.path
import stat
from typing import TYPE_CHECKING, Any

import requests

from api.mime import METADATA_EXTENSIONS, XMP_EXTENSION
from api.models.file import File
from api.runtime import sidecars

if TYPE_CHECKING:
    from api.models.photo import Photo

logger = logging.getLogger(__name__)


class MetadataReadError(RuntimeError):
    """The exif service could not read a file's metadata."""


class MetadataFileMissingError(MetadataReadError):
    """The file to read is not on disk (any more)."""


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
        identity = _file_identity(candidate)
        if identity is None or identity in seen:
            continue
        seen.add(identity)
        found.append(candidate)
    return found


def _file_identity(path: str) -> object | None:
    """What makes *path* one file on disk, or None if it is not a regular file."""
    try:
        status = os.stat(path)
    except OSError:
        return None
    if not stat.S_ISREG(status.st_mode):
        return None
    # Some file systems report no inode number; fall back to the name the
    # platform compares (case-folded on Windows).
    if status.st_ino:
        return (status.st_dev, status.st_ino)
    return os.path.normcase(os.path.abspath(path))


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


def sidecar_files_for_photo(photo: Photo) -> list[str]:
    """The existing XMP sidecars of every file of *photo*, lowest priority first.

    For a RAW+JPEG pair the JPEG is the main file, but a RAW editor writes the
    sidecar of the RAW (``IMG.CR2.xmp``, #2269). In rising priority:

    1. sidecars attached to the photo (the scan grouped them with it) that are
       not named after any of its files, such as ``IMG.edit.xmp``;
    2. the sidecars named after its other files (RAW, video), by path;
    3. the sidecars named after the main file, as ``get_metadata`` finds them
       for a path alone, so a sidecar of the main file still wins.

    A file is listed once, at its highest priority.
    """
    assert photo.main_file is not None
    main_path = photo.main_file.path
    other_files = sorted(
        photo.files.exclude(pk=photo.main_file.pk).values_list("path", "type"),
        key=lambda row: row[0],
    )
    attached = [path for path, kind in other_files if kind == File.METADATA_FILE]
    named = [
        sidecar
        for path, kind in other_files
        if kind != File.METADATA_FILE
        for sidecar in reversed(existing_sidecars(path))
    ] + list(reversed(existing_sidecars(main_path)))

    by_file: dict[object, str] = {}
    for path in [*attached, *named]:
        identity = _file_identity(path)
        if identity is None:
            continue
        # Re-inserting moves the file to the end, where its highest priority is.
        by_file.pop(identity, None)
        by_file[identity] = path
    return list(by_file.values())


def get_metadata(
    media_file: str,
    tags: list[str],
    try_sidecar: bool = True,
    struct: bool = False,
    sidecar_files: list[str] | None = None,
) -> list[Any]:
    """Get values for each metadata tag in *tags* from *media_file*.
    If *try_sidecar* is `True`, use the value set in any XMP sidecar file
    stored alongside *media_file*. *sidecar_files* (lowest priority first) replaces
    that lookup by name; see ``sidecar_files_for_photo``.
    If *struct* is `True`, use the exiftool instance which returns structured data

    Returns a list with the value of each tag in *tags* or `None` if the
    tag was not found. Raises `MetadataReadError` if the exif service cannot
    be reached, fails to read the file, or returns an unusable response: a list of `None` would be stored as "this file has no metadata",
    and a rescan never reads the unchanged file again. The scan records the
    raise as a failure of that one file.

    """
    if sidecar_files is not None:
        files_by_reverse_priority = [media_file, *sidecar_files]
    else:
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


def all_tags(path: str) -> list[dict[str, object]]:
    """Every tag of the file at *path*, grouped by ExifTool group (#2277).

    Each group is ``{"name": "IFD0", "family": "EXIF", "tags": {"Make": ...}}``
    (groups in ExifTool's order, tags by name), read now and never stored. Raises
    ``MetadataFileMissingError`` when the file is gone and ``MetadataReadError``
    when the exif service cannot read it.
    """
    from api.runtime.http_timeouts import EXIF

    try:
        response = sidecars.post("exif", "/all-tags", json={"path": path}, timeout=EXIF)
        groups = response.json()["groups"]
    except requests.HTTPError as error:
        if error.response is not None and error.response.status_code == 404:
            raise MetadataFileMissingError("the file is not on disk") from error
        raise MetadataReadError(sidecars.error_detail(error)) from error
    except (requests.RequestException, ValueError, KeyError, TypeError) as error:
        raise MetadataReadError(sidecars.error_detail(error)) from error
    if not isinstance(groups, list) or not all(isinstance(g, dict) for g in groups):
        raise MetadataReadError("the exif service answered without a list of groups")
    return groups
