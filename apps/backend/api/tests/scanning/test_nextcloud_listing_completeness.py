"""A Nextcloud listing is either read as the folder or refused, and a walk
holds a bounded amount of it.

* The listed folder is never its own entry, also at the root.
* A folder path with repeated slashes lists the folder it names.
* An answer that names neither the folder nor anything in it, or that is no
  multistatus, is refused: it is never read as an empty folder.
* A server address with a ``.`` or ``..`` folder is refused.
* Of each entry only the path and the properties the scan reads are kept,
  each bounded, and the walk stops at a number of folders and of bytes held.
"""

import sys
from unittest import mock

from constance.test import override_config
from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIClient

from api.tests.scanning.test_nextcloud_webdav import WITH_CHUNKING, FakeNextcloud
from api.tests.scanning.test_nextcloud_webdav_bounds import FakeTree, listing
from api.tests.utils import create_test_user, patch_nextcloud_dns
from nextcloud import directory_watcher, webdav
from nextcloud.directory_watcher import (
    NextcloudWalkLimitError,
    collect_photos,
    retained_bytes,
)
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
    clean_path,
)


class _Login:
    def setUp(self):
        dns = patch_nextcloud_dns()
        dns.start()
        self.addCleanup(dns.stop)
        self.nc = GuardedClient("https://cloud.example/")
        self.fake = FakeNextcloud()
        self.nc._session.mount("https://", self.fake)
        self.fake.answer("GET", "/ocs/v1.php/cloud/capabilities", 200, WITH_CHUNKING)
        self.nc.login("anna", "app-password")

    def answer(self, folder, body, status=207):
        self.fake.answer("PROPFIND", "/remote.php/webdav" + folder, status, body)


class _LoggedIn(_Login, SimpleTestCase):
    pass


class FolderItselfTest(_LoggedIn):
    def test_the_root_does_not_list_itself(self):
        self.answer("/", listing("/", "/Photos/", "/a.jpg"))
        self.assertEqual([f.path for f in self.nc.list("/")], ["/Photos/", "/a.jpg"])

    def test_an_empty_root_is_empty(self):
        self.answer("/", listing("/"))
        self.assertEqual(self.nc.list("/"), [])


class FolderDialogTest(_Login, TestCase):
    @override_config(NEXTCLOUD_ENABLED=True)
    def test_the_folder_dialog_at_the_root_has_no_untitled_entry(self):
        user = create_test_user(
            nextcloud_server_address="https://cloud.example/",
            nextcloud_username="anna",
            nextcloud_app_password="app-password",
        )
        self.answer("/", listing("/", "/Photos/", "/a.jpg"))
        client = APIClient()
        client.force_authenticate(user=user)
        with mock.patch("nextcloud.server_address.GuardedClient", return_value=self.nc):
            response = client.get("/api/nextcloud/listdir/?fpath=/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(
            response.json(),
            [{"absolute_path": "/Photos/", "title": "Photos", "children": []}],
        )


class RepeatedSlashesTest(_LoggedIn):
    def test_clean_path(self):
        for path, cleaned in (
            ("/A//", "/A/"),
            ("//A/", "/A/"),
            ("A", "/A"),
            ("///", "/"),
            ("/A//B///c.jpg", "/A/B/c.jpg"),
        ):
            with self.subTest(path=path):
                self.assertEqual(clean_path(path), cleaned)

    def test_a_scan_directory_with_repeated_slashes_lists_its_folder(self):
        self.answer("/A/", listing("/A/", "/A/x.jpg", "/A/Sub/"))
        for path in ("/A", "/A/", "/A//", "//A/", "//A//"):
            with self.subTest(path=path):
                self.assertEqual(
                    [f.path for f in self.nc.list(path)], ["/A/x.jpg", "/A/Sub/"]
                )


class MisreadAnswersAreRefusedTest(_LoggedIn):
    def test_entries_none_of_them_in_the_folder(self):
        self.answer("/A/", listing("/B/", "/B/x.jpg", "/A/Sub/deeper.jpg"))
        with self.assertRaisesMessage(InvalidAnswerError, "does not list the folder"):
            self.nc.list("/A/")

    def test_entries_all_outside_the_webdav_root(self):
        body = (
            b"<d:multistatus xmlns:d='DAV:'>"
            b"<d:response><d:href>/a/../nc/remote.php/webdav/A/</d:href></d:response>"
            b"<d:response><d:href>/elsewhere/A/x.jpg</d:href></d:response>"
            b"</d:multistatus>"
        )
        self.answer("/A/", body)
        with self.assertRaisesMessage(InvalidAnswerError, "does not list the folder"):
            self.nc.list("/A/")

    def test_no_entries_at_all(self):
        self.answer("/A/", b"<d:multistatus xmlns:d='DAV:'/>")
        with self.assertRaisesMessage(InvalidAnswerError, "does not list the folder"):
            self.nc.list("/A/")

    def test_an_answer_that_is_no_multistatus(self):
        self.answer("/A/", b"", status=200)
        with self.assertRaisesMessage(InvalidAnswerError, "no listing"):
            self.nc.list("/A/")

    def test_the_folder_and_only_entries_outside_it_is_incomplete(self):
        self.answer("/A/", listing("/A/", "/B/x.jpg", "/A/Sub/deeper.jpg", "/"))
        found = self.nc.list("/A/")
        self.assertEqual(found, [])
        self.assertEqual(found.skipped, 3)

    def test_what_does_not_count_as_left_out(self):
        # The folder itself (also under the other WebDAV root), and entries
        # in it whatever they are.
        body = listing("/A/", "/A/notes.txt", "/A/Sub/")[: -len("</d:multistatus>")] + (
            b"<d:response><d:href>/remote.php/dav/files/anna/A/</d:href></d:response>"
            b"<d:response><d:href>/remote.php/dav/files/anna/A/y.jpg</d:href></d:response>"
            b"</d:multistatus>"
        )
        self.answer("/A/", body)
        found = self.nc.list("/A/")
        self.assertEqual(
            [f.path for f in found], ["/A/notes.txt", "/A/Sub/", "/A/y.jpg"]
        )
        self.assertEqual(found.skipped, 0)

    def test_an_empty_folder_is_empty(self):
        self.answer("/A/", listing("/A/"))
        self.assertEqual(self.nc.list("/A/"), [])

    def test_entries_left_out_are_counted(self):
        body = listing("/A/", "/A/x.jpg")[: -len("</d:multistatus>")] + (
            b"<d:response><d:href>/elsewhere/y.jpg</d:href></d:response>"
            b"<d:response><d:href>/remote.php/webdav/A/%5Cz.jpg</d:href></d:response>"
            b"</d:multistatus>"
        )
        self.answer("/A/", body)
        found = self.nc.list("/A/")
        self.assertEqual([f.path for f in found], ["/A/x.jpg"])
        self.assertEqual(found.skipped, 2)


class DotSegmentsInTheAddressTest(SimpleTestCase):
    def setUp(self):
        dns = patch_nextcloud_dns()
        dns.start()
        self.addCleanup(dns.stop)

    def test_validation_refuses_them(self):
        for address in (
            "https://cloud.example.com/a/../nc",
            "https://cloud.example.com/a/..",
            "https://cloud.example.com/./nc",
            "https://cloud.example.com/nc/.",
            "https://cloud.example.com/a/%2e%2e/nc",
            "https://cloud.example.com/a/%2E/nc",
        ):
            with self.subTest(address=address):
                with self.assertRaisesMessage(UnsafeServerAddress, ". or .. folders"):
                    validate_server_address(address)
        for address in (
            "https://cloud.example.com/a..b/nc",
            "https://cloud.example.com/.nc/",
            "https://cloud.example.com/nc.../",
        ):
            with self.subTest(address=address):
                validate_server_address(address)

    def test_the_client_refuses_them_too(self):
        with self.assertRaises(UnexpectedHostError):
            NextcloudClient("https://cloud.example/a/../nc", mock.MagicMock())
        with self.assertRaises(UnsafeServerAddress):
            GuardedClient("https://cloud.example/a/%2e%2e/nc")


JUNK = b"<x:junk xmlns:x='urn:x'>" + b"A" * 100_000 + b"</x:junk>"


class WhatAnEntryKeepsTest(_LoggedIn):
    def test_only_the_properties_the_scan_reads(self):
        body = (
            b"<d:multistatus xmlns:d='DAV:'>"
            b"<d:response><d:href>/remote.php/webdav/A/</d:href></d:response>"
            b"<d:response><d:href>/remote.php/webdav/A/x.jpg</d:href>"
            b"<d:propstat><d:prop>"
            b"<d:getcontenttype>image/jpeg</d:getcontenttype>"
            b"<d:getcontentlength>123</d:getcontentlength>"
            b"<d:getlastmodified>Mon, 01 Jan 2024 00:00:00 GMT</d:getlastmodified>"
            b'<d:getetag>"e"</d:getetag>'
            + JUNK
            + b"<d:getcontentlanguage>"
            + b"B" * 300
            + b"</d:getcontentlanguage>"
            b"</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>"
            b"</d:response></d:multistatus>"
        )
        self.answer("/A/", body)
        (entry,) = self.nc.list("/A/")
        self.assertEqual(
            entry.attributes,
            {
                "{DAV:}getlastmodified": "Mon, 01 Jan 2024 00:00:00 GMT",
                "{DAV:}getcontentlength": "123",
                "{DAV:}getcontenttype": "image/jpeg",
            },
        )
        self.assertLess(retained_bytes(entry), 500)

    def test_a_value_too_long_is_dropped(self):
        entry = RemoteFile(
            "/A/x.jpg",
            {
                "{DAV:}getcontenttype": "image/" + "x" * 300,
                "{DAV:}getcontentlength": "123",
            },
        )
        self.assertEqual(entry.attributes, {"{DAV:}getcontentlength": "123"})

    def test_a_path_too_long_is_left_out(self):
        long_name = "/A/" + "n" * webdav.MAX_PATH_CHARS + ".jpg"
        self.answer("/A/", listing("/A/", "/A/x.jpg", long_name))
        found = self.nc.list("/A/")
        self.assertEqual([f.path for f in found], ["/A/x.jpg"])
        self.assertEqual(found.skipped, 1)

    def test_no_instance_dictionary(self):
        self.assertFalse(hasattr(RemoteFile("/a.jpg"), "__dict__"))


class WalkHoldsABoundedAmountTest(SimpleTestCase):
    def test_too_many_folders(self):
        fake = FakeTree(
            lambda p: [f"{p}{i}/" for i in range(3)] if p.count("/") < 6 else []
        )
        with mock.patch.object(directory_watcher, "MAX_FOLDERS", 10):
            with self.assertRaisesMessage(
                NextcloudWalkLimitError, "more than 10 folders"
            ):
                collect_photos(fake, "/", [])
        self.assertEqual(len(fake.listed), 10)

    def test_too_many_bytes(self):
        fake = FakeTree(
            lambda p: [f"/{i:04}.jpg" for i in range(100)] if p == "/" else []
        )
        per_entry = retained_bytes(fake.list("/")[0])
        fake.listed.clear()
        with mock.patch.object(directory_watcher, "MAX_WALK_BYTES", 50 * per_entry):
            with self.assertRaisesMessage(NextcloudWalkLimitError, "MiB of file names"):
                collect_photos(fake, "/", [])

    def test_a_walk_says_whether_every_listing_was_complete(self):
        class Skipping(FakeTree):
            def list(self, path):
                found = webdav.Listing(super().list(path))
                found.skipped = 1 if path == "/S/" else 0
                return found

        tree = {"/": ["/a.jpg", "/S/"], "/S/": ["/S/b.jpg"]}
        photos = []
        self.assertFalse(collect_photos(Skipping(lambda p: tree[p]), "/", photos))
        self.assertEqual([p.path for p in photos], ["/a.jpg", "/S/b.jpg"])
        self.assertTrue(collect_photos(FakeTree(lambda p: tree[p]), "/", []))

    def test_a_typical_entry(self):
        entry = RemoteFile(
            "/Photos/2024/2024-06-01 Holiday/IMG_20240601_123456.jpg",
            {
                "{DAV:}getcontenttype": "image/jpeg",
                "{DAV:}getcontentlength": "4823412",
                "{DAV:}getlastmodified": "Sat, 01 Jun 2024 10:34:56 GMT",
            },
        )
        # The object and three strings; the MIME type is shared.
        self.assertLess(retained_bytes(entry), 400)
        self.assertLess(sys.getsizeof(entry), 100)
