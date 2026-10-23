"""A fake GitHub release for the built-in updater's tests (#2788): a zip shaped
like scripts/build_standalone.py's, its SHA256SUMS, and a requests session
that serves them the way github.com does (a redirect to the asset host,
Range requests), without any network."""

import hashlib
import io
import json
import re
import zipfile

import requests

from api.updates.download import GITHUB

ASSET_HOST = "https://release-assets.githubusercontent.com/assets"
ZIP_NAME = "librephotos-windows-x64.zip"


def release_zip(version="1.5.0", entries=None, build_version=None):
    """The bytes of a release zip: librephotos/ with the exe and build_info."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("librephotos/", b"")
        archive.writestr("librephotos/librephotos.exe", b"MZ fake program")
        archive.writestr(
            "librephotos/build_info.json",
            json.dumps({"version": build_version or version, "git_hash": "abc"}),
        )
        archive.writestr("librephotos/frontend_build/index.html", b"<html></html>")
        for name, data in (entries or {}).items():
            archive.writestr(name, data)
    return buffer.getvalue()


def checksums_for(files):
    return "".join(
        f"{hashlib.sha256(data).hexdigest()}  {name}\n" for name, data in files.items()
    ).encode()


class FakeResponse:
    def __init__(self, status=200, body=b"", headers=None, break_after=None):
        self.status_code = status
        self.body = body
        self.headers = headers or {}
        self.break_after = break_after
        self.closed = False

    def iter_content(self, size):
        sent = 0
        for start in range(0, len(self.body), size):
            chunk = self.body[start : start + size]
            if self.break_after is not None and sent + len(chunk) > self.break_after:
                yield chunk[: self.break_after - sent]
                raise requests.ConnectionError("connection reset")
            sent += len(chunk)
            yield chunk

    def close(self):
        self.closed = True

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
        return False


def serve_bytes(data, headers, honour_range=True, break_after=None):
    """A 200, or a 206 for a Range request, as GitHub's asset host answers."""
    match = re.fullmatch(r"bytes=(\d+)-", headers.get("Range", ""))
    if match and honour_range:
        start = int(match.group(1))
        if start >= len(data):
            return FakeResponse(416)
        return FakeResponse(
            206,
            data[start:],
            {"Content-Range": f"bytes {start}-{len(data) - 1}/{len(data)}"},
            break_after,
        )
    return FakeResponse(
        200, data, {"Content-Length": str(len(data))}, break_after=break_after
    )


class FakeSession:
    """Answers GET by URL from ``routes`` (url -> callable(headers) -> response)."""

    def __init__(self, routes=None):
        self.routes = dict(routes or {})
        self.requests = []

    def get(self, url, headers=None, stream=False, allow_redirects=True, timeout=None):
        self.requests.append((url, dict(headers or {})))
        route = self.routes.get(url)
        if route is None:
            return FakeResponse(404)
        return route(dict(headers or {}))

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def release_session(version="1.5.0", files=None, **serve_options):
    """A session serving ``files`` (name -> bytes) as release ``version``'s
    assets: github.com redirects, the asset host serves the bytes."""
    session = FakeSession()
    for name, data in (files or {}).items():
        asset = f"{ASSET_HOST}/{version}/{name}?sig=x"
        session.routes[GITHUB.asset_url(version, name)] = lambda headers, asset=asset: (
            FakeResponse(302, headers={"Location": asset})
        )
        session.routes[asset] = lambda headers, data=data: serve_bytes(
            data, headers, **serve_options
        )
    return session


def release_files(version="1.5.0", zip_bytes=None):
    """The zip and its SHA256SUMS, as a release has them."""
    data = zip_bytes if zip_bytes is not None else release_zip(version)
    return {ZIP_NAME: data, "SHA256SUMS": checksums_for({ZIP_NAME: data})}
