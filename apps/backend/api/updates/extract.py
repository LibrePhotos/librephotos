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

from librephotos import release_layout
from librephotos.release_layout import ReleaseLayout

from .download import CHUNK_BYTES, DownloadError

LAYOUT = release_layout.current()
TOP_DIR = LAYOUT.top_dir
EXECUTABLE = LAYOUT.binary_name
BUILD_INFO = release_layout.BUILD_INFO
UNIX_SYSTEM = 3
EXECUTABLE_BITS = 0o111
# The 1.4.0 zip has about 9,000 entries and unpacks to 1.1 GB.
MAX_ENTRIES = 100_000
MAX_UNPACKED_BYTES = 8 * 2**30
# Windows opens these names as devices, with any extension and with spaces
# before it ("nul .txt"); COM and LPT also take 0 and the superscript digits.
_DEVICE_DIGITS = "0123456789\u00b9\u00b2\u00b3"
_WINDOWS_DEVICES = frozenset(
    {"con", "prn", "aux", "nul", "conin$", "conout$"}
    | {f"com{digit}" for digit in _DEVICE_DIGITS}
    | {f"lpt{digit}" for digit in _DEVICE_DIGITS}
)


# What zipfile raises on a damaged or unusual archive: a broken structure, a
# name that is not valid UTF-8 although flagged so, an unsupported compression
# method or encryption.
_ZIP_ERRORS = (
    zipfile.BadZipFile,
    zlib.error,
    EOFError,
    UnicodeDecodeError,
    NotImplementedError,
    RuntimeError,
    ValueError,
    OverflowError,
)


def _unsafe() -> DownloadError:
    return DownloadError("unsafe_zip")


def _safe_part(part: str) -> bool:
    return (
        part not in ("", ".", "..")
        and not part.endswith((".", " "))
        and part.split(".", 1)[0].rstrip(" ").lower() not in _WINDOWS_DEVICES
    )


def entry_parts(name: str, top_dir: str = TOP_DIR) -> tuple[str, ...]:
    """The path of a zip entry as parts under TOP_DIR; DownloadError for any
    name that could land outside the target folder."""
    if "\\" in name or ":" in name or name.startswith("/"):
        raise _unsafe()
    parts = tuple(name.rstrip("/").split("/"))
    if parts[0] != top_dir or not all(_safe_part(part) for part in parts):
        raise _unsafe()
    return parts


def _is_link(info: zipfile.ZipInfo) -> bool:
    return stat.S_ISLNK(info.external_attr >> 16)


def _inside(path: Path, folder: Path) -> bool:
    real_folder = os.path.realpath(folder)
    try:
        return os.path.commonpath([os.path.realpath(path), real_folder]) == real_folder
    except ValueError:
        # Another drive: not inside.
        return False


def _check_sizes(entries: list[zipfile.ZipInfo]) -> None:
    if len(entries) > MAX_ENTRIES:
        raise DownloadError("too_large_unpacked")
    if sum(entry.file_size for entry in entries) > MAX_UNPACKED_BYTES:
        raise DownloadError("too_large_unpacked")


def _is_executable(info: zipfile.ZipInfo) -> bool:
    return info.create_system == UNIX_SYSTEM and bool(
        (info.external_attr >> 16) & EXECUTABLE_BITS
    )


def _extract_entry(
    archive: zipfile.ZipFile, entry: zipfile.ZipInfo, target: Path, top_dir: str
) -> None:
    destination = target.joinpath(*entry_parts(entry.filename, top_dir))
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
    if os.name != "nt" and _is_executable(entry):
        destination.chmod(0o755)


def extract_release(
    zip_path: Path, target: Path, layout: ReleaseLayout | None = None
) -> Path:
    """Unpack the release zip into the empty folder ``target``; returns the
    program folder in it (``target/librephotos``)."""
    top_dir = (layout or LAYOUT).top_dir
    try:
        with zipfile.ZipFile(zip_path) as archive:
            entries = archive.infolist()
            _check_sizes(entries)
            for entry in entries:
                _extract_entry(archive, entry, target, top_dir)
    except _ZIP_ERRORS as error:
        raise DownloadError("bad_zip") from error
    return target / top_dir


def check_release(
    program: Path, version: str, layout: ReleaseLayout | None = None
) -> None:
    layout = layout or LAYOUT
    try:
        info = json.loads(layout.build_info(program).read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise DownloadError("wrong_release") from error
    if (
        not layout.binary(program).is_file()
        or not layout.launcher(program).is_file()
        or not isinstance(info, dict)
        or info.get("version") != version
    ):
        raise DownloadError("wrong_release")
