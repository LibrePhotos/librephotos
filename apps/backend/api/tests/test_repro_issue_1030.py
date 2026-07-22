"""Repro for issue #1030 -- "can not view photos from nextcloud".

Reported symptom: Nextcloud and LibrePhotos both run in Docker on the same
host, each works on its own, but the user cannot browse / add an album from
Nextcloud in LibrePhotos.

The dialog that lets a user pick the Nextcloud folder to import is driven by a
single endpoint, ``GET /api/nextcloud/listdir/?fpath=/``
(``nextcloud/views.py::ListDir``).  That view is written as::

    nc = nextcloud.Client(request.user.nextcloud_server_address)
    nc.login(request.user.nextcloud_username, request.user.nextcloud_app_password)
    try:
        return Response([... for p in nc.list(path) if p.is_dir()])
    except nextcloud.HTTPResponseError:
        return Response(status=400)

``Client.login()`` is the call that pyocclient documents as
``:raises: HTTPResponseError in case an HTTP error status was returned`` -- and
it sits **outside** the ``try``.  So the one error the view explicitly promises
to translate into a clean ``400`` escapes as an unhandled exception and the
endpoint answers ``500 Internal Server Error`` instead.  The same happens for a
plain ``requests.exceptions.ConnectionError``, which is what a container that
cannot reach the Nextcloud container raises -- it is not an
``HTTPResponseError``, so even the call inside the ``try`` is unprotected.

The frontend cannot recover from that: ``useFetchNextcloudDirsQuery`` fails,
``isNextcloudError`` flips to true and
``apps/frontend/src/components/settings/Library.tsx`` disables the "Browse"
button with
``disabled={isNextcloudError || isNextcloudFetching || !nextcloud_server_address}``,
so there is no way to reach the Nextcloud photos at all.

These tests assert the contract the view itself declares: a Nextcloud failure
must come back as a handled client error, never as an unhandled 500.
"""

from unittest import mock

import owncloud
import requests
from django.test import TestCase
from rest_framework.test import APIClient

from api.tests.utils import create_test_user

LISTDIR_URL = "/api/nextcloud/listdir/?fpath=/"


class NextcloudListDirErrorHandlingTest(TestCase):
    def setUp(self):
        self.user = create_test_user(
            # a hostname (not a bare private IP) so the SSRF allowlist in
            # nextcloud/views.py::valid_url lets us reach the client code
            nextcloud_server_address="https://cloud.example.com",
            nextcloud_username="alice",
            nextcloud_app_password="app-password",
            nextcloud_scan_directory="/Photos",
        )
        self.client = APIClient()
        # We want to inspect the response the endpoint produces instead of
        # having Django re-raise the view's exception into the test runner.
        self.client.raise_request_exception = False
        self.client.force_authenticate(user=self.user)

    @staticmethod
    def _client_factory(login_side_effect=None, list_side_effect=None):
        fake_client = mock.MagicMock()
        if login_side_effect is not None:
            fake_client.login.side_effect = login_side_effect
        if list_side_effect is not None:
            fake_client.list.side_effect = list_side_effect
        return mock.MagicMock(return_value=fake_client)

    def test_healthy_nextcloud_lists_directories(self):
        """Sanity check: with a working Nextcloud the endpoint answers 200.

        This pins down that the 500s in the tests below come from the error
        paths of ListDir and not from a mis-wired patch target.
        """
        folder = mock.MagicMock()
        folder.path = "/Photos/"
        folder.is_dir.return_value = True
        factory = self._client_factory()
        factory.return_value.list.return_value = [folder]

        with mock.patch("nextcloud.views.nextcloud.Client", factory):
            response = self.client.get(LISTDIR_URL)

        self.assertEqual(200, response.status_code)
        self.assertEqual(
            [{"absolute_path": "/Photos/", "title": "Photos", "children": []}],
            response.json(),
        )

    def test_rejected_app_password_returns_bad_request_not_server_error(self):
        """Nextcloud answering 401 must surface as the documented 400."""
        factory = self._client_factory(
            login_side_effect=owncloud.HTTPResponseError(401)
        )

        with mock.patch("nextcloud.views.nextcloud.Client", factory):
            response = self.client.get(LISTDIR_URL)

        self.assertEqual(
            400,
            response.status_code,
            "GET /api/nextcloud/listdir/ crashed with "
            f"{response.status_code} instead of the 400 its own "
            "`except nextcloud.HTTPResponseError` clause promises: "
            "Client.login() is called outside the try block, so a Nextcloud "
            "authentication failure escapes as an unhandled exception.",
        )

    def test_unreachable_nextcloud_server_returns_handled_error(self):
        """A container that cannot reach Nextcloud must not 500 the endpoint."""
        factory = self._client_factory(
            login_side_effect=requests.exceptions.ConnectionError(
                "Failed to establish a new connection: [Errno 111] Connection refused"
            )
        )

        with mock.patch("nextcloud.views.nextcloud.Client", factory):
            response = self.client.get(LISTDIR_URL)

        self.assertLess(
            response.status_code,
            500,
            "GET /api/nextcloud/listdir/ returned "
            f"{response.status_code} when the Nextcloud server was "
            "unreachable; an unreachable/misconfigured server address is a "
            "user error and must be reported as a handled client error, not "
            "as an unhandled backend crash.",
        )

    def test_listing_failure_that_is_not_http_error_is_still_handled(self):
        """The try/except around nc.list() only catches HTTPResponseError."""
        factory = self._client_factory(
            list_side_effect=requests.exceptions.ConnectionError("Connection aborted.")
        )

        with mock.patch("nextcloud.views.nextcloud.Client", factory):
            response = self.client.get(LISTDIR_URL)

        self.assertLess(
            response.status_code,
            500,
            "GET /api/nextcloud/listdir/ returned "
            f"{response.status_code}: the `except nextcloud.HTTPResponseError` "
            "guard around nc.list() is too narrow, so a dropped connection to "
            "Nextcloud takes down the request instead of being reported.",
        )
