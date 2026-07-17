"""Tests for the database-backed email configuration.

Covers the singleton model + encryption, provider-preset resolution, the
DynamicEmailBackend routing, and the admin-only API (including the guarantee
that the stored secret is never returned and that a blank secret leaves the
stored credential untouched).
"""

from django.contrib.auth import get_user_model
from django.core import mail
from django.test import TestCase
from rest_framework.test import APIClient

from api.mail import DynamicEmailBackend, email_is_configured
from api.models.email_config import EmailConfig

User = get_user_model()

CONFIG_URL = "/api/email-config/"
TEST_URL = "/api/email-config/test/"


class EmailConfigModelTest(TestCase):
    def test_load_is_a_singleton(self):
        a = EmailConfig.load()
        b = EmailConfig.load()
        self.assertEqual(a.pk, b.pk)
        self.assertEqual(EmailConfig.objects.count(), 1)

    def test_secret_round_trips_through_encryption(self):
        c = EmailConfig.load()
        c.secret = "super-secret-key"
        c.save()
        reloaded = EmailConfig.objects.get(pk=c.pk)
        self.assertEqual(reloaded.secret, "super-secret-key")

    def test_disabled_is_not_configured(self):
        c = EmailConfig.load()
        c.provider = "disabled"
        c.save()
        self.assertFalse(c.is_configured)
        self.assertFalse(email_is_configured())

    def test_custom_requires_host_and_from(self):
        c = EmailConfig.load()
        c.provider = "custom"
        c.host = ""
        c.from_email = ""
        self.assertFalse(c.is_configured)
        c.host = "smtp.example.org"
        c.from_email = "LibrePhotos <no-reply@example.org>"
        self.assertTrue(c.is_configured)

    def test_preset_supplies_host_and_username(self):
        c = EmailConfig.load()
        c.provider = "sendgrid"
        c.from_email = "no-reply@example.org"
        c.host = ""  # preset should supply it
        kwargs = c.resolve_smtp_kwargs()
        self.assertEqual(kwargs["host"], "smtp.sendgrid.net")
        self.assertEqual(kwargs["port"], 587)
        self.assertEqual(kwargs["username"], "apikey")
        self.assertTrue(c.is_configured)


class DynamicEmailBackendTest(TestCase):
    def test_unconfigured_backend_is_noop(self):
        EmailConfig.load()  # provider defaults to disabled
        backend = DynamicEmailBackend()
        sent = backend.send_messages(
            [mail.EmailMessage("s", "b", "from@example.org", ["to@example.org"])]
        )
        self.assertEqual(sent, 0)

    def test_configured_backend_delegates_to_smtp(self):
        c = EmailConfig.load()
        c.provider = "custom"
        c.host = "smtp.example.org"
        c.from_email = "no-reply@example.org"
        c.save()
        backend = DynamicEmailBackend()
        delegate = backend._delegate()
        from django.core.mail.backends.smtp import EmailBackend as SMTPBackend

        self.assertIsInstance(delegate, SMTPBackend)
        self.assertEqual(delegate.host, "smtp.example.org")


class EmailConfigApiTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create(username="admin", email="admin@example.org")
        self.admin.set_password("pw")
        self.admin.is_staff = True
        self.admin.is_superuser = True
        self.admin.save()
        self.user = User.objects.create(username="bob", email="bob@example.org")
        self.user.set_password("pw")
        self.user.save()

    def test_non_admin_forbidden(self):
        self.client.force_authenticate(self.user)
        self.assertEqual(self.client.get(CONFIG_URL).status_code, 403)
        self.assertEqual(self.client.post(CONFIG_URL, {}).status_code, 403)

    def test_get_never_returns_secret(self):
        c = EmailConfig.load()
        c.secret = "topsecret"
        c.save()
        self.client.force_authenticate(self.admin)
        resp = self.client.get(CONFIG_URL)
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertNotIn("secret", body)
        self.assertTrue(body["has_secret"])

    def test_post_saves_config_and_secret(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.post(
            CONFIG_URL,
            {
                "provider": "custom",
                "host": "smtp.example.org",
                "from_email": "no-reply@example.org",
                "secret": "s3cr3t",
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()["is_configured"])
        self.assertEqual(EmailConfig.load().secret, "s3cr3t")

    def test_blank_secret_keeps_existing(self):
        c = EmailConfig.load()
        c.provider = "custom"
        c.host = "smtp.example.org"
        c.from_email = "no-reply@example.org"
        c.secret = "keepme"
        c.save()
        self.client.force_authenticate(self.admin)
        resp = self.client.post(
            CONFIG_URL, {"host": "smtp.other.org", "secret": ""}, format="json"
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(EmailConfig.load().secret, "keepme")
        self.assertEqual(EmailConfig.load().host, "smtp.other.org")

    def test_clear_secret_wipes_it(self):
        c = EmailConfig.load()
        c.secret = "gone"
        c.save()
        self.client.force_authenticate(self.admin)
        self.client.post(CONFIG_URL, {"clear_secret": True}, format="json")
        self.assertEqual(EmailConfig.load().secret, "")

    def test_test_email_requires_configuration(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.post(TEST_URL, {}, format="json")
        self.assertEqual(resp.status_code, 400)
        self.assertFalse(resp.json()["status"])

    def test_test_email_sends_when_configured(self):
        c = EmailConfig.load()
        c.provider = "custom"
        c.host = "smtp.example.org"
        c.from_email = "no-reply@example.org"
        c.save()
        self.client.force_authenticate(self.admin)
        resp = self.client.post(TEST_URL, {"to": "dest@example.org"}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()["status"])
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["dest@example.org"])


class SiteSettingsEmailFlagTest(TestCase):
    def test_public_settings_expose_email_configured_boolean(self):
        client = APIClient()
        resp = client.get("/api/sitesettings")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("email_configured", resp.json())
        self.assertFalse(resp.json()["email_configured"])
