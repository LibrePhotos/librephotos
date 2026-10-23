"""Unpacking a downloaded Windows release zip safely (#2788).

The zip (scripts/build_standalone.py ``archive``) holds one folder,
``librephotos/``, with ``librephotos.exe`` and ``build_info.json`` in it. Its
SHA-256 was checked before this runs, but the entries are still treated as
untrusted: no entry may leave the target folder ("zip slip": an absolute
path, a drive, ``..``, a backslash, an NTFS stream), name a Windows device,
be a link, or appear twice, and the number of entries and the unpacked size
are limited (a zip bomb).
"""

from __future__ import annotations

import json
import os
import shutil
import stat
import zipfile
import zlib
from pathlib import Path

from .download import CHUNK_BYTES, DownloadError

TOP_DIR = "librephotos"
EXECUTABLE = "librephotos.exe"
BUILD_INFO = "build_info.json"
# The 1.4.0 zip has about 9,000 entries and unpacks to 1.1 GB.
MAX_ENTRIES = 100_000
MAX_UNPACKED_BYTES = 8 * 2**30
_WINDOWS_DEVICES = frozenset(
    {"con", "prn", "aux", "nul"}
    | {f"com{n}" for n in range(1, 10)}
    | {f"lpt{n}" for n in range(1, 10)}
)


def _unsafe() -> DownloadError:
    return DownloadError("unsafe_zip")


def _safe_part(part: str) -> bool:
    return (
        part not in ("", ".", "..")
        and not part.endswith((".", " "))
        and part.split(".", 1)[0].lower() not in _WINDOWS_DEVICES
    )


def entry_parts(name: str) -> tuple[str, ...]:
    """The path of a zip entry as parts under TOP_DIR; DownloadError for any
    name that could land outside the target folder."""
    if "\\" in name or ":" in name or name.startswith("/"):
        raise _unsafe()
    parts = tuple(name.rstrip("/").split("/"))
    if parts[0] != TOP_DIR or not all(_safe_part(part) for part in parts):
        raise _unsafe()
    return parts


def _is_link(info: zipfile.ZipInfo) -> bool:
    return stat.S_ISLNK(info.external_attr >> 16)


def _inside(path: Path, folder: Path) -> bool:
    real_folder = os.path.realpath(folder)
    return os.path.commonpath([os.path.realpath(path), real_folder]) == real_folder


def _check_sizes(entries: list[zipfile.ZipInfo]) -> None:
    if len(entries) > MAX_ENTRIES:
        raise DownloadError("too_large_unpacked")
    if sum(entry.file_size for entry in entries) > MAX_UNPACKED_BYTES:
        raise DownloadError("too_large_unpacked")


def _extract_entry(
    archive: zipfile.ZipFile, entry: zipfile.ZipInfo, target: Path
) -> None:
    destination = target.joinpath(*entry_parts(entry.filename))
    if _is_link(entry) or not _inside(destination, target):
        raise _unsafe()
    if entry.is_dir():
        destination.mkdir(parents=True, exist_ok=True)
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        # "x": an entry that appears twice is refused, not overwritten.
        with archive.open(entry) as source, open(destination, "xb") as sink:
            shutil.copyfileobj(source, sink, CHUNK_BYTES)
    except FileExistsError as error:
        raise _unsafe() from error


def extract_release(zip_path: Path, target: Path) -> Path:
    """Unpack the release zip into the empty folder ``target``; returns the
    program folder in it (``target/librephotos``)."""
    try:
        with zipfile.ZipFile(zip_path) as archive:
            entries = archive.infolist()
            _check_sizes(entries)
            for entry in entries:
                _extract_entry(archive, entry, target)
    except (zipfile.BadZipFile, zlib.error, EOFError) as error:
        raise DownloadError("bad_zip") from error
    return target / TOP_DIR


def check_release(program: Path, version: str) -> None:
    """The unpacked folder is the Windows app of release ``version``."""
    try:
        info = json.loads((program / BUILD_INFO).read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise DownloadError("wrong_release") from error
    if (
        not (program / EXECUTABLE).is_file()
        or not isinstance(info, dict)
        or info.get("version") != version
    ):
        raise DownloadError("wrong_release")
