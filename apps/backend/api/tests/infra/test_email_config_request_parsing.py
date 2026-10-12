"""The email settings read their body through serializers (#2326).

The config view used to copy each field from the raw body onto the model, so
a port that is not a number or a null host crashed the save with a 500, and
any provider name was stored. Well-formed updates behave as before (partial,
the write-only secret, ``clear_secret``); a malformed field is a 400 naming it.
"""

from django.core import mail
from django.test import TestCase
from rest_framework.test import APIClient

from api.models.email_config import EmailConfig
from api.tests.utils import create_test_user

CONFIG_URL = "/api/email-config/"
TEST_URL = "/api/email-config/test/"


def error_fields(response) -> list[str]:
    return [error["field"] for error in response.json()["errors"]]


class EmailConfigRequestTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(create_test_user(is_admin=True))
        config = EmailConfig.load()
        config.provider = "custom"
        config.host = "smtp.example.org"
        config.from_email = "no-reply@example.org"
        config.port = 587
        config.username = "mailer"
        config.secret = "keepme"
        config.save()

    def post(self, body):
        return self.client.post(CONFIG_URL, body, format="json")

    # --- well-formed input, as before ------------------------------------

    def test_every_writable_field_is_saved(self):
        response = self.post(
            {
                "provider": "sendgrid",
                "from_email": "photos@example.org",
                "host": "smtp.sendgrid.net",
                "port": 2525,
                "use_tls": False,
                "use_ssl": True,
                "username": "apikey",
            }
        )
        self.assertEqual(200, response.status_code, response.content)
        config = EmailConfig.load()
        self.assertEqual(
            (
                "sendgrid",
                "photos@example.org",
                "smtp.sendgrid.net",
                2525,
                False,
                True,
                "apikey",
            ),
            (
                config.provider,
                config.from_email,
                config.host,
                config.port,
                config.use_tls,
                config.use_ssl,
                config.username,
            ),
        )
        self.assertEqual(2525, response.json()["port"])

    def test_an_update_leaves_the_fields_it_does_not_name(self):
        self.assertEqual(200, self.post({"host": "smtp.other.org"}).status_code)
        config = EmailConfig.load()
        self.assertEqual("smtp.other.org", config.host)
        self.assertEqual(
            ("custom", "mailer", 587), (config.provider, config.username, config.port)
        )
        self.assertEqual("keepme", config.secret)

    def test_a_port_sent_as_text_is_a_number(self):
        self.assertEqual(200, self.post({"port": "2525"}).status_code)
        self.assertEqual(2525, EmailConfig.load().port)

    def test_blank_fields_are_stored_blank(self):
        self.assertEqual(200, self.post({"username": "", "host": ""}).status_code)
        config = EmailConfig.load()
        self.assertEqual(("", ""), (config.username, config.host))

    def test_the_secret_is_replaced_only_by_a_value(self):
        for body in ({"secret": ""}, {"secret": None}, {}):
            with self.subTest(body=body):
                self.assertEqual(200, self.post(body).status_code)
                self.assertEqual("keepme", EmailConfig.load().secret)
        self.assertEqual(200, self.post({"secret": " new secret "}).status_code)
        self.assertEqual(" new secret ", EmailConfig.load().secret)

    def test_clear_secret_wins_over_a_new_secret(self):
        response = self.post({"clear_secret": True, "secret": "ignored"})
        self.assertEqual(200, response.status_code)
        self.assertEqual("", EmailConfig.load().secret)
        self.assertFalse(response.json()["has_secret"])

    # --- changed: a false word is false -----------------------------------

    def test_a_false_clear_secret_keeps_the_secret(self):
        for value in (False, "false", 0):
            with self.subTest(clear_secret=value):
                self.assertEqual(200, self.post({"clear_secret": value}).status_code)
                self.assertEqual("keepme", EmailConfig.load().secret)

    # --- malformed input is a 400 -----------------------------------------

    def test_malformed_fields_are_a_400_naming_them(self):
        for body, field in (
            ({"port": "abc"}, "port"),
            ({"port": -1}, "port"),
            ({"host": None}, "host"),
            ({"host": "h" * 256}, "host"),
            ({"provider": "pigeon"}, "provider"),
            ({"use_tls": "maybe"}, "use_tls"),
            ({"clear_secret": "maybe"}, "clear_secret"),
        ):
            with self.subTest(body=body):
                response = self.post(body)
                self.assertEqual(400, response.status_code, response.content)
                self.assertEqual([field], error_fields(response))
        config = EmailConfig.load()
        self.assertEqual(
            ("custom", "smtp.example.org", 587),
            (config.provider, config.host, config.port),
        )


class EmailTestRequestTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = create_test_user(is_admin=True, email="admin@example.org")
        self.client.force_authenticate(self.admin)
        config = EmailConfig.load()
        config.provider = "custom"
        config.host = "smtp.example.org"
        config.from_email = "no-reply@example.org"
        config.save()

    def test_the_recipient_is_trimmed(self):
        response = self.client.post(
            TEST_URL, {"to": " dest@example.org "}, format="json"
        )
        self.assertEqual(200, response.status_code)
        self.assertEqual(["dest@example.org"], mail.outbox[0].to)

    def test_without_a_recipient_it_goes_to_the_admin(self):
        for body in ({}, {"to": ""}, {"to": None}):
            with self.subTest(body=body):
                mail.outbox.clear()
                response = self.client.post(TEST_URL, body, format="json")
                self.assertEqual(200, response.status_code)
                self.assertEqual(["admin@example.org"], mail.outbox[0].to)

    def test_no_recipient_at_all_is_a_400(self):
        self.admin.email = ""
        self.admin.save()
        response = self.client.post(TEST_URL, {}, format="json")
        self.assertEqual(400, response.status_code)
        self.assertEqual(["to"], error_fields(response))

    def test_a_recipient_that_is_not_text_is_a_400(self):
        response = self.client.post(TEST_URL, {"to": ["a@example.org"]}, format="json")
        self.assertEqual(400, response.status_code)
        self.assertEqual(["to"], error_fields(response))
        self.assertEqual([], mail.outbox)
