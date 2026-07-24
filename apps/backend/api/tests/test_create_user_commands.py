"""Tests for the ``createadmin`` and ``createuser`` management commands.

Both commands generate a random password when none is supplied. They used to
call ``User.objects.make_random_password()``, which Django deprecated in 4.2
and removed in 5.1, so the generating branch raised ``AttributeError``.
"""

import os
from contextlib import contextmanager
from unittest.mock import patch

from django.core.management import call_command
from django.test import TestCase

from api.models import User

GUESSES = ["", "password", "admin", "changeme"]


@contextmanager
def capture_password(manager_method):
    """Record the password the command hands to ``User.objects.<method>``."""
    original = getattr(User.objects, manager_method)
    captured = []

    def spy(username, email, password, **kwargs):
        captured.append(password)
        return original(username, email, password, **kwargs)

    with patch.object(User.objects, manager_method, side_effect=spy):
        yield captured


@contextmanager
def no_admin_password_env():
    environ = {k: v for k, v in os.environ.items() if k != "ADMIN_PASSWORD"}
    with patch.dict(os.environ, environ, clear=True):
        yield


class CreateUserCommandsTest(TestCase):
    def assert_password_is_not_guessable(self, user, password):
        self.assertTrue(user.has_usable_password())
        self.assertTrue(password)
        self.assertGreaterEqual(len(password), 10)
        for guess in GUESSES + [user.username, user.email]:
            self.assertFalse(user.check_password(guess))
        self.assertTrue(user.check_password(password))

    def test_createadmin_generates_password_when_env_unset(self):
        with no_admin_password_env(), capture_password("create_superuser") as captured:
            call_command("createadmin", "genadmin", "genadmin@test.com")

        user = User.objects.get(username="genadmin")
        self.assertTrue(user.is_superuser)
        self.assert_password_is_not_guessable(user, captured[0])

    def test_createuser_generates_password_when_omitted(self):
        with no_admin_password_env(), capture_password("create_user") as captured:
            call_command("createuser", "genuser", "genuser@test.com")

        user = User.objects.get(username="genuser")
        self.assertFalse(user.is_superuser)
        self.assert_password_is_not_guessable(user, captured[0])

    def test_generated_passwords_differ_between_runs(self):
        with no_admin_password_env(), capture_password("create_user") as captured:
            call_command("createuser", "genuser1", "genuser1@test.com")
            call_command("createuser", "genuser2", "genuser2@test.com")

        self.assertNotEqual(captured[0], captured[1])
