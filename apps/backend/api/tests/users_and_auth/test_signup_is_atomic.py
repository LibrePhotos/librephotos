"""Signing up writes the account once, with the password already hashed.

The row used to be inserted first and hashed afterwards. When hashing failed
(the standalone build shipped without the Argon2 library), first-time setup
left an account behind that stored the password in plain text, was not an
admin, and kept its username taken, so every further attempt got "A user with
that username already exists" and no admin could ever be created.
"""

from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from api.models import User

SIGNUP = {
    "username": "admin",
    "password": "correct horse battery",
    "email": "admin@example.com",
    "first_name": "Ad",
    "last_name": "Min",
}


class SignupIsAtomicTest(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_the_first_account_is_an_admin_with_a_hashed_password(self):
        response = self.client.post("/api/user/", SIGNUP, format="json")

        self.assertEqual(response.status_code, 201)
        user = User.objects.get(username="admin")
        self.assertTrue(user.is_superuser and user.is_staff)
        self.assertNotEqual(user.password, SIGNUP["password"])
        self.assertTrue(user.check_password(SIGNUP["password"]))

    def test_a_failing_hasher_leaves_no_account_behind(self):
        self.client.raise_request_exception = False
        with patch.object(User, "set_password", side_effect=ValueError("no argon2")):
            response = self.client.post("/api/user/", SIGNUP, format="json")

        self.assertEqual(response.status_code, 500)
        self.assertFalse(User.objects.filter(username="admin").exists())

    def test_the_username_is_free_again_after_such_a_failure(self):
        self.client.raise_request_exception = False
        with patch.object(User, "set_password", side_effect=ValueError("no argon2")):
            self.client.post("/api/user/", SIGNUP, format="json")

        response = self.client.post("/api/user/", SIGNUP, format="json")

        self.assertEqual(response.status_code, 201)
        self.assertTrue(User.objects.get(username="admin").is_superuser)
