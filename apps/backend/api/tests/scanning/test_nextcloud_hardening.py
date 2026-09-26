"""The Nextcloud integration only talks to safe servers and writes safely.

* ``nextcloud.server_address`` resolves the server address and refuses it if
  any address it resolves to is loopback, link-local, multicast, unspecified or
  reserved; private network addresses follow NEXTCLOUD_ALLOW_PRIVATE_ADDRESSES.
  Listing, scanning and saving the address all go through it.
* ``nextcloud.directory_watcher.scan_photos`` keeps every download inside the
  user's download directory and only ever leaves complete files behind.
"""

import os
import shutil
import tempfile
import uuid
from unittest import mock

import requests
from constance.test import override_config
from django.test import SimpleTestCase, TestCase, override_settings
from rest_framework.test import APIClient

from api.models import LongRunningJob
from api.serializers.user import UserSerializer
from api.tests.utils import create_test_user, patch_nextcloud_dns
from nextcloud import directory_watcher
from nextcloud.server_address import (
    GuardedClient,
    UnsafeServerAddress,
    is_safe_server_address,
    validate_server_address,
)

LISTDIR_URL = "/api/nextcloud/listdir/?fpath=/"
SCANPHOTOS_URL = "/api/nextcloud/scanphotos"


class ValidateServerAddressTest(SimpleTestCase):
    def setUp(self):
        dns = patch_nextcloud_dns(
            {
                "localhost": ["127.0.0.1", "::1"],
                "nextcloud": ["172.18.0.4"],
                "cloud.lan": ["192.168.1.20"],
                "cloud.tailnet": ["100.101.102.103"],
                "cloud.ula": ["fd12:3456:789a::1"],
                "metadata.example": ["169.254.169.254"],
                "split.example": ["93.184.215.14", "10.0.0.1", "127.0.0.1"],
                "cloud.v6.example": ["2606:4700:4700::1111"],
                "unknown.example": [],
            }
        )
        dns.start()
        self.addCleanup(dns.stop)

    def assertRefused(self, url):
        with self.assertRaises(UnsafeServerAddress, msg=url):
            validate_server_address(url)

    def test_public_addresses_are_accepted(self):
        for url in (
            "https://cloud.example.com",
            "http://cloud.example.com:8080/nextcloud/",
            "https://93.184.215.14",
            "https://cloud.v6.example",
            "https://[2606:4700:4700::1111]/",
        ):
            self.assertTrue(is_safe_server_address(url), url)

    def test_only_http_and_https_are_accepted(self):
        for url in (
            "",
            "   ",
            "cloud.example.com",
            "ftp://cloud.example.com",
            "file:///etc/passwd",
            "gopher://cloud.example.com",
            "https://",
            "https://cloud.example.com:notaport/",
        ):
            self.assertRefused(url)

    def test_special_addresses_are_refused(self):
        for url in (
            "http://127.0.0.1",
            "http://127.0.0.1:8000/api/",
            "http://[::1]:8080",
            "http://0.0.0.0",
            "http://0.1.2.3",
            "http://[::]",
            "http://169.254.169.254/latest/meta-data/",
            "http://[fe80::1]",
            "http://224.0.0.1",
            "http://240.0.0.1",
            "http://255.255.255.255",
            # IPv6 spellings of IPv4 loopback / link-local
            "http://[::ffff:127.0.0.1]",
            "http://[::ffff:169.254.169.254]",
            "http://[64:ff9b::7f00:1]",
            "http://[2002:7f00:1::]",
        ):
            self.assertRefused(url)

    def test_host_names_are_judged_by_what_they_resolve_to(self):
        self.assertRefused("http://localhost:8080")
        self.assertRefused("https://metadata.example")

    def test_one_unsafe_resolved_address_is_enough_to_refuse(self):
        self.assertRefused("https://split.example")

    def test_unresolvable_host_is_refused(self):
        self.assertRefused("https://unknown.example")

    def test_private_network_addresses_are_allowed_by_default(self):
        for url in (
            "http://192.168.1.20",
            "http://10.0.0.5:8080",
            "http://nextcloud",
            "https://cloud.lan",
            "https://cloud.tailnet",
            "https://cloud.ula",
        ):
            self.assertTrue(is_safe_server_address(url), url)

    @override_settings(NEXTCLOUD_ALLOW_PRIVATE_ADDRESSES=False)
    def test_private_network_addresses_can_be_disallowed(self):
        for url in (
            "http://192.168.1.20",
            "http://10.0.0.5:8080",
            "http://nextcloud",
            "https://cloud.lan",
            "https://cloud.tailnet",
            "https://cloud.ula",
            "http://[::ffff:192.168.1.20]",
        ):
            self.assertRefused(url)
        self.assertTrue(is_safe_server_address("https://cloud.example.com"))


class GuardedClientRedirectTest(SimpleTestCase):
    def setUp(self):
        dns = patch_nextcloud_dns({"localhost": ["127.0.0.1"]})
        dns.start()
        self.addCleanup(dns.stop)

    def _hook(self):
        nc = GuardedClient("https://cloud.example.com")
        nc._session = requests.Session()
        hooks = nc._session.hooks["response"]
        self.assertEqual(1, len(hooks))
        return hooks[0]

    @staticmethod
    def _response(status, location=None):
        response = requests.Response()
        response.status_code = status
        response.url = "https://cloud.example.com/status.php"
        if location:
            response.headers["location"] = location
        return response

    def test_session_created_by_login_carries_the_redirect_check(self):
        nc = GuardedClient("https://cloud.example.com")
        with mock.patch.object(GuardedClient, "_update_capabilities"):
            nc.login("alice", "app-password")
        self.assertEqual(1, len(nc._session.hooks["response"]))

    def test_redirect_to_unsafe_host_is_refused(self):
        hook = self._hook()
        for location in (
            "http://169.254.169.254/latest/meta-data/",
            "http://localhost:8001/",
        ):
            with self.assertRaises(UnsafeServerAddress):
                hook(self._response(302, location))

    def test_safe_redirects_and_plain_responses_pass(self):
        hook = self._hook()
        hook(self._response(301, "https://cloud.example.com/nextcloud/status.php"))
        hook(self._response(302, "/index.php/login"))
        hook(self._response(200))


@override_config(NEXTCLOUD_ENABLED=True)
class NextcloudViewsRefuseUnsafeAddressTest(TestCase):
    def setUp(self):
        dns = patch_nextcloud_dns({"nextcloud.internal": ["127.0.0.1"]})
        dns.start()
        self.addCleanup(dns.stop)
        self.client = APIClient()

    def _login(self, address):
        user = create_test_user(
            nextcloud_server_address=address,
            nextcloud_username="alice",
            nextcloud_app_password="app-password",
            nextcloud_scan_directory="/Photos",
        )
        self.client.force_authenticate(user=user)
        return user

    def test_listdir_refuses_unsafe_addresses_without_connecting(self):
        for address in ("http://127.0.0.1:8000", "http://nextcloud.internal"):
            self._login(address)
            with mock.patch("nextcloud.server_address.GuardedClient") as client:
                response = self.client.get(LISTDIR_URL)
            self.assertEqual(400, response.status_code, address)
            self.assertFalse(response.json()["status"])
            client.assert_not_called()

    def test_scanphotos_refuses_unsafe_addresses_without_queueing(self):
        for address in ("", "http://127.0.0.1:8000", "http://nextcloud.internal"):
            self._login(address)
            with mock.patch("nextcloud.views.AsyncTask") as async_task:
                response = self.client.post(SCANPHOTOS_URL)
            self.assertEqual(400, response.status_code, address)
            self.assertFalse(response.json()["status"])
            async_task.assert_not_called()

    def test_scanphotos_reports_a_job_that_could_not_start_as_an_error(self):
        self._login("https://cloud.example.com")
        with mock.patch("nextcloud.views.AsyncTask") as async_task:
            async_task.return_value.run.side_effect = RuntimeError("broker down")
            response = self.client.post(SCANPHOTOS_URL)
        self.assertEqual(500, response.status_code)
        self.assertFalse(response.json()["status"])


class UserSerializerServerAddressTest(TestCase):
    def setUp(self):
        dns = patch_nextcloud_dns({"nextcloud.internal": ["127.0.0.1"]})
        dns.start()
        self.addCleanup(dns.stop)
        self.user = create_test_user()

    def _serializer(self, address):
        return UserSerializer(
            instance=self.user,
            data={"nextcloud_server_address": address},
            partial=True,
        )

    def test_unsafe_address_is_rejected_on_save(self):
        for address in (
            "http://127.0.0.1:8000",
            "http://nextcloud.internal",
            "file:///etc/passwd",
        ):
            serializer = self._serializer(address)
            self.assertFalse(serializer.is_valid(), address)
            self.assertIn("nextcloud_server_address", serializer.errors)

    def test_safe_and_empty_addresses_are_accepted(self):
        for address in ("https://cloud.example.com", " https://cloud.lan/ ", ""):
            serializer = self._serializer(address)
            self.assertTrue(serializer.is_valid(), serializer.errors)
        serializer = self._serializer(" https://cloud.lan/ ")
        serializer.is_valid(raise_exception=True)
        self.assertEqual(
            "https://cloud.lan/", serializer.validated_data["nextcloud_server_address"]
        )

    def test_unchanged_stored_address_does_not_block_other_changes(self):
        # Stored before validation existed; the settings page sends it back
        # with every save. It is checked again whenever it is used instead.
        self.user.nextcloud_server_address = "http://127.0.0.1:8000"
        self.user.save()
        serializer = UserSerializer(
            instance=self.user,
            data={
                "nextcloud_server_address": "http://127.0.0.1:8000",
                "first_name": "Alice",
            },
            partial=True,
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)


class LocalPathForTest(SimpleTestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.root = os.path.join(self.tmp, "nextcloud_media", "alice")
        os.makedirs(self.root)

    def test_remote_paths_map_below_the_root(self):
        self.assertEqual(
            os.path.join(self.root, "Photos", "2024", "a.jpg"),
            directory_watcher.local_path_for(self.root, "/Photos/2024/a.jpg"),
        )
        self.assertEqual(
            os.path.join(self.root, "Photos", "b.jpg"),
            directory_watcher.local_path_for(self.root, "/Photos/x/../b.jpg"),
        )

    def test_paths_leaving_the_root_are_refused(self):
        for remote in (
            "",
            "/",
            "/..",
            "/../bob/a.jpg",
            "/Photos/../../bob/a.jpg",
            "/Photos/../../../../etc/cron.d/x",
            "/../../../protected_media/thumbnails/a.jpg",
        ):
            self.assertIsNone(
                directory_watcher.local_path_for(self.root, remote), remote
            )

    def test_symlinks_inside_the_root_cannot_lead_outside(self):
        outside = os.path.join(self.tmp, "outside")
        os.makedirs(outside)
        try:
            os.symlink(outside, os.path.join(self.root, "link"))
        except (OSError, NotImplementedError):
            self.skipTest("cannot create symlinks here")
        self.assertIsNone(directory_watcher.local_path_for(self.root, "/link/a.jpg"))

    @override_settings(DATA_ROOT="/data")
    def test_user_name_must_make_its_own_directory(self):
        user = mock.Mock(username="..")
        with self.assertRaises(ValueError):
            directory_watcher.user_media_root(user)
        user.username = "alice"
        self.assertEqual(
            os.path.join("/data", "nextcloud_media", "alice"),
            directory_watcher.user_media_root(user),
        )


class ScanPhotosDownloadTest(TestCase):
    def setUp(self):
        dns = patch_nextcloud_dns()
        dns.start()
        self.addCleanup(dns.stop)
        self.data_root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.data_root, ignore_errors=True)
        settings_override = override_settings(DATA_ROOT=self.data_root)
        settings_override.enable()
        self.addCleanup(settings_override.disable)
        self.user = create_test_user(
            nextcloud_server_address="https://cloud.example.com",
            nextcloud_username="alice",
            nextcloud_app_password="app-password",
            nextcloud_scan_directory="/Photos",
        )
        self.root = os.path.join(self.data_root, "nextcloud_media", self.user.username)
        self.nc = mock.MagicMock()
        self.nc.get_file.side_effect = self._write_file
        self.handle_new_image = self._patch(
            "nextcloud.directory_watcher.handle_new_image"
        )
        self._patch("nextcloud.directory_watcher.build_image_similarity_index")
        self._patch("nextcloud.server_address.GuardedClient", return_value=self.nc)

    def _patch(self, target, **kwargs):
        patcher = mock.patch(target, **kwargs)
        self.addCleanup(patcher.stop)
        return patcher.start()

    @staticmethod
    def _write_file(remote_path, local_path):
        with open(local_path, "wb") as f:
            f.write(b"complete:" + remote_path.encode())
        return True

    def _scan(self, remote_paths):
        def collect(nc, path, photos):
            photos.extend(remote_paths)

        job_id = uuid.uuid4()
        with mock.patch(
            "nextcloud.directory_watcher.collect_photos", side_effect=collect
        ):
            result = directory_watcher.scan_photos(self.user, job_id)
        return result, LongRunningJob.objects.get(job_id=str(job_id))

    def _handled(self):
        return [c.args[1] for c in self.handle_new_image.call_args_list]

    def _all_files(self):
        found = []
        for dirpath, _, files in os.walk(self.data_root):
            found.extend(os.path.join(dirpath, f) for f in files)
        return found

    def test_paths_leaving_the_download_directory_are_skipped(self):
        result, job = self._scan(
            [
                "/Photos/a.jpg",
                "/../../escape.jpg",
                "/Photos/../../../../escape2.jpg",
                "/Photos/../../otheruser/b.jpg",
            ]
        )

        self.assertTrue(result["status"])
        self.assertFalse(job.failed)
        expected = os.path.join(self.root, "Photos", "a.jpg")
        self.assertEqual([expected], self._handled())
        self.assertEqual([expected], self._all_files())
        self.assertEqual(
            ["/Photos/a.jpg"], [c.args[0] for c in self.nc.get_file.call_args_list]
        )

    def test_interrupted_download_leaves_no_file_behind_and_is_retried(self):
        def interrupted(remote_path, local_path):
            with open(local_path, "wb") as f:
                f.write(b"trunc")
            raise requests.exceptions.ConnectionError("connection reset")

        self.nc.get_file.side_effect = interrupted
        result, job = self._scan(["/Photos/a.jpg"])

        self.assertFalse(result["status"])
        self.assertTrue(job.failed)
        self.assertEqual([], self._all_files())

        self.nc.get_file.side_effect = self._write_file
        result, job = self._scan(["/Photos/a.jpg"])

        self.assertTrue(result["status"])
        local_path = os.path.join(self.root, "Photos", "a.jpg")
        self.assertEqual([local_path], self._all_files())
        with open(local_path, "rb") as f:
            self.assertEqual(b"complete:/Photos/a.jpg", f.read())

    def test_file_the_server_did_not_return_is_not_imported(self):
        self.nc.get_file.side_effect = None
        self.nc.get_file.return_value = False

        result, _ = self._scan(["/Photos/a.jpg"])

        self.assertTrue(result["status"])
        self.assertEqual([], self._handled())
        self.assertEqual([], self._all_files())

    def test_existing_files_are_not_downloaded_again(self):
        local_path = os.path.join(self.root, "Photos", "a.jpg")
        os.makedirs(os.path.dirname(local_path))
        with open(local_path, "wb") as f:
            f.write(b"already here")

        self._scan(["/Photos/a.jpg"])

        self.nc.get_file.assert_not_called()
        self.assertEqual([local_path], self._handled())

    def test_unsafe_server_address_fails_the_job_without_connecting(self):
        self.user.nextcloud_server_address = "http://127.0.0.1:8000"
        self.user.save()
        with mock.patch("nextcloud.server_address.GuardedClient") as client:
            result, job = self._scan(["/Photos/a.jpg"])
        self.assertFalse(result["status"])
        self.assertTrue(job.failed)
        client.assert_not_called()
