"""Fetching release files for the built-in updater (#2788): GitHub only, over
HTTPS, size limits, resumable downloads."""

import hashlib
import tempfile
from pathlib import Path

import requests
from django.test import SimpleTestCase

from api.tests.updates.release_fixtures import (
    FakeResponse,
    FakeSession,
    release_session,
    serve_bytes,
)
from api.updates.download import (
    GITHUB,
    DownloadError,
    ReleaseSource,
    Target,
    download_asset,
    fetch_small,
    open_asset,
    parse_checksums,
    sha256_file,
)

DATA = bytes(range(256)) * 40


class ReleaseSourceTest(SimpleTestCase):
    def test_urls_are_built_from_the_version(self):
        self.assertEqual(
            GITHUB.asset_url("1.5.0", "SHA256SUMS"),
            "https://github.com/LibrePhotos/librephotos/releases/download/1.5.0/SHA256SUMS",
        )

    def test_a_version_that_is_not_x_y_z_never_reaches_a_url(self):
        for version in ("../1.5.0", "1.5", "1.5.0/../x", "dev", "1.5.0-rc1"):
            with self.subTest(version=version), self.assertRaises(DownloadError):
                GITHUB.asset_url(version, "SHA256SUMS")

    def test_only_github_over_https(self):
        allowed = (
            "https://github.com/LibrePhotos/librephotos/releases/download/1.5.0/x",
            "https://release-assets.githubusercontent.com/a?sig=1",
            "https://objects.githubusercontent.com/a",
        )
        for url in allowed:
            self.assertEqual(GITHUB.check(url), url)
        refused = (
            "http://github.com/x",
            "https://example.com/x",
            "https://github.com.evil.example/x",
            "https://user:pw@github.com/x",
            "file:///C:/x.zip",
        )
        for url in refused:
            with self.subTest(url=url), self.assertRaises(DownloadError) as raised:
                GITHUB.check(url)
            self.assertEqual(raised.exception.code, "untrusted_url")


class OpenAssetTest(SimpleTestCase):
    def test_redirects_to_the_asset_host_are_followed(self):
        session = release_session(files={"SHA256SUMS": b"x"})
        url = GITHUB.asset_url("1.5.0", "SHA256SUMS")
        with open_asset(session, GITHUB, url) as response:
            self.assertEqual(response.status_code, 200)
        self.assertEqual(len(session.requests), 2)

    def test_a_redirect_elsewhere_is_refused(self):
        url = GITHUB.asset_url("1.5.0", "SHA256SUMS")
        session = FakeSession(
            {
                url: lambda headers: FakeResponse(
                    302, headers={"Location": "https://evil.example/x"}
                )
            }
        )
        with self.assertRaises(DownloadError) as raised:
            open_asset(session, GITHUB, url)
        self.assertEqual(raised.exception.code, "untrusted_url")
        self.assertEqual(len(session.requests), 1)

    def test_endless_redirects_stop(self):
        url = GITHUB.asset_url("1.5.0", "SHA256SUMS")
        session = FakeSession(
            {url: lambda headers: FakeResponse(302, headers={"Location": url})}
        )
        with self.assertRaises(DownloadError) as raised:
            open_asset(session, GITHUB, url)
        self.assertEqual(raised.exception.code, "too_many_redirects")

    def test_network_failures_have_codes(self):
        for error, code in (
            (requests.Timeout(), "timeout"),
            (requests.ConnectionError(), "unreachable"),
        ):

            class Failing(FakeSession):
                def get(self, *args, error=error, **kwargs):
                    raise error

            with self.subTest(code=code), self.assertRaises(DownloadError) as raised:
                open_asset(Failing(), GITHUB, GITHUB.asset_url("1.5.0", "x"))
            self.assertEqual(raised.exception.code, code)


class FetchSmallTest(SimpleTestCase):
    def test_reads_the_whole_file(self):
        session = release_session(files={"SHA256SUMS": b"abc"})
        self.assertEqual(
            fetch_small(session, GITHUB, "1.5.0", "SHA256SUMS", 100), b"abc"
        )

    def test_a_missing_file_is_named(self):
        with self.assertRaises(DownloadError) as raised:
            fetch_small(FakeSession(), GITHUB, "1.5.0", "SHA256SUMS", 100)
        self.assertEqual(raised.exception.code, "missing_sha256sums")

    def test_other_answers_and_oversized_files_fail(self):
        url = GITHUB.asset_url("1.5.0", "SHA256SUMS")
        session = FakeSession({url: lambda headers: FakeResponse(500)})
        with self.assertRaises(DownloadError) as raised:
            fetch_small(session, GITHUB, "1.5.0", "SHA256SUMS", 100)
        self.assertEqual(raised.exception.code, "http_500")
        session = release_session(files={"SHA256SUMS": b"x" * 101})
        with self.assertRaises(DownloadError) as raised:
            fetch_small(session, GITHUB, "1.5.0", "SHA256SUMS", 100)
        self.assertEqual(raised.exception.code, "too_large")


class ParseChecksumsTest(SimpleTestCase):
    def test_finds_the_named_file(self):
        digest = "A" * 64
        text = f"{'b' * 64}  librephotos-1.5.0-windows-x64.zip\n{digest}  librephotos-windows-x64.zip\n"
        self.assertEqual(
            parse_checksums(text, "librephotos-windows-x64.zip"), digest.lower()
        )
        self.assertEqual(parse_checksums(f"{digest} *a.zip", "a.zip"), digest.lower())

    def test_a_missing_or_malformed_line_fails(self):
        for text in ("", "xyz  a.zip", f"{'a' * 64}  b.zip", f"{'a' * 63}  a.zip"):
            with self.subTest(text=text), self.assertRaises(DownloadError) as raised:
                parse_checksums(text, "a.zip")
            self.assertEqual(raised.exception.code, "no_checksum")


class DownloadAssetTest(SimpleTestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.target = Path(folder.name) / "a.zip.part"
        self.url = GITHUB.asset_url("1.5.0", "a.zip")
        self.progress = []

    def download(self, session, limit=10**6):
        download_asset(
            session,
            GITHUB,
            self.url,
            Target(self.target, limit, lambda *args: self.progress.append(args)),
        )

    def test_a_fresh_download(self):
        self.download(release_session(files={"a.zip": DATA}))
        self.assertEqual(self.target.read_bytes(), DATA)
        self.assertEqual(self.progress[-1], (len(DATA), len(DATA)))

    def test_an_interrupted_download_resumes_where_it_stopped(self):
        with self.assertRaises(DownloadError) as raised:
            self.download(release_session(files={"a.zip": DATA}, break_after=4000))
        self.assertEqual(raised.exception.code, "interrupted")
        self.assertEqual(self.target.stat().st_size, 4000)
        session = release_session(files={"a.zip": DATA})
        self.download(session)
        self.assertEqual(session.requests[-1][1], {"Range": "bytes=4000-"})
        self.assertEqual(self.target.read_bytes(), DATA)
        self.assertEqual(self.progress[-1], (len(DATA), len(DATA)))

    def test_a_server_that_ignores_range_starts_over(self):
        self.target.write_bytes(b"old bytes")
        self.download(release_session(files={"a.zip": DATA}, honour_range=False))
        self.assertEqual(self.target.read_bytes(), DATA)

    def test_a_complete_file_is_left_to_the_checksum(self):
        self.target.write_bytes(DATA)
        self.download(release_session(files={"a.zip": DATA}))
        self.assertEqual(self.target.read_bytes(), DATA)

    def test_a_range_answer_that_does_not_continue_the_file_fails(self):
        self.target.write_bytes(b"x" * 10)
        session = FakeSession(
            {
                self.url: lambda headers: FakeResponse(
                    206, b"y", {"Content-Range": "bytes 0-0/1"}
                )
            }
        )
        with self.assertRaises(DownloadError) as raised:
            self.download(session)
        self.assertEqual(raised.exception.code, "bad_range")

    def test_an_unsized_range_answer_is_accepted(self):
        self.target.write_bytes(DATA[:10])
        session = FakeSession(
            {
                self.url: lambda headers: FakeResponse(
                    206, DATA[10:], {"Content-Range": f"bytes 10-{len(DATA) - 1}/*"}
                )
            }
        )
        self.download(session)
        self.assertEqual(self.target.read_bytes(), DATA)
        self.assertEqual(self.progress[-1], (len(DATA), None))

    def test_errors_and_sizes_over_the_limit_stop_it(self):
        session = FakeSession({self.url: lambda headers: FakeResponse(403)})
        with self.assertRaises(DownloadError) as raised:
            self.download(session)
        self.assertEqual(raised.exception.code, "http_403")
        with self.assertRaises(DownloadError) as raised:
            self.download(release_session(files={"a.zip": DATA}), limit=100)
        self.assertEqual(raised.exception.code, "too_large")
        # A server that does not say the size is cut off at the limit.
        self.target.unlink(missing_ok=True)
        unsized = FakeSession({self.url: lambda headers: FakeResponse(200, DATA)})
        with self.assertRaises(DownloadError) as raised:
            self.download(unsized, limit=100)
        self.assertEqual(raised.exception.code, "too_large")


class Sha256Test(SimpleTestCase):
    def test_matches_hashlib(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "f"
            path.write_bytes(DATA)
            self.assertEqual(sha256_file(path), hashlib.sha256(DATA).hexdigest())


class LocalSourceTest(SimpleTestCase):
    def test_a_test_source_names_its_own_host(self):
        source = ReleaseSource(
            "http://127.0.0.1:9/dl", frozenset({"127.0.0.1"}), frozenset({"http"})
        )
        self.assertEqual(
            source.asset_url("1.5.0", "x"), "http://127.0.0.1:9/dl/1.5.0/x"
        )
        self.assertEqual(source.check("http://127.0.0.1:9/x"), "http://127.0.0.1:9/x")
        response = serve_bytes(b"abc", {"Range": "bytes=1-"})
        self.assertEqual(response.status_code, 206)
