"""The password-reset confirm view reads its body through a serializer (#2326).

The web client tells a missing parameter, a bad link and a weak password apart
by the error code, so those stay exactly as they were; a token that is not
text used to crash ``check_token`` with a 500 and is a bad link now.
"""

from django.contrib.auth.tokens import default_token_generator
from django.core.cache import cache
from django.test import TestCase
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from rest_framework.test import APIClient

from api.tests.utils import create_test_user

CONFIRM_URL = "/api/auth/password/reset/confirm/"
NEW_PASSWORD = "a-brand-new-secret-42"


class PasswordResetConfirmRequestTest(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.user = create_test_user(password="oldpassword123")
        self.payload = {
            "uid": urlsafe_base64_encode(force_bytes(self.user.pk)),
            "token": default_token_generator.make_token(self.user),
            "new_password": NEW_PASSWORD,
        }

    def errors(self, response) -> list[dict[str, str]]:
        self.assertEqual(400, response.status_code, response.content)
        return response.json()["errors"]

    def assert_password(self, password):
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password(password))

    def test_a_json_body_resets_the_password(self):
        response = self.client.post(CONFIRM_URL, self.payload, format="json")
        self.assertEqual(200, response.status_code)
        self.assert_password(NEW_PASSWORD)

    def test_the_new_password_is_kept_as_typed(self):
        self.payload["new_password"] = f" {NEW_PASSWORD} "
        response = self.client.post(CONFIRM_URL, self.payload, format="json")
        self.assertEqual(200, response.status_code)
        self.assert_password(f" {NEW_PASSWORD} ")

    def test_a_missing_blank_or_null_parameter_is_missing_parameters(self):
        for name in ("uid", "token", "new_password"):
            for value in (None, "", "absent"):
                with self.subTest(name=name, value=value):
                    payload = dict(self.payload)
                    if value == "absent":
                        del payload[name]
                    else:
                        payload[name] = value
                    response = self.client.post(CONFIRM_URL, payload, format="json")
                    self.assertEqual(
                        [
                            {
                                "field": "non_field_errors",
                                "message": "Missing parameters",
                                "code": "missing_parameters",
                            }
                        ],
                        self.errors(response),
                    )
        self.assert_password("oldpassword123")

    def test_a_token_that_is_not_text_is_a_bad_link(self):
        self.payload["token"] = 12345
        response = self.client.post(CONFIRM_URL, self.payload, format="json")
        self.assertEqual("invalid_reset_link", self.errors(response)[0]["code"])
        self.assert_password("oldpassword123")

    def test_a_list_is_a_400_naming_the_field(self):
        self.payload["uid"] = [self.payload["uid"]]
        response = self.client.post(CONFIRM_URL, self.payload, format="json")
        self.assertEqual("uid", self.errors(response)[0]["field"])
        self.assert_password("oldpassword123")
