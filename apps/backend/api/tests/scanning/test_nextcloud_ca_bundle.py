"""A Nextcloud with a self-signed certificate is trusted through NEXTCLOUD_CA_BUNDLE (#539).

The variable names a PEM file; the Nextcloud client checks the server's
certificate against it instead of the public authorities. Checking itself
cannot be switched off, a missing or broken file is a clear error before any
connection, and the SSRF guard (GHSA-xq77) works the same with a bundle set.
"""

import os
import shutil
import tempfile
from unittest import mock

import certifi
import requests
from constance.test import override_config
from django.test import SimpleTestCase, TestCase, override_settings
from rest_framework.test import APIClient

from api.models import LongRunningJob
from api.tests.utils import create_test_user, patch_nextcloud_dns
from nextcloud.server_address import (
    CABundleError,
    GuardedClient,
    UnsafeServerAddress,
    certificate_check,
)

LISTDIR_URL = "/api/nextcloud/listdir/?fpath=/"
SCANPHOTOS_URL = "/api/nextcloud/scanphotos"
MISSING = "does not exist"
UNREADABLE = "cannot be read as PEM certificates"


def _bundle_dir(test):
    directory = tempfile.mkdtemp()
    test.addCleanup(shutil.rmtree, directory, ignore_errors=True)
    return directory


def _pem_bundle(test):
    """A copy of certifi's bundle: real PEM certificates, in a path of our own."""
    path = os.path.join(_bundle_dir(test), "nextcloud-ca.pem")
    shutil.copyfile(certifi.where(), path)
    return path


class FakeNextcloudTransport(requests.adapters.BaseAdapter):
    """Answers every request with a redirect and records how it was verified."""

    def __init__(self, location):
        super().__init__()
        self.location = location
        self.verified_with = []

    def send(self, request, stream=False, timeout=None, verify=True, **kwargs):
        self.verified_with.append(verify)
        response = requests.Response()
        response.status_code = 302
        response.headers["location"] = self.location
        response.url = request.url
        response.request = request
        return response

    def close(self):
        pass


def _logged_in_client(**kwargs):
    nc = GuardedClient("https://cloud.example.com", **kwargs)
    with mock.patch.object(GuardedClient, "_update_capabilities"):
        nc.login("alice", "app-password")
    return nc


class CertificateCheckTest(SimpleTestCase):
    def test_public_authorities_when_unset_or_blank(self):
        for value in ("", "   "):
            with override_settings(NEXTCLOUD_CA_BUNDLE=value):
                self.assertIs(True, certificate_check(), repr(value))

    def test_the_bundle_path_when_set(self):
        bundle = _pem_bundle(self)
        with override_settings(NEXTCLOUD_CA_BUNDLE=f" {bundle} "):
            self.assertEqual(bundle, certificate_check())

    def test_missing_file_or_directory_is_a_clear_error(self):
        directory = _bundle_dir(self)
        for path in (os.path.join(directory, "missing.pem"), directory):
            with override_settings(NEXTCLOUD_CA_BUNDLE=path):
                with self.assertRaises(CABundleError, msg=path) as caught:
                    certificate_check()
            self.assertIn("NEXTCLOUD_CA_BUNDLE", str(caught.exception))
            self.assertIn(MISSING, str(caught.exception))
            # The path stays in the server's configuration, not in the message.
            self.assertNotIn(directory, str(caught.exception))

    def test_a_file_without_pem_certificates_is_a_clear_error(self):
        path = os.path.join(_bundle_dir(self), "not-a-certificate.pem")
        with open(path, "w", encoding="utf-8") as f:
            f.write("this is not a certificate\n")
        with override_settings(NEXTCLOUD_CA_BUNDLE=path):
            with self.assertRaises(CABundleError) as caught:
                certificate_check()
        self.assertIn(UNREADABLE, str(caught.exception))


class GuardedClientCertificateTest(SimpleTestCase):
    def setUp(self):
        dns = patch_nextcloud_dns({"localhost": ["127.0.0.1"]})
        dns.start()
        self.addCleanup(dns.stop)

    def test_session_checks_against_the_public_authorities_by_default(self):
        with override_settings(NEXTCLOUD_CA_BUNDLE=""):
            nc = _logged_in_client()
        self.assertIs(True, nc._session.verify)

    def test_session_checks_against_the_bundle_when_set(self):
        bundle = _pem_bundle(self)
        with override_settings(NEXTCLOUD_CA_BUNDLE=bundle):
            nc = _logged_in_client()
        self.assertEqual(bundle, nc._session.verify)
        self.assertEqual(1, len(nc._session.hooks["response"]))

    def test_certificate_checking_cannot_be_switched_off(self):
        bundle = _pem_bundle(self)
        with override_settings(NEXTCLOUD_CA_BUNDLE=""):
            self.assertIs(True, _logged_in_client(verify_certs=False)._session.verify)
        with override_settings(NEXTCLOUD_CA_BUNDLE=bundle):
            nc = _logged_in_client(verify_certs=False)
        self.assertEqual(bundle, nc._session.verify)

    def test_a_broken_bundle_stops_the_client_before_it_connects(self):
        missing = os.path.join(_bundle_dir(self), "missing.pem")
        with override_settings(NEXTCLOUD_CA_BUNDLE=missing):
            with mock.patch("requests.Session.request") as request:
                with self.assertRaises(CABundleError):
                    _logged_in_client()
        request.assert_not_called()

    def test_redirect_guard_still_refuses_unsafe_hosts_with_a_bundle(self):
        bundle = _pem_bundle(self)
        for location in (
            "http://169.254.169.254/latest/meta-data/",
            "http://localhost:8001/",
            "http://127.0.0.1:8163\\@8.8.8.8/",
        ):
            with override_settings(NEXTCLOUD_CA_BUNDLE=bundle):
                nc = _logged_in_client()
            transport = FakeNextcloudTransport(location)
            nc._session.mount("https://", transport)
            nc._session.mount("http://", transport)
            with self.assertRaises(UnsafeServerAddress, msg=location):
                nc._session.get("https://cloud.example.com/status.php")
            # Only the first hop was sent, and it was checked against the bundle.
            self.assertEqual([bundle], transport.verified_with, location)


@override_config(NEXTCLOUD_ENABLED=True)
class NextcloudViewsReportABrokenBundleTest(TestCase):
    def setUp(self):
        dns = patch_nextcloud_dns()
        dns.start()
        self.addCleanup(dns.stop)
        user = create_test_user(
            nextcloud_server_address="https://cloud.example.com",
            nextcloud_username="alice",
            nextcloud_app_password="app-password",
            nextcloud_scan_directory="/Photos",
        )
        self.client = APIClient()
        self.client.force_authenticate(user=user)
        missing = os.path.join(_bundle_dir(self), "missing.pem")
        bundle = override_settings(NEXTCLOUD_CA_BUNDLE=missing)
        bundle.enable()
        self.addCleanup(bundle.disable)

    def _message(self, response):
        self.assertEqual(400, response.status_code)
        return response.json()["errors"][0]["message"]

    def test_listdir_explains_the_bundle_without_connecting(self):
        with mock.patch("requests.Session.request") as request:
            response = self.client.get(LISTDIR_URL)
        self.assertIn(MISSING, self._message(response))
        request.assert_not_called()

    def test_scanphotos_explains_the_bundle_without_queueing(self):
        with mock.patch("api.jobs.queue.AsyncTask") as async_task:
            response = self.client.post(SCANPHOTOS_URL)
        self.assertIn(MISSING, self._message(response))
        async_task.assert_not_called()
        self.assertFalse(LongRunningJob.objects.exists())
