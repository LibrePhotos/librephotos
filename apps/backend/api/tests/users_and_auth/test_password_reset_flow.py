"""Tests for the self-service password-reset flow (#596).

Covers the request endpoint (which must never leak whether an email exists),
the confirm endpoint (token validation, password-strength enforcement,
single-use tokens), and the anti-email-bombing throttle.
"""

from django.contrib.auth import get_user_model
from django.contrib.auth.tokens import default_token_generator
from django.core import mail
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from rest_framework.test import APIClient

User = get_user_model()

REQUEST_URL = "/api/auth/password/reset/"
CONFIRM_URL = "/api/auth/password/reset/confirm/"


def _make_user(email="alice@example.com", password="oldpassword123"):
    user = User.objects.create(username=email, email=email)
    user.set_password(password)
    user.save()
    return user


class PasswordResetRequestTest(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.user = _make_user()

    def test_known_email_sends_one_reset_email(self):
        resp = self.client.post(REQUEST_URL, {"email": self.user.email})
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()["status"])
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("password-reset/confirm/", mail.outbox[0].body)
        self.assertEqual(mail.outbox[0].to, [self.user.email])

    def test_email_match_is_case_insensitive(self):
        resp = self.client.post(REQUEST_URL, {"email": "ALICE@EXAMPLE.COM"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(mail.outbox), 1)

    def test_unknown_email_still_returns_200_without_sending(self):
        resp = self.client.post(REQUEST_URL, {"email": "nobody@example.com"})
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()["status"])
        self.assertEqual(len(mail.outbox), 0)

    def test_missing_email_returns_200_without_sending(self):
        resp = self.client.post(REQUEST_URL, {})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(mail.outbox), 0)

    @override_settings(FRONTEND_BASE_URL="https://photos.example.org")
    def test_link_uses_configured_frontend_base_url(self):
        self.client.post(REQUEST_URL, {"email": self.user.email})
        self.assertIn(
            "https://photos.example.org/password-reset/confirm/",
            mail.outbox[0].body,
        )


class PasswordResetConfirmTest(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.user = _make_user()
        self.uid = urlsafe_base64_encode(force_bytes(self.user.pk))
        self.token = default_token_generator.make_token(self.user)

    def _confirm(self, **overrides):
        payload = {
            "uid": self.uid,
            "token": self.token,
            "new_password": "a-brand-new-secret-42",
        }
        payload.update(overrides)
        return self.client.post(CONFIRM_URL, payload)

    def test_valid_token_resets_password(self):
        resp = self._confirm()
        self.assertEqual(resp.status_code, 200)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("a-brand-new-secret-42"))

    def test_invalid_token_rejected(self):
        resp = self._confirm(token="not-a-real-token")
        self.assertEqual(resp.status_code, 400)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("oldpassword123"))

    def test_tampered_uid_rejected(self):
        bogus = urlsafe_base64_encode(force_bytes(999999))
        resp = self._confirm(uid=bogus)
        self.assertEqual(resp.status_code, 400)

    def test_weak_password_rejected(self):
        resp = self._confirm(new_password="123")
        self.assertEqual(resp.status_code, 400)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("oldpassword123"))

    def test_missing_parameters_rejected(self):
        resp = self.client.post(CONFIRM_URL, {"uid": self.uid})
        self.assertEqual(resp.status_code, 400)

    def test_token_is_single_use(self):
        first = self._confirm()
        self.assertEqual(first.status_code, 200)
        # The password hash changed, so the same token no longer validates.
        second = self._confirm()
        self.assertEqual(second.status_code, 400)


class PasswordResetThrottleTest(TestCase):
    """The request endpoint must be rate-limited to prevent email bombing.

    Uses the default configured rate (5/hour); firing one request beyond it
    must be rejected with HTTP 429.
    """

    def setUp(self):
        cache.clear()
        self.client = APIClient()

    def test_request_endpoint_is_throttled(self):
        statuses = [
            self.client.post(REQUEST_URL, {"email": "x@example.com"}).status_code
            for _ in range(6)
        ]
        self.assertEqual(statuses[:5], [200, 200, 200, 200, 200])
        self.assertEqual(statuses[5], 429)
