"""Tests for the ``createuser`` and ``createadmin`` management commands.

The ``CreateUserHandleTest`` cases are characterization tests: they pin the
CURRENT observable behavior of ``api/management/commands/createuser.py`` ->
``Command.handle`` before any refactor. They assert what the code does today,
not what it arguably should do.

``CreateAdminTest`` covers ``createadmin``, which every Docker image's entrypoint
runs on each start when ``ADMIN_USERNAME`` is set (issue #2375).

``CreateUserCommandsTest`` covers random password generation for both commands.
Both used to call ``User.objects.make_random_password()``, which Django
deprecated in 4.2 and removed in 5.1, so the generating branch raised
``AttributeError``.
"""

import io
import os
from contextlib import contextmanager
from unittest.mock import patch

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase

from api.management.commands import createuser as createuser_module
from api.models import User
from api.tests.utils import create_test_user

GUESSES = ["", "password", "admin", "changeme"]


@contextmanager
def no_admin_password_env():
    environ = {k: v for k, v in os.environ.items() if k != "ADMIN_PASSWORD"}
    with patch.dict(os.environ, environ, clear=True):
        yield


@contextmanager
def admin_password_env(value):
    with patch.dict(os.environ, {"ADMIN_PASSWORD": value}):
        yield


@contextmanager
def capture_password(manager_method):
    """Record the password handed to ``User.objects.<method>``."""
    original = getattr(User.objects, manager_method)
    captured = []

    def spy(username, email, password, **kwargs):
        captured.append(password)
        return original(username, email, password, **kwargs)

    with patch.object(User.objects, manager_method, side_effect=spy):
        yield captured


class CreateUserHandleTest(TestCase):
    # ------------------------------------------------------------------
    # email validation branch
    # ------------------------------------------------------------------
    def test_invalid_email_raises_command_error_and_creates_nothing(self):
        with no_admin_password_env():
            with self.assertRaises(CommandError) as ctx:
                call_command("createuser", "bademail", "not-an-email")

        self.assertEqual(str(ctx.exception), "Enter a valid email address.")
        self.assertFalse(User.objects.filter(username="bademail").exists())

    def test_empty_email_raises_command_error(self):
        with no_admin_password_env():
            with self.assertRaises(CommandError):
                call_command("createuser", "emptyemail", "")

    # ------------------------------------------------------------------
    # happy path: create a regular user
    # ------------------------------------------------------------------
    def test_creates_regular_user_with_explicit_password(self):
        with no_admin_password_env():
            call_command(
                "createuser", "alice", "alice@test.com", "--password", "s3cret-pw"
            )

        user = User.objects.get(username="alice")
        self.assertEqual(user.email, "alice@test.com")
        self.assertFalse(user.is_superuser)
        self.assertFalse(user.is_staff)
        self.assertTrue(user.check_password("s3cret-pw"))

    def test_username_is_lowercased(self):
        with no_admin_password_env():
            call_command(
                "createuser", "MiXeDCase", "mixed@test.com", "--password", "pw123456"
            )

        self.assertTrue(User.objects.filter(username="mixedcase").exists())
        self.assertFalse(User.objects.filter(username="MiXeDCase").exists())

    def test_generated_password_uses_module_length_constant(self):
        self.assertEqual(createuser_module.GENERATED_PASSWORD_LENGTH, 32)

        with no_admin_password_env(), capture_password("create_user") as captured:
            call_command("createuser", "genpw", "genpw@test.com")

        user = User.objects.get(username="genpw")
        self.assertEqual(len(captured[0]), 32)
        self.assertTrue(user.check_password(captured[0]))
        self.assertTrue(user.has_usable_password())

    # ------------------------------------------------------------------
    # admin branch
    # ------------------------------------------------------------------
    def test_admin_flag_creates_superuser(self):
        with no_admin_password_env():
            call_command(
                "createuser", "root", "root@test.com", "--admin", "--password", "rootpw"
            )

        user = User.objects.get(username="root")
        self.assertTrue(user.is_superuser)
        self.assertTrue(user.is_staff)
        self.assertTrue(user.check_password("rootpw"))

    def test_admin_password_env_overrides_explicit_password(self):
        with admin_password_env("from-env"):
            call_command(
                "createuser",
                "envadmin",
                "envadmin@test.com",
                "--admin",
                "--password",
                "from-cli",
            )

        user = User.objects.get(username="envadmin")
        self.assertTrue(user.check_password("from-env"))
        self.assertFalse(user.check_password("from-cli"))

    def test_admin_password_env_ignored_without_admin_flag(self):
        with admin_password_env("from-env"):
            call_command(
                "createuser",
                "nonadmin",
                "nonadmin@test.com",
                "--password",
                "from-cli",
            )

        user = User.objects.get(username="nonadmin")
        self.assertTrue(user.check_password("from-cli"))
        self.assertFalse(user.is_superuser)

    def test_empty_admin_password_env_falls_back_to_generated(self):
        """An empty ADMIN_PASSWORD is falsy, so a random password is generated."""
        with admin_password_env(""), capture_password("create_superuser") as captured:
            call_command("createuser", "emptyenv", "emptyenv@test.com", "--admin")

        self.assertEqual(len(captured[0]), 32)
        user = User.objects.get(username="emptyenv")
        self.assertFalse(user.check_password(""))
        self.assertTrue(user.check_password(captured[0]))

    # ------------------------------------------------------------------
    # existing-user branches
    # ------------------------------------------------------------------
    def test_existing_user_without_update_raises_command_error(self):
        with no_admin_password_env():
            call_command("createuser", "dup", "dup@test.com", "--password", "firstpw")
            with self.assertRaises(CommandError) as ctx:
                call_command(
                    "createuser", "dup", "other@test.com", "--password", "secondpw"
                )

        self.assertEqual(str(ctx.exception), "Specified user already exists")
        user = User.objects.get(username="dup")
        self.assertEqual(user.email, "dup@test.com")
        self.assertTrue(user.check_password("firstpw"))

    def test_existing_user_lookup_is_case_insensitive_via_lowercasing(self):
        with no_admin_password_env():
            call_command("createuser", "casedup", "c@test.com", "--password", "pw1")
            with self.assertRaises(CommandError):
                call_command("createuser", "CASEDUP", "c2@test.com", "--password", "p2")

    def test_update_changes_password_keeps_email_and_warns_on_stderr(self):
        with no_admin_password_env():
            call_command("createuser", "upd", "upd@test.com", "--password", "oldpw")

            stderr = io.StringIO()
            with patch("sys.stderr", stderr):
                call_command(
                    "createuser",
                    "upd",
                    "ignored@test.com",
                    "--update",
                    "--password",
                    "newpw",
                )

        self.assertIn(
            "Warning: ignoring provided email ignored@test.com", stderr.getvalue()
        )
        user = User.objects.get(username="upd")
        self.assertEqual(user.email, "upd@test.com")
        self.assertTrue(user.check_password("newpw"))
        self.assertFalse(user.check_password("oldpw"))

    def test_update_still_validates_email(self):
        with no_admin_password_env():
            call_command("createuser", "updbad", "updbad@test.com", "--password", "pw1")
            with self.assertRaises(CommandError):
                call_command("createuser", "updbad", "nope", "--update")

        self.assertTrue(User.objects.get(username="updbad").check_password("pw1"))

    def test_update_without_password_sets_generated_password(self):
        with no_admin_password_env():
            call_command("createuser", "updgen", "updgen@test.com", "--password", "old")
            with patch("sys.stderr", io.StringIO()):
                call_command("createuser", "updgen", "updgen@test.com", "--update")

        user = User.objects.get(username="updgen")
        self.assertFalse(user.check_password("old"))
        self.assertTrue(user.has_usable_password())

    def test_update_does_not_grant_admin_privileges(self):
        """--update only resets the password; --admin does not promote the user."""
        with no_admin_password_env():
            call_command("createuser", "noprom", "noprom@test.com", "--password", "pw1")
            with patch("sys.stderr", io.StringIO()):
                call_command(
                    "createuser",
                    "noprom",
                    "noprom@test.com",
                    "--update",
                    "--admin",
                    "--password",
                    "pw2",
                )

        user = User.objects.get(username="noprom")
        self.assertFalse(user.is_superuser)
        self.assertTrue(user.check_password("pw2"))

    def test_update_on_missing_user_creates_it(self):
        """--update on a non-existent user takes the creation branch instead."""
        with no_admin_password_env():
            call_command(
                "createuser", "newupd", "newupd@test.com", "--update", "--password", "p"
            )

        user = User.objects.get(username="newupd")
        self.assertEqual(user.email, "newupd@test.com")
        self.assertTrue(user.check_password("p"))

    # ------------------------------------------------------------------
    # handle() called directly (no argparse defaults)
    # ------------------------------------------------------------------
    def test_handle_returns_none(self):
        cmd = createuser_module.Command()
        with no_admin_password_env():
            result = cmd.handle(
                username="direct",
                email="direct@test.com",
                password="directpw",
                update=False,
                admin=False,
            )
        self.assertIsNone(result)
        self.assertTrue(User.objects.get(username="direct").check_password("directpw"))


class CreateUserCommandsTest(TestCase):
    """Random password generation for ``createadmin`` and ``createuser``."""

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

    def test_generated_passwords_differ_between_runs(self):
        with no_admin_password_env(), capture_password("create_user") as captured:
            call_command("createuser", "genuser1", "genuser1@test.com")
            call_command("createuser", "genuser2", "genuser2@test.com")

        self.assertNotEqual(captured[0], captured[1])


class CreateAdminTest(TestCase):
    """``createadmin`` as the entrypoints call it: ``createadmin -u "$ADMIN_USERNAME" "$ADMIN_EMAIL"``.

    The email is only used when the account is created; ``--update`` changes the
    password and nothing else, whatever ``ADMIN_EMAIL`` holds.
    """

    def run_createadmin(self, *args: str) -> str:
        stderr = io.StringIO()
        call_command("createadmin", *args, stderr=stderr)
        return stderr.getvalue()

    def test_update_with_a_blank_email_resets_the_password(self):
        """The compose files pass ADMIN_EMAIL=${adminEmail:-}, blank unless set."""
        admin = create_test_user(is_admin=True, username="admin", email="me@x.org")
        with admin_password_env("new-secret-pw"):
            self.run_createadmin("-u", "admin", "")
        admin.refresh_from_db()
        self.assertTrue(admin.check_password("new-secret-pw"))
        self.assertEqual("me@x.org", admin.email)

    def test_update_never_changes_the_email(self):
        admin = create_test_user(is_admin=True, username="admin", email="me@x.org")
        with admin_password_env("new-secret-pw"):
            self.run_createadmin("-u", "admin", "other@x.org")
        admin.refresh_from_db()
        self.assertEqual("me@x.org", admin.email)

    def test_update_with_an_invalid_email_still_resets_the_password(self):
        admin = create_test_user(is_admin=True, username="admin", email="me@x.org")
        with admin_password_env("new-secret-pw"):
            self.run_createadmin("-u", "admin", "not-an-email")
        admin.refresh_from_db()
        self.assertTrue(admin.check_password("new-secret-pw"))
        self.assertEqual("me@x.org", admin.email)

    def test_update_without_admin_password_leaves_the_password_alone(self):
        """A random password nobody knows would lock the admin out on every start."""
        admin = create_test_user(is_admin=True, username="admin", password="old-pw")
        with no_admin_password_env():
            self.run_createadmin("-u", "admin", "")
        admin.refresh_from_db()
        self.assertTrue(admin.check_password("old-pw"))

    def test_update_with_a_blank_password_is_refused(self):
        admin = create_test_user(is_admin=True, username="admin", password="old-pw")
        with admin_password_env(""), self.assertRaises(CommandError):
            self.run_createadmin("-u", "admin", "")
        admin.refresh_from_db()
        self.assertTrue(admin.check_password("old-pw"))

    def test_update_finds_an_account_whose_name_is_not_lower_case(self):
        """The unified image used to create the admin with the name as typed."""
        admin = create_test_user(is_admin=True, username="Admin", password="old-pw")
        with admin_password_env("new-secret-pw"):
            self.run_createadmin("-u", "Admin", "")
        admin.refresh_from_db()
        self.assertTrue(admin.check_password("new-secret-pw"))
        self.assertEqual(1, User.objects.filter(username__iexact="admin").count())

    def test_update_prefers_the_lower_case_account(self):
        lower = create_test_user(is_admin=True, username="admin", password="old-pw")
        mixed = create_test_user(is_admin=True, username="Admin", password="old-pw")
        with admin_password_env("new-secret-pw"):
            self.run_createadmin("-u", "ADMIN", "")
        lower.refresh_from_db()
        mixed.refresh_from_db()
        self.assertTrue(lower.check_password("new-secret-pw"))
        self.assertTrue(mixed.check_password("old-pw"))

    def test_existing_account_without_update_is_an_error(self):
        create_test_user(is_admin=True, username="admin")
        with admin_password_env("pw"), self.assertRaises(CommandError) as ctx:
            self.run_createadmin("admin", "")
        self.assertEqual("Specified user already exists", str(ctx.exception))

    def test_create_uses_the_email_and_a_lower_case_name(self):
        with admin_password_env("secret-pw"):
            self.run_createadmin("-u", "NewAdmin", "new@x.org")
        admin = User.objects.get(username="newadmin")
        self.assertTrue(admin.is_superuser)
        self.assertEqual("new@x.org", admin.email)
        self.assertTrue(admin.check_password("secret-pw"))

    def test_create_with_a_blank_email_creates_an_account_without_one(self):
        with admin_password_env("secret-pw"):
            self.run_createadmin("-u", "admin", "")
        admin = User.objects.get(username="admin")
        self.assertTrue(admin.is_superuser)
        self.assertEqual("", admin.email)

    def test_create_with_an_invalid_email_is_refused(self):
        with admin_password_env("secret-pw"), self.assertRaises(CommandError):
            self.run_createadmin("-u", "admin", "not-an-email")
        self.assertFalse(User.objects.filter(username="admin").exists())

    def test_create_with_a_blank_password_is_refused(self):
        with admin_password_env(""), self.assertRaises(CommandError):
            self.run_createadmin("-u", "admin", "a@x.org")
        self.assertFalse(User.objects.filter(username="admin").exists())
