"""Where the Nextcloud client sends its requests, and what one scan may cost.

* Every URL is built from the server address with the path between two ``/``
  and no query, fragment or parameters, so the host never changes; an address
  that carries them is refused when it is saved and when it is used.
* A listing is read as it arrives, bounded in bytes and in entries, and only
  the entries directly in the listed folder count.
* The scan's walk lists each folder once and stops at a depth and size no
  photo library reaches.
"""

from unittest import mock

from constance.test import override_config
from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIClient

from api.serializers.user import UserSerializer
from api.tests.scanning.test_nextcloud_webdav import (
    WITH_CHUNKING,
    FakeNextcloud,
)
from api.tests.utils import create_test_user, patch_nextcloud_dns
from nextcloud import directory_watcher, webdav
from nextcloud.directory_watcher import NextcloudWalkLimitError, collect_photos
from nextcloud.server_address import (
    GuardedClient,
    UnsafeServerAddress,
    validate_server_address,
)
from nextcloud.webdav import (
    InvalidAnswerError,
    NextcloudClient,
    RemoteFile,
    UnexpectedHostError,
    base_url,
)

EMPTY = b"<d:multistatus xmlns:d='DAV:'/>"


def only_folder(href):
    """A listing of an empty folder: the folder itself, nothing in it."""
    response = f"<d:response><d:href>{href}</d:href></d:response>"
    return f"<d:multistatus xmlns:d='DAV:'>{response}</d:multistatus>".encode()


def recorded(address):
    """A client for ``address`` after login and one listing: the URLs it asked for."""
    nc = GuardedClient(address)
    fake = FakeNextcloud()
    nc._session.mount("https://", fake)
    fake.answers = _Any(WITH_CHUNKING)
    nc.login("anna", "app-password")
    nc.list("/Photos")
    return [request.url for request, _, _ in fake.sent]


class _Any(dict):
    """Answers every GET with the capabilities and every PROPFIND with a listing."""

    def __init__(self, capabilities):
        super().__init__()
        self.capabilities = capabilities

    def get(self, key, default=None):
        method, path = key
        if method == "GET":
            return 200, self.capabilities, {}
        return 207, only_folder(path), {}


class _Client(SimpleTestCase):
    def setUp(self):
        dns = patch_nextcloud_dns()
        dns.start()
        self.addCleanup(dns.stop)


class UrlsTest(_Client):
    def test_the_exact_urls_requested(self):
        root = (
            "https://cloud.example/ocs/v1.php/cloud/capabilities",
            "https://cloud.example/remote.php/webdav/Photos/",
        )
        sub = (
            "https://cloud.example/nextcloud/ocs/v1.php/cloud/capabilities",
            "https://cloud.example/nextcloud/remote.php/webdav/Photos/",
        )
        for address, expected in (
            ("https://cloud.example", root),
            ("https://cloud.example/", root),
            ("https://cloud.example//", root),
            ("https://cloud.example/nextcloud", sub),
            ("https://cloud.example/nextcloud/", sub),
            # Refused when saved or used; the client alone still keeps the host.
            ("https://cloud.example?x", root),
            ("https://cloud.example#", root),
            ("https://cloud.example/;p", root),
            ("https://cloud.example/nextcloud?x", sub),
            ("https://cloud.example/nextcloud#frag", sub),
        ):
            with self.subTest(address=address):
                self.assertEqual(recorded(address), list(expected))

    def test_base_url(self):
        self.assertEqual(base_url("https://h"), "https://h/")
        self.assertEqual(base_url("https://h:8443/a/b?c=d#e"), "https://h:8443/a/b/")
        self.assertEqual(base_url(" https://h/a;p "), "https://h/a/")

    def test_a_request_to_another_host_is_refused(self):
        nc = NextcloudClient("https://cloud.example/", mock.MagicMock())
        for url in (
            "https://other.example/remote.php/webdav/",
            "http://cloud.example/remote.php/webdav/",
            "https://cloud.example:8443/remote.php/webdav/",
            "https://cloud.exampleremote.php/webdav/",
        ):
            with self.subTest(url=url), self.assertRaises(UnexpectedHostError):
                nc._request("GET", url)
        guarded = GuardedClient("https://cloud.example/")
        with self.assertRaises(UnsafeServerAddress):
            guarded._request("GET", "https://cloud.exampleremote.php/webdav/")


class AddressesWithQueriesAreRefusedTest(TestCase):
    def setUp(self):
        dns = patch_nextcloud_dns()
        dns.start()
        self.addCleanup(dns.stop)

    def test_validation(self):
        for address in (
            "https://cloud.example.com?x",
            "https://cloud.example.com#",
            "https://cloud.example.com;p",
            "https://cloud.example.com/sub?x",
            "https://cloud.example.com/sub;p/",
            "https://cloud.example.com?",
        ):
            with self.subTest(address=address), self.assertRaises(UnsafeServerAddress):
                validate_server_address(address)
        validate_server_address("https://cloud.example.com/nextcloud/")

    def test_on_save(self):
        user = create_test_user()
        serializer = UserSerializer(
            instance=user,
            data={"nextcloud_server_address": "https://cloud.example.com?x"},
            partial=True,
        )
        self.assertFalse(serializer.is_valid())
        self.assertIn("nextcloud_server_address", serializer.errors)

    @override_config(NEXTCLOUD_ENABLED=True)
    def test_a_stored_one_fails_closed_without_connecting(self):
        user = create_test_user(
            nextcloud_server_address="https://cloud.example.com?x",
            nextcloud_username="alice",
            nextcloud_app_password="app-password",
        )
        client = APIClient()
        client.force_authenticate(user=user)
        with mock.patch("requests.Session.request") as request:
            response = client.get("/api/nextcloud/listdir/?fpath=/")
        self.assertEqual(response.status_code, 400)
        self.assertIn("without ?, # or ;", response.json()["errors"][0]["message"])
        request.assert_not_called()


def listing(*paths):
    entries = "".join(
        f"<d:response><d:href>/remote.php/webdav{path}</d:href><d:propstat><d:prop>"
        "<d:getcontenttype>image/jpeg</d:getcontenttype></d:prop>"
        "<d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>"
        for path in paths
    )
    return f"<d:multistatus xmlns:d='DAV:'>{entries}</d:multistatus>".encode()


class ListingBoundsTest(_Client):
    def setUp(self):
        super().setUp()
        self.nc = GuardedClient("https://cloud.example/")
        self.fake = FakeNextcloud()
        self.nc._session.mount("https://", self.fake)
        self.fake.answer("GET", "/ocs/v1.php/cloud/capabilities", 200, WITH_CHUNKING)
        self.nc.login("anna", "app-password")

    def list(self, *paths):
        self.fake.answer("PROPFIND", "/remote.php/webdav/Photos/", 207, listing(*paths))
        return [item.path for item in self.nc.list("/Photos")]

    def test_only_entries_directly_in_the_folder(self):
        self.assertEqual(
            self.list(
                "/Photos/",
                "/",
                "/Other/x.jpg",
                "/Photos/Sub/deeper.jpg",
                "/Photos/Sub/",
                "/Photos/a.jpg",
                "/Photosx/b.jpg",
            ),
            ["/Photos/Sub/", "/Photos/a.jpg"],
        )

    def test_too_many_entries(self):
        with mock.patch.object(webdav, "MAX_LISTING_ENTRIES", 3):
            self.assertEqual(len(self.list(*[f"/Photos/{i}.jpg" for i in range(3)])), 3)
            with self.assertRaisesMessage(InvalidAnswerError, "too many entries"):
                self.list(*[f"/Photos/{i}.jpg" for i in range(4)])

    def test_too_many_bytes(self):
        body = listing(*[f"/Photos/{i}.jpg" for i in range(50)])
        with mock.patch.object(webdav, "MAX_LISTING_BYTES", len(body) - 1):
            with self.assertRaisesMessage(InvalidAnswerError, "too large"):
                self.list(*[f"/Photos/{i}.jpg" for i in range(50)])

    def test_the_answer_is_parsed_as_it_arrives(self):
        # Fed piece by piece: a body split anywhere gives the same listing.
        paths = [f"/Photos/{i} ü.jpg" for i in range(200)]
        with mock.patch.object(webdav, "DOWNLOAD_CHUNK_BYTES", 7):
            self.assertEqual(self.list(*paths), paths)


class FakeTree:
    """A Nextcloud folder tree for ``collect_photos``; counts listings."""

    def __init__(self, children):
        self.children = children
        self.listed = []

    def list(self, path):
        self.listed.append(path)
        return [
            RemoteFile(
                child, {"{DAV:}getcontenttype": "image/jpeg"}, child.endswith("/")
            )
            for child in self.children(path)
        ]


class WalkBoundsTest(SimpleTestCase):
    def test_order_is_depth_first_in_listing_order(self):
        tree = {
            "/P/": ["/P/a.jpg", "/P/S/", "/P/b.jpg"],
            "/P/S/": ["/P/S/c.jpg"],
        }
        photos = []
        collect_photos(FakeTree(lambda p: tree[p]), "/P/", photos)
        self.assertEqual(
            [p.path for p in photos], ["/P/a.jpg", "/P/S/c.jpg", "/P/b.jpg"]
        )

    def test_a_folder_named_twice_is_listed_once(self):
        fake = FakeTree(
            lambda p: ["/P/S/", "/P/S/", "/P/x.jpg"] if p == "/P/" else ["/P/"]
        )
        photos = []
        collect_photos(fake, "/P/", photos)
        self.assertEqual(fake.listed, ["/P/", "/P/S/"])

    def test_a_folder_too_deep(self):
        fake = FakeTree(lambda p: [p + "d/"])
        with mock.patch.object(directory_watcher, "MAX_FOLDER_DEPTH", 10):
            with self.assertRaisesMessage(
                NextcloudWalkLimitError, "more than 10 folders deep"
            ):
                collect_photos(fake, "/", [])
        self.assertEqual(len(fake.listed), 10)

    def test_a_folder_too_large(self):
        fake = FakeTree(lambda p: [f"{p}{i}/" for i in range(5)])
        with mock.patch.object(directory_watcher, "MAX_LISTED_ENTRIES", 20):
            with self.assertRaisesMessage(NextcloudWalkLimitError, "more than 20"):
                collect_photos(fake, "/", [])

    def test_a_deep_and_wide_real_library_is_walked(self):
        # 30 levels and 2,000 files: far inside the limits.
        def children(path):
            depth = path.count("/") - 1
            files = [f"{path}{i}.jpg" for i in range(60)] if depth % 3 == 0 else []
            return files + ([f"{path}level{depth}/"] if depth < 30 else [])

        photos = []
        collect_photos(FakeTree(children), "/", photos)
        self.assertEqual(len(photos), 60 * 11)
