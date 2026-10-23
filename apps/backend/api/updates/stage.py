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
from .extract import EXECUTABLE, check_release, extract_release

ZIP_NAME = "librephotos-windows-x64.zip"
CHECKSUMS_NAME = "SHA256SUMS"
# The 1.4.0 zip is 450 MB.
MAX_ZIP_BYTES = 2 * 2**30
MAX_SMALL_FILE_BYTES = 64 * 2**10
# The zip plus the unpacked folder (1.1 GB), with room to spare.
REQUIRED_FREE_BYTES = 3 * 2**30
# In a prepared release folder: written once every check passed.
MARKER_NAME = ".librephotos-update.json"

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

    def _sibling(self, suffix: str) -> Path:
        return self.path.parent / f"{self.path.name}{suffix}"

    def staged(self, version: str) -> Path:
        return self._sibling(f"-{version}")

    def partial(self, version: str) -> Path:
        return self._sibling(f"-{version}.partial")


def read_marker(folder: Path) -> dict[str, object] | None:
    try:
        marker = json.loads((folder / MARKER_NAME).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return marker if isinstance(marker, dict) else None


def is_staged(folder: Path, version: str) -> bool:
    """``folder`` holds release ``version``, downloaded and checked before."""
    marker = read_marker(folder)
    return (
        marker is not None
        and marker.get("version") == version
        and (folder / EXECUTABLE).is_file()
    )


def _check_free_space(folder: Path) -> None:
    if shutil.disk_usage(folder).free < REQUIRED_FREE_BYTES:
        raise DownloadError("disk_full")


def _expected_sha256(
    session: requests.Session,
    source: ReleaseSource,
    version: str,
    public_key: str | None,
) -> str:
    """The zip's SHA-256 from the release's SHA256SUMS, whose signature is
    checked first when a public key is built in."""
    checksums = fetch_small(
        session, source, version, CHECKSUMS_NAME, MAX_SMALL_FILE_BYTES
    )
    if public_key:
        signed = fetch_small(
            session, source, version, signature.SIGNATURE_NAME, MAX_SMALL_FILE_BYTES
        )
        try:
            signature.verify_minisign(
                checksums, signed.decode("utf-8", "replace"), public_key
            )
        except signature.SignatureError as error:
            raise DownloadError("bad_signature") from error
    return parse_checksums(checksums.decode("utf-8", "replace"), ZIP_NAME)


def _verify(archive: Path, expected: str) -> None:
    if sha256_file(archive) != expected:
        # Corrupt, or a resumed file the server changed meanwhile: start over.
        archive.unlink()
        raise DownloadError("checksum_mismatch")


def _unpack(archive: Path, partial: Path, version: str) -> Path:
    unpacked = partial / "unpacked"
    if unpacked.exists():
        shutil.rmtree(unpacked)
    unpacked.mkdir()
    program = extract_release(archive, unpacked)
    check_release(program, version)
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
    staged = folder.staged(version)
    if is_staged(staged, version):
        return staged
    if staged.exists():
        # Not one this updater finished: someone else's folder.
        raise DownloadError("folder_in_the_way")
    partial = folder.partial(version)
    partial.mkdir(exist_ok=True)
    _check_free_space(partial)
    public_key = signature.PUBLIC_KEY
    expected = _expected_sha256(session, source, version, public_key)
    archive = partial / f"{ZIP_NAME}.part"
    url = source.asset_url(version, ZIP_NAME)
    download_asset(
        session, source, url, Target(archive, MAX_ZIP_BYTES, reporter.progress)
    )
    reporter.phase(VERIFYING)
    _verify(archive, expected)
    reporter.phase(EXTRACTING)
    program = _unpack(archive, partial, version)
    marker = {"version": version, "sha256": expected, "signed": bool(public_key)}
    (program / MARKER_NAME).write_text(json.dumps(marker), encoding="utf-8")
    program.rename(staged)
    shutil.rmtree(partial, ignore_errors=True)
    return staged
