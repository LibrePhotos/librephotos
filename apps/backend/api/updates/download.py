"""Fetching a release's files for the Windows app's built-in updater (#2788).

Everything comes from one release of LibrePhotos/librephotos on github.com,
over HTTPS. The URLs are built here from the release version and a fixed file
name, never taken from an answer, and every redirect must stay on GitHub's
release download hosts (``ReleaseSource``). Each file has a size limit, and
the zip is streamed into a ``.part`` file that a later attempt resumes with a
Range request.

Standard library and requests only: ``api.updates.stage`` runs this in the
Windows app's root process, and tests run it against a local server through a
``ReleaseSource`` of their own.
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urljoin, urlsplit

import requests

REPOSITORY = "LibrePhotos/librephotos"
# Where github.com sends a release download: the asset itself lives on a
# storage host (release-assets since 2025, objects before).
GITHUB_ASSET_HOSTS = frozenset(
    {
        "github.com",
        "objects.githubusercontent.com",
        "release-assets.githubusercontent.com",
    }
)
REQUEST_TIMEOUT_SECONDS = 30
MAX_REDIRECTS = 5
CHUNK_BYTES = 2**20
_REDIRECTS = frozenset({301, 302, 303, 307, 308})
# X.Y.Z only: the version goes into a URL path.
_RELEASE_VERSION = re.compile(r"\d{1,4}\.\d{1,4}\.\d{1,4}")
# sha256sum's format: "<64 hex>  <name>", or "<64 hex> *<name>" in binary mode.
_CHECKSUM_LINE = re.compile(r"([0-9a-fA-F]{64}) [ *](.+)")

# progress(received bytes, total bytes or None when the server did not say)
Progress = Callable[[int, int | None], None]


class DownloadError(Exception):
    """A release could not be fetched, checked or unpacked; ``code`` says why
    (the API and the tray turn it into a message)."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class ReleaseSource:
    """Where release files come from: GitHub's release downloads of
    LibrePhotos/librephotos (``GITHUB``). Tests point one at a local server."""

    base_url: str = f"https://github.com/{REPOSITORY}/releases/download"
    hosts: frozenset[str] = GITHUB_ASSET_HOSTS
    schemes: frozenset[str] = field(default_factory=lambda: frozenset({"https"}))

    def asset_url(self, version: str, name: str) -> str:
        if not _RELEASE_VERSION.fullmatch(version):
            raise DownloadError("bad_version")
        return f"{self.base_url}/{version}/{name}"

    def check(self, url: str) -> str:
        """``url`` when it is on an allowed host and scheme; DownloadError otherwise."""
        parts = urlsplit(url)
        if (
            parts.scheme not in self.schemes
            or parts.hostname not in self.hosts
            or parts.username is not None
            or parts.password is not None
        ):
            raise DownloadError("untrusted_url")
        return url


GITHUB = ReleaseSource()


@dataclass(frozen=True)
class Target:
    """Where a download goes, how large it may get, and who hears its progress."""

    path: Path
    limit: int
    progress: Progress | None = None


def open_asset(
    session: requests.Session,
    source: ReleaseSource,
    url: str,
    headers: dict[str, str] | None = None,
) -> requests.Response:
    """GET ``url`` (streamed), following redirects only to allowed hosts."""
    for _ in range(MAX_REDIRECTS + 1):
        try:
            response = session.get(
                source.check(url),
                headers=headers or {},
                stream=True,
                allow_redirects=False,
                timeout=REQUEST_TIMEOUT_SECONDS,
            )
        except requests.Timeout as error:
            raise DownloadError("timeout") from error
        except requests.RequestException as error:
            raise DownloadError("unreachable") from error
        if response.status_code not in _REDIRECTS:
            return response
        location = response.headers.get("Location", "")
        response.close()
        url = urljoin(url, location)
    raise DownloadError("too_many_redirects")


def fetch_small(
    session: requests.Session,
    source: ReleaseSource,
    version: str,
    name: str,
    limit: int,
) -> bytes:
    """A small release file (SHA256SUMS, its signature) whole.

    DownloadError ``missing_<name>`` when the release does not have it."""
    with open_asset(session, source, source.asset_url(version, name)) as response:
        if response.status_code == 404:
            raise DownloadError(f"missing_{name.lower().replace('.', '_')}")
        if response.status_code != 200:
            raise DownloadError(f"http_{response.status_code}")
        return _read_all(response, limit)


def _read_all(response: requests.Response, limit: int) -> bytes:
    body = b""
    try:
        for chunk in response.iter_content(CHUNK_BYTES):
            body += chunk
            if len(body) > limit:
                raise DownloadError("too_large")
    except requests.RequestException as error:
        raise DownloadError("interrupted") from error
    return body


def parse_checksums(text: str, name: str) -> str:
    """The SHA-256 SHA256SUMS lists for ``name``, in lower case."""
    for line in text.splitlines():
        match = _CHECKSUM_LINE.fullmatch(line.strip())
        if match and match.group(2) == name:
            return match.group(1).lower()
    raise DownloadError("no_checksum")


def _content_range(response: requests.Response, offset: int) -> int | None:
    """The total size a 206 answer gives; DownloadError when it does not
    continue where the partial file ends."""
    match = re.fullmatch(
        r"bytes (\d+)-\d+/(\d+|\*)", response.headers.get("Content-Range", "")
    )
    if match is None or int(match.group(1)) != offset:
        raise DownloadError("bad_range")
    return None if match.group(2) == "*" else int(match.group(2))


def _start_offset(response: requests.Response, offset: int) -> tuple[int, int | None]:
    """Where the answer's bytes go in the file, and the file's total size."""
    if response.status_code == 206 and offset:
        return offset, _content_range(response, offset)
    if response.status_code == 200:
        length = response.headers.get("Content-Length", "")
        return 0, int(length) if length.isdigit() else None
    raise DownloadError(f"http_{response.status_code}")


def _stream(
    response: requests.Response, target: Target, offset: int, total: int | None
) -> None:
    received = offset
    try:
        with open(target.path, "ab" if offset else "wb") as sink:
            for chunk in response.iter_content(CHUNK_BYTES):
                received += len(chunk)
                if received > target.limit:
                    raise DownloadError("too_large")
                sink.write(chunk)
                if target.progress is not None:
                    target.progress(received, total)
    except requests.RequestException as error:
        # The connection broke: what arrived stays, the next attempt resumes.
        raise DownloadError("interrupted") from error


def download_asset(
    session: requests.Session, source: ReleaseSource, url: str, target: Target
) -> None:
    """Stream ``url`` into ``target.path``, resuming a partial file.

    A server that ignores the Range header answers 200 and the file starts
    over; 416 means the file is already complete (the checksum decides).
    """
    offset = target.path.stat().st_size if target.path.exists() else 0
    headers = {"Range": f"bytes={offset}-"} if offset else {}
    with open_asset(session, source, url, headers) as response:
        if offset and response.status_code == 416:
            return
        start, total = _start_offset(response, offset)
        if total is not None and total > target.limit:
            raise DownloadError("too_large")
        _stream(response, target, start, total)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(CHUNK_BYTES), b""):
            digest.update(block)
    return digest.hexdigest()
