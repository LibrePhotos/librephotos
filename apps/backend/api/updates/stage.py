"""Preparing a new release of the Windows app next to the running one (#2788).

The program folder (``...\\librephotos``, where ``librephotos.exe`` runs) is
replaced as a whole, never file by file. While the old release keeps running,
this downloads the new release's zip into ``librephotos-1.5.0.partial`` (next
to the program folder, so the final rename stays on one disk), checks it, and
unpacks it into ``librephotos-1.5.0``. ``librephotos.updater`` swaps the
folders when the admin chooses Restart to update.

Checks, in order: the release's ``SHA256SUMS`` is required and the zip's
SHA-256 must match its line (integrity); a minisign signature of
``SHA256SUMS`` is checked only once a public key is built in
(``api.updates.signature``, #2317); the zip unpacks safely
(``api.updates.extract``) into a folder whose ``build_info.json`` names the
release. A marker file in the finished folder says it passed, so a restart of
LibrePhotos finds it ready without downloading again.
"""

from __future__ import annotations

import json
import shutil
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import requests

from librephotos import release_layout
from librephotos.release_layout import ReleaseLayout

from . import signature
from .download import (
    GITHUB,
    DownloadError,
    Progress,
    ReleaseSource,
    Target,
    download_asset,
    fetch_small,
    parse_checksums,
    sha256_file,
)
from .extract import check_release, extract_release

LAYOUT = release_layout.current()
ZIP_NAME = LAYOUT.archive_name
CHECKSUMS_NAME = LAYOUT.checksums_name
# The 1.4.0 zip is 450 MB.
MAX_ZIP_BYTES = 2 * 2**30
MAX_SMALL_FILE_BYTES = 64 * 2**10
# The zip plus the unpacked folder (1.1 GB), with room to spare.
REQUIRED_FREE_BYTES = 3 * 2**30
# In a prepared release folder: written once every check passed.
MARKER_NAME = release_layout.MARKER_NAME

# phase(name): what stage_release is doing now (VERIFYING, EXTRACTING).
VERIFYING = "verifying"
EXTRACTING = "extracting"
Phase = Callable[[str], None]


def _no_phase(name: str) -> None:
    pass


@dataclass(frozen=True)
class Reporter:
    """Who hears how far stage_release got: bytes, then each later phase."""

    progress: Progress | None = None
    phase: Phase = _no_phase


SILENT = Reporter()


@dataclass(frozen=True)
class ProgramFolder:
    """The running program folder and the folders an update puts next to it."""

    path: Path
    layout: ReleaseLayout = LAYOUT

    def _sibling(self, suffix: str) -> Path:
        return self.path.parent / f"{self.path.name}{suffix}"

    def staged(self, version: str) -> Path:
        return self._sibling(f"-{version}")

    def partial(self, version: str) -> Path:
        return self._sibling(f"-{version}.partial")


def read_marker(
    folder: Path, layout: ReleaseLayout = LAYOUT
) -> dict[str, object] | None:
    try:
        marker = json.loads(layout.marker(folder).read_text(encoding="utf-8"))
    except OSError, ValueError:
        return None
    return marker if isinstance(marker, dict) else None


def is_staged(folder: Path, version: str, layout: ReleaseLayout = LAYOUT) -> bool:
    marker = read_marker(folder, layout)
    return (
        marker is not None
        and marker.get("version") == version
        and layout.binary(folder).is_file()
    )


def check_free_space(folder: Path, required: int = REQUIRED_FREE_BYTES) -> None:
    if shutil.disk_usage(folder).free < required:
        raise DownloadError("disk_full")


def _fetch_listed(
    session: requests.Session,
    source: ReleaseSource,
    version: str,
    name: str,
    missing: str,
) -> bytes:
    try:
        return fetch_small(session, source, version, name, MAX_SMALL_FILE_BYTES)
    except DownloadError as error:
        if error.code.startswith("missing_"):
            raise DownloadError(missing) from error
        raise


def expected_sha256(
    session: requests.Session,
    source: ReleaseSource,
    version: str,
    name: str,
    layout: ReleaseLayout = LAYOUT,
) -> str:
    public_key = signature.PUBLIC_KEY
    checksums = _fetch_listed(
        session, source, version, layout.checksums_name, "missing_sha256sums"
    )
    if public_key:
        signed = _fetch_listed(
            session,
            source,
            version,
            layout.signature_name,
            "missing_sha256sums_minisig",
        )
        try:
            signature.verify_minisign(
                checksums, signed.decode("utf-8", "replace"), public_key
            )
        except signature.SignatureError as error:
            raise DownloadError("bad_signature") from error
    return parse_checksums(checksums.decode("utf-8", "replace"), name)


def verify_download(archive: Path, expected: str) -> None:
    if sha256_file(archive) != expected:
        # Corrupt, or a resumed file the server changed meanwhile: start over.
        archive.unlink()
        raise DownloadError("checksum_mismatch")


def _unpack(archive: Path, partial: Path, version: str, layout: ReleaseLayout) -> Path:
    unpacked = partial / "unpacked"
    if unpacked.exists():
        shutil.rmtree(unpacked)
    unpacked.mkdir()
    program = extract_release(archive, unpacked, layout)
    check_release(program, version, layout)
    return program


def stage_release(
    session: requests.Session,
    folder: ProgramFolder,
    version: str,
    reporter: Reporter = SILENT,
    source: ReleaseSource = GITHUB,
) -> Path:
    """Download, check and unpack release ``version`` next to the program
    folder; returns the prepared folder. Raises DownloadError (or OSError)."""
    layout = folder.layout
    staged = folder.staged(version)
    if is_staged(staged, version, layout):
        return staged
    if staged.exists():
        # Not one this updater finished: someone else's folder.
        raise DownloadError("folder_in_the_way")
    partial = folder.partial(version)
    partial.mkdir(exist_ok=True)
    check_free_space(partial)
    public_key = signature.PUBLIC_KEY
    zip_name = layout.archive_name
    expected = expected_sha256(session, source, version, zip_name, layout)
    archive = partial / f"{zip_name}.part"
    url = source.asset_url(version, zip_name)
    download_asset(
        session, source, url, Target(archive, MAX_ZIP_BYTES, reporter.progress)
    )
    reporter.phase(VERIFYING)
    verify_download(archive, expected)
    reporter.phase(EXTRACTING)
    program = _unpack(archive, partial, version, layout)
    marker = {"version": version, "sha256": expected, "signed": bool(public_key)}
    if layout.marker_inside:
        layout.marker(program).write_text(json.dumps(marker), encoding="utf-8")
    program.rename(staged)
    if not layout.marker_inside:
        layout.marker(staged).write_text(json.dumps(marker), encoding="utf-8")
    shutil.rmtree(partial, ignore_errors=True)
    return staged
