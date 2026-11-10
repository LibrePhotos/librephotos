"""The Nextcloud client (nextcloud/webdav.py) that replaced pyocclient.

Requests go to a fake transport mounted on the client's own guarded session,
so the redirect and certificate checks stay in place. The multistatus answers
in ``api/tests/fixtures/nextcloud/multistatus_cases.json`` were built from the
WebDAV spec (RFC 4918) and Nextcloud's format, and carry what pyocclient 0.6
made of each one: the listing must match it.
"""

import io
import json
import os
import tempfile
from pathlib import Path
from unittest import mock
from urllib.parse import urlparse

import requests
from django.test import SimpleTestCase

from api.tests.utils import patch_nextcloud_dns
from nextcloud import webdav
from nextcloud.server_address import GuardedClient, UnsafeServerAddress
from nextcloud.webdav import (
    InvalidAnswerError,
    RemoteFile,
    ResponseError,
    UnsafeRemotePathError,
)

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "nextcloud"

CAPABILITIES = b"""<?xml version="1.0"?>
<ocs><meta><status>ok</status><statuscode>100</statuscode><message>OK</message></meta>
<data><version><string>31.0.0</string><edition></edition></version>
<capabilities><core><pollinterval>60</pollinterval></core>%s</capabilities></data></ocs>"""
WITH_CHUNKING = CAPABILITIES % b"<dav><chunking>1.0</chunking></dav>"
WITHOUT_CHUNKING = CAPABILITIES % b""


class FakeNextcloud(requests.adapters.BaseAdapter):
    """Answers each request from ``answers`` by method and path; records them."""

    def __init__(self):
        super().__init__()
        self.answers = {}
        self.sent = []

    def answer(self, method, path, status, body=b"", headers=None):
        self.answers[(method, path)] = (status, body, headers or {})

    def send(self, request, stream=False, timeout=None, verify=True, **kwargs):
        self.sent.append((request, timeout, verify))
        key = (request.method, urlparse(request.url).path)
        status, body, headers = self.answers.get(key, (404, b"", {}))
        response = requests.Response()
        response.status_code = status
        response.raw = io.BytesIO(body)
        response.headers.update(headers)
        response.url = request.url
        response.request = request
        return response

    def close(self):
        pass


def client_for(server, user="anna", chunking=True):
    nc = GuardedClient(server)
    fake = FakeNextcloud()
    nc._session.mount("https://", fake)
    nc._session.mount("http://", fake)
    base = urlparse(server).path.rstrip("/")
    fake.answer(
        "GET",
        f"{base}/ocs/v1.php/cloud/capabilities",
        200,
        WITH_CHUNKING if chunking else WITHOUT_CHUNKING,
    )
    nc.login(user, "app-password")
    return nc, fake


class _Client(SimpleTestCase):
    def setUp(self):
        dns = patch_nextcloud_dns({"localhost": ["127.0.0.1"]})
        dns.start()
        self.addCleanup(dns.stop)


class LoginTest(_Client):
    def test_a_server_with_chunked_uploads_is_used_at_remote_php_webdav(self):
        nc, fake = client_for("https://cloud.example/")
        fake.answer(
            "PROPFIND",
            "/remote.php/webdav/",
            207,
            b"<d:multistatus xmlns:d='DAV:'><d:response><d:href>/remote.php/webdav/</d:href></d:response></d:multistatus>",
        )
        self.assertEqual(nc.list("/"), [])
        request, timeout, verify = fake.sent[-1]
        self.assertEqual(request.headers["Depth"], "1")
        self.assertEqual(
            request.headers["Authorization"],
            requests.auth._basic_auth_str("anna", "app-password"),
        )

    def test_any_other_at_its_files_root(self):
        nc, fake = client_for(
            "https://example.com/nextcloud", user="bob smith", chunking=False
        )
        fake.answer(
            "PROPFIND",
            "/nextcloud/remote.php/dav/files/bob%20smith/",
            207,
            b"<d:multistatus xmlns:d='DAV:'><d:response><d:href>/nextcloud/remote.php/dav/files/bob%20smith/</d:href></d:response></d:multistatus>",
        )
        self.assertEqual(nc.list("/"), [])

    def test_the_capabilities_request_is_an_ocs_request(self):
        _, fake = client_for("https://cloud.example/")
        request, _, _ = fake.sent[0]
        self.assertEqual(request.headers["OCS-APIREQUEST"], "true")

    def test_a_wrong_app_password_is_an_http_error_401(self):
        nc = GuardedClient("https://cloud.example/")
        fake = FakeNextcloud()
        nc._session.mount("https://", fake)
        fake.answer("GET", "/ocs/v1.php/cloud/capabilities", 401, b"")
        with self.assertRaisesMessage(ResponseError, "HTTP error: 401") as caught:
            nc.login("anna", "wrong")
        self.assertEqual(caught.exception.status_code, 401)

    def test_an_ocs_error_status(self):
        nc = GuardedClient("https://cloud.example/")
        fake = FakeNextcloud()
        nc._session.mount("https://", fake)
        fake.answer(
            "GET",
            "/ocs/v1.php/cloud/capabilities",
            200,
            b"<ocs><meta><statuscode>997</statuscode></meta><data/></ocs>",
        )
        with self.assertRaisesMessage(ResponseError, "OCS error: 997"):
            nc.login("anna", "app-password")

    def test_every_request_has_a_timeout_and_the_certificate_check(self):
        nc, fake = client_for("https://cloud.example/")
        fake.answer(
            "PROPFIND",
            "/remote.php/webdav/Photos/",
            207,
            b"<d:multistatus xmlns:d='DAV:'><d:response><d:href>/remote.php/webdav/Photos/</d:href></d:response></d:multistatus>",
        )
        fake.answer("GET", "/remote.php/webdav/Photos/a.jpg", 200, b"jpeg")
        nc.list("/Photos")
        with tempfile.TemporaryDirectory() as tmp:
            nc.get_file("/Photos/a.jpg", os.path.join(tmp, "a.jpg"))
        self.assertEqual(len(fake.sent), 3)
        for _, timeout, verify in fake.sent:
            self.assertEqual(timeout, webdav.TIMEOUT)
            self.assertIsNot(verify, False)

    def test_a_redirect_to_an_unsafe_host_is_not_followed(self):
        nc, fake = client_for("https://cloud.example/")
        fake.answer(
            "PROPFIND",
            "/remote.php/webdav/Photos/",
            302,
            headers={"location": "http://169.254.169.254/latest/meta-data/"},
        )
        with self.assertRaises(UnsafeServerAddress):
            nc.list("/Photos")
        self.assertEqual(len(fake.sent), 2)  # login, and the first hop only


class ListingMatchesPyocclientTest(_Client):
    """Every recorded answer gives the listing pyocclient gave (minus its first
    entry, the folder itself, which ``list`` left out), with the properties
    the scan reads (``KEPT_PROPERTIES``): the client keeps no others."""

    def test_every_recorded_answer(self):
        with open(FIXTURES / "multistatus_cases.json", encoding="utf-8") as handle:
            cases = json.load(handle)
        by_key = {
            (c["server"], c["endpoint"], c["name"], c["absolute"]): c for c in cases
        }
        for case in cases:
            # pyocclient kept absolute hrefs whole (a URL as the path); the
            # same answer with relative hrefs says what they name.
            relative = by_key[(case["server"], case["endpoint"], case["name"], False)]
            expected = [
                {
                    **entry,
                    "attributes": {
                        name: value
                        for name, value in entry["attributes"].items()
                        if name in webdav.KEPT_PROPERTIES and value is not None
                    },
                }
                for entry in relative["pyocclient"][1:]
            ]
            with self.subTest(
                server=case["server"],
                endpoint=case["endpoint"],
                name=case["name"],
                absolute=case["absolute"],
            ):
                chunking = case["endpoint"] == "remote.php/webdav"
                nc, fake = client_for(case["server"], case["user"], chunking=chunking)
                root = urlparse(case["server"]).path + case["endpoint"]
                fake.answer("PROPFIND", root + "/Photos/", 207, case["body"].encode())
                listed = nc.list("/Photos")
                self.assertEqual(
                    [
                        {
                            "path": f.path,
                            "is_dir": f.is_dir(),
                            "attributes": f.attributes,
                        }
                        for f in listed
                    ],
                    expected,
                )


def multistatus(*hrefs, prefix="/remote.php/webdav"):
    responses = "".join(
        f"<d:response><d:href>{href}</d:href><d:propstat><d:prop>"
        "<d:getcontenttype>image/jpeg</d:getcontenttype></d:prop>"
        "<d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>"
        for href in (f"{prefix}/Photos/", *hrefs)
    )
    return f"<d:multistatus xmlns:d='DAV:'>{responses}</d:multistatus>".encode()


class PathsTest(_Client):
    def setUp(self):
        super().setUp()
        self.nc, self.fake = client_for("https://cloud.example/")

    def listed(self, *hrefs):
        self.fake.answer(
            "PROPFIND", "/remote.php/webdav/Photos/", 207, multistatus(*hrefs)
        )
        return [item.path for item in self.nc.list("/Photos/")]

    def test_awkward_names_are_quoted_and_unquoted_exactly(self):
        name = "a b#c%d?e+f ü日.jpg"
        quoted = "a%20b%23c%25d%3Fe%2Bf%20%C3%BC%E6%97%A5.jpg"
        self.assertEqual(
            self.listed(f"/remote.php/webdav/Photos/{quoted}"), [f"/Photos/{name}"]
        )
        self.fake.answer("GET", f"/remote.php/webdav/Photos/{quoted}", 200, b"data")
        with tempfile.TemporaryDirectory() as tmp:
            target = os.path.join(tmp, "x")
            self.assertTrue(self.nc.get_file(f"/Photos/{name}", target))
            with open(target, "rb") as handle:
                self.assertEqual(handle.read(), b"data")
        request = self.fake.sent[-1][0]
        self.assertEqual(
            urlparse(request.url).path, f"/remote.php/webdav/Photos/{quoted}"
        )
        self.assertEqual(urlparse(request.url).query, "")

    def test_lowercase_percent_encoding_and_absolute_hrefs_on_the_same_server(self):
        self.assertEqual(
            self.listed(
                "/remote.php/webdav/Photos/%c3%bc.jpg",
                "https://cloud.example/remote.php/webdav/Photos/b.jpg",
                "/remote.php/webdav/Photos/Sub%20Folder/",
            ),
            ["/Photos/ü.jpg", "/Photos/b.jpg", "/Photos/Sub Folder/"],
        )

    def test_hrefs_outside_the_server_or_the_root_are_left_out(self):
        with self.assertLogs("nextcloud.webdav", "WARNING"):
            listed = self.listed(
                "https://evil.example/remote.php/webdav/Photos/a.jpg",
                "http://cloud.example/remote.php/webdav/Photos/b.jpg",
                "/index.php/apps/files/c.jpg",
                "/remote.php/webdavx/d.jpg",
                "/remote.php/webdav/Photos/../../etc/passwd",
                "/remote.php/webdav/Photos/%2e%2e/%2e%2e/secret",
                "/remote.php/webdav/Photos/a%5cb.jpg",
                "/remote.php/webdav/Photos/nul%00.jpg",
                "/remote.php/webdav/Photos/ok.jpg",
            )
        self.assertEqual(listed, ["/Photos/ok.jpg"])

    def test_the_other_root_is_accepted_too(self):
        self.assertEqual(
            self.listed("/remote.php/dav/files/anna/Photos/x.jpg"), ["/Photos/x.jpg"]
        )

    def test_paths_with_dot_segments_are_never_requested(self):
        for path in ("/Photos/../../etc", "/../x", "/a/./b", "/a\\b", "/a\nb"):
            with self.subTest(path=path):
                with self.assertRaises(UnsafeRemotePathError):
                    self.nc.list(path)
                with self.assertRaises(UnsafeRemotePathError):
                    self.nc.get_file(path, os.devnull)
        self.assertEqual(len(self.fake.sent), 1)  # the login only

    def test_files_and_folders(self):
        self.fake.answer(
            "PROPFIND",
            "/remote.php/webdav/Photos/",
            207,
            multistatus(
                "/remote.php/webdav/Photos/a.jpg", "/remote.php/webdav/Photos/Sub/"
            ),
        )
        files = self.nc.list("/Photos")
        self.assertEqual(
            [(f.path, f.is_dir()) for f in files],
            [("/Photos/a.jpg", False), ("/Photos/Sub/", True)],
        )
        self.assertIsInstance(files[0], RemoteFile)


class AnswersTest(_Client):
    def setUp(self):
        super().setUp()
        self.nc, self.fake = client_for("https://cloud.example/")

    def propfind(self, status, body):
        self.fake.answer("PROPFIND", "/remote.php/webdav/Photos/", status, body)
        return self.nc.list("/Photos")

    def test_document_types_and_entities_are_refused(self):
        for body in (
            b'<?xml version="1.0"?><!DOCTYPE d [<!ENTITY a "x">]><d:multistatus xmlns:d="DAV:"/>',
            b'<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;">]><lolz>&lol2;</lolz>',
            b'<?xml version="1.0"?><!DOCTYPE d SYSTEM "http://169.254.169.254/x.dtd"><d/>',
        ):
            with self.subTest(body=body), self.assertRaises(InvalidAnswerError):
                self.propfind(207, body)

    def test_an_answer_that_is_not_xml(self):
        with self.assertRaises(InvalidAnswerError):
            self.propfind(207, b"<html>Maintenance mode")

    def test_an_answer_too_large_is_not_read(self):
        with mock.patch.object(webdav, "MAX_LISTING_BYTES", 100):
            with self.assertRaisesMessage(InvalidAnswerError, "too large"):
                self.propfind(
                    207,
                    multistatus(
                        *[f"/remote.php/webdav/Photos/{i}.jpg" for i in range(10)]
                    ),
                )

    def test_error_statuses(self):
        for status in (401, 403, 404, 500, 503):
            with self.subTest(status=status):
                with self.assertRaisesMessage(ResponseError, f"HTTP error: {status}"):
                    self.propfind(status, b"")

    def test_missing_properties_and_href(self):
        body = (
            b"<d:multistatus xmlns:d='DAV:'>"
            b"<d:response><d:href>/remote.php/webdav/Photos/</d:href></d:response>"
            b"<d:response><d:href>/remote.php/webdav/Photos/bare.jpg</d:href></d:response>"
            b"<d:response><d:propstat/></d:response>"
            b"</d:multistatus>"
        )
        with self.assertLogs("nextcloud.webdav", "WARNING"):
            files = self.propfind(207, body)
        self.assertEqual(
            [(f.path, f.attributes) for f in files], [("/Photos/bare.jpg", {})]
        )

    def test_a_download_error_and_a_download_without_content(self):
        self.fake.answer("GET", "/remote.php/webdav/Photos/gone.jpg", 404)
        with self.assertRaisesMessage(ResponseError, "HTTP error: 404"):
            self.nc.get_file("/Photos/gone.jpg", os.devnull)
        self.fake.answer("GET", "/remote.php/webdav/Photos/empty.jpg", 204)
        with tempfile.TemporaryDirectory() as tmp:
            target = os.path.join(tmp, "x")
            self.assertFalse(self.nc.get_file("/Photos/empty.jpg", target))
            self.assertFalse(os.path.exists(target))

    def test_a_download_is_streamed_to_the_file(self):
        body = os.urandom(3 * webdav.DOWNLOAD_CHUNK_BYTES + 17)
        self.fake.answer("GET", "/remote.php/webdav/Photos/big.mp4", 200, body)
        with tempfile.TemporaryDirectory() as tmp:
            target = os.path.join(tmp, "big.mp4")
            self.assertTrue(self.nc.get_file("/Photos/big.mp4", target))
            with open(target, "rb") as handle:
                self.assertEqual(handle.read(), body)
