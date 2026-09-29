"""The password-reset link must not be built from an attacker's Host header.

Without FRONTEND_BASE_URL the reset email's link fell back to
``request.build_absolute_uri("/")``, that is to whatever Host header the
request carried. The unified and standalone images run with
``ALLOWED_HOSTS = ["*"]``, so Django accepts any Host. Anyone who knew a
user's email address could ask for a reset with ``Host: attacker.example``:
the server then mailed that user a genuine reset token inside a link to the
attacker's site, and one click handed the token over (account takeover).

The request origin is now only used when Django actually validated it (a
concrete ALLOWED_HOSTS list) or the admin listed it in CSRF_TRUSTED_ORIGINS.
Otherwise no link can be trusted, so no email goes out and the admin is told
to set FRONTEND_BASE_URL in the log.
"""

from django.core import mail
from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from api.models import User

REQUEST_URL = "/api/auth/password/reset/"


class PasswordResetHostPoisoningTest(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.user = User.objects.create(username="alice", email="alice@example.com")
        self.user.set_password("oldpassword123")
        self.user.save()

    def _request_reset(self, host):
        response = self.client.post(
            REQUEST_URL, {"email": self.user.email}, HTTP_HOST=host
        )
        # The caller learns nothing either way.
        self.assertEqual(200, response.status_code)
        self.assertTrue(response.json()["status"])

    @override_settings(
        ALLOWED_HOSTS=["*"], FRONTEND_BASE_URL="", CSRF_TRUSTED_ORIGINS=[]
    )
    def test_forged_host_never_ends_up_in_the_link(self):
        self._request_reset("attacker.example")

        for message in mail.outbox:
            self.assertNotIn("attacker.example", message.body)
        self.assertEqual(0, len(mail.outbox))

    @override_settings(
        ALLOWED_HOSTS=["*"], FRONTEND_BASE_URL="", CSRF_TRUSTED_ORIGINS=[]
    )
    def test_admin_is_told_what_to_configure(self):
        with self.assertLogs("api.views.password_reset", level="ERROR") as logs:
            self._request_reset("attacker.example")

        self.assertIn("FRONTEND_BASE_URL", "\n".join(logs.output))

    @override_settings(
        ALLOWED_HOSTS=["*"],
        FRONTEND_BASE_URL="https://photos.example.org",
        CSRF_TRUSTED_ORIGINS=[],
    )
    def test_configured_url_wins_over_the_host_header(self):
        self._request_reset("attacker.example")

        self.assertEqual(1, len(mail.outbox))
        self.assertIn(
            "https://photos.example.org/password-reset/confirm/", mail.outbox[0].body
        )
        self.assertNotIn("attacker.example", mail.outbox[0].body)

    @override_settings(
        ALLOWED_HOSTS=["*"],
        FRONTEND_BASE_URL="",
        CSRF_TRUSTED_ORIGINS=["http://photos.lan"],
    )
    def test_origin_listed_as_trusted_is_still_used(self):
        self._request_reset("photos.lan")

        self.assertEqual(1, len(mail.outbox))
        self.assertIn("http://photos.lan/password-reset/confirm/", mail.outbox[0].body)

    @override_settings(
        ALLOWED_HOSTS=["photos.lan"], FRONTEND_BASE_URL="", CSRF_TRUSTED_ORIGINS=[]
    )
    def test_host_validated_by_a_concrete_allow_list_is_still_used(self):
        self._request_reset("photos.lan")

        self.assertEqual(1, len(mail.outbox))
        self.assertIn("http://photos.lan/password-reset/confirm/", mail.outbox[0].body)

    @override_settings(
        ALLOWED_HOSTS=["*"],
        FRONTEND_BASE_URL="",
        CSRF_TRUSTED_ORIGINS=["https://photos.example.com"],
    )
    def test_trusted_origin_keeps_its_own_scheme(self):
        # TLS usually ends at a reverse proxy, so the request itself is http.
        self._request_reset("photos.example.com")

        self.assertEqual(1, len(mail.outbox))
        self.assertIn(
            "https://photos.example.com/password-reset/confirm/", mail.outbox[0].body
        )
