"""The Nextcloud address check reads the address the way requests will dial it.

``urlparse`` and urllib3 (which requests, and so pyocclient, connects through)
do not always agree on the host of a URL: a backslash ends the authority for
urllib3 but not for ``urlparse``. ``http://127.0.0.1:8163\\@8.8.8.8/`` passed
the check as 8.8.8.8 while the request went to 127.0.0.1:8163.
"""

from unittest import mock

import requests
from constance.test import override_config
from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIClient

from api.tests.utils import create_test_user, patch_nextcloud_dns
from nextcloud.server_address import (
    GuardedClient,
    UnsafeServerAddress,
    is_safe_server_address,
    validate_server_address,
)

LOOPBACK = "points to a loopback address"
# Python 3.14 (and the security releases that carry the same check) refuse a
# bracketed host followed by a backslash while splitting the URL, before any
# host is looked at. That is a refusal too, just an earlier one.
NOT_A_URL = "is not a URL"
AMBIGUOUS = "is ambiguous"

# Read as a public host by urlparse, dialed on loopback by requests.
BACKSLASH_ADDRESSES = (
    "http://127.0.0.1:8163\\@8.8.8.8/",
    "http://127.0.0.1\\@8.8.8.8/",
    "http://127.0.0.1:8163\\@cloud.example.com/",
    "http://localhost:8163\\@8.8.8.8/",
    "http://[::1]:8163\\@8.8.8.8/",
    "http://user:pw@127.0.0.1:8163\\@8.8.8.8/",
    "https://127.0.0.1:8163\\@8.8.8.8:443/remote.php/webdav",
)

# Userinfo that looks like a public host in front of a loopback host.
USERINFO_ADDRESSES = (
    "http://8.8.8.8@127.0.0.1:8163/",
    "http://user:pw@127.0.0.1:8163/",
    "http://cloud.example.com:443@localhost/",
    "http://8.8.8.8:80@[::1]:8163/",
    "http://a@8.8.8.8@127.0.0.1/",
)


def assertRefusal(test, wording, message, url):
    """The refusal names ``wording``, or, for a bracketed host, the URL itself."""
    if "[" in url and NOT_A_URL in message:
        return
    test.assertIn(wording, message, url)


class ParserDifferentialTest(SimpleTestCase):
    def setUp(self):
        dns = patch_nextcloud_dns({"localhost": ["127.0.0.1", "::1"]})
        dns.start()
        self.addCleanup(dns.stop)

    def assertRefusedAs(self, wording, url):
        with self.assertRaises(UnsafeServerAddress, msg=url) as caught:
            validate_server_address(url)
        assertRefusal(self, wording, str(caught.exception), url)

    def test_backslash_before_userinfo_is_judged_by_the_dialed_host(self):
        for url in BACKSLASH_ADDRESSES:
            self.assertRefusedAs(LOOPBACK, url)

    def test_userinfo_does_not_hide_a_loopback_host(self):
        for url in USERINFO_ADDRESSES:
            self.assertRefusedAs(LOOPBACK, url)

    def test_addresses_the_parsers_disagree_on_are_refused(self):
        # Both readings are public hosts, but only one of them is dialed.
        for url in (
            "http://8.8.8.8\\@cloud.example.com/",
            "https://cloud.example.com\\@8.8.8.8/",
        ):
            self.assertRefusedAs(AMBIGUOUS, url)

    def test_ordinary_addresses_still_pass(self):
        for url in (
            "https://cloud.example.com/nextcloud/",
            "HTTPS://Cloud.Example.COM:8443",
            "https://[2606:4700:4700::1111]:8443/",
            "https://bücher.example/",
            "https://alice@cloud.example.com/",
        ):
            self.assertTrue(is_safe_server_address(url), url)


class RedirectParserDifferentialTest(SimpleTestCase):
    def setUp(self):
        dns = patch_nextcloud_dns({"localhost": ["127.0.0.1"]})
        dns.start()
        self.addCleanup(dns.stop)

    def test_redirect_hops_get_the_same_check(self):
        nc = GuardedClient("https://cloud.example.com")
        nc._session = requests.Session()
        hook = nc._session.hooks["response"][0]
        for location in BACKSLASH_ADDRESSES + USERINFO_ADDRESSES:
            response = requests.Response()
            response.status_code = 302
            response.url = "https://cloud.example.com/status.php"
            response.headers["location"] = location
            with self.assertRaises(UnsafeServerAddress, msg=location) as caught:
                hook(response)
            assertRefusal(self, LOOPBACK, str(caught.exception), location)

    def test_a_location_the_url_splitter_rejects_is_refused(self):
        nc = GuardedClient("https://cloud.example.com")
        nc._session = requests.Session()
        hook = nc._session.hooks["response"][0]
        response = requests.Response()
        response.status_code = 302
        response.url = "https://cloud.example.com/status.php"
        response.headers["location"] = "http://[::1]:8163\\@8.8.8.8/"
        with mock.patch(
            "nextcloud.server_address.urljoin",
            side_effect=ValueError("An IPv4 address cannot be in brackets"),
        ):
            with self.assertRaises(UnsafeServerAddress) as caught:
                hook(response)
        self.assertIn(NOT_A_URL, str(caught.exception))


@override_config(NEXTCLOUD_ENABLED=True)
class ReportedReproductionTest(TestCase):
    """A normal user saves the address, then lists a directory (2026-09-29)."""

    ADDRESS = "http://127.0.0.1:8163\\@8.8.8.8/"

    def setUp(self):
        dns = patch_nextcloud_dns()
        dns.start()
        self.addCleanup(dns.stop)
        self.user = create_test_user(
            nextcloud_username="alice", nextcloud_app_password="app-password"
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_address_cannot_be_saved(self):
        response = self.client.patch(
            f"/api/user/{self.user.id}/",
            {"nextcloud_server_address": self.ADDRESS},
            format="json",
        )
        self.assertEqual(400, response.status_code)
        [error] = response.json()["errors"]
        self.assertEqual("nextcloud_server_address", error["field"])
        self.assertIn(LOOPBACK, error["message"])
        self.user.refresh_from_db()
        self.assertNotEqual(self.ADDRESS, self.user.nextcloud_server_address)

    def test_stored_address_is_not_contacted(self):
        # An address saved before this check existed is checked again on use.
        self.user.nextcloud_server_address = self.ADDRESS
        self.user.save()
        with mock.patch("nextcloud.server_address.GuardedClient") as client:
            response = self.client.get("/api/nextcloud/listdir/?fpath=/")
        self.assertEqual(400, response.status_code)
        client.assert_not_called()
