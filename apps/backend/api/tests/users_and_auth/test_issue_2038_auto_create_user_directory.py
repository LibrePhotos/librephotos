"""Issue #2038 - optionally give each new user their own folder under DATA_ROOT.

Split out of #492. Off by default; when on, the admin no longer has to create
a folder on the host and assign it for every account.
"""

import os
import shutil
from unittest import mock

from constance import config as site_config
from django.conf import settings
from django.test import TestCase
from rest_framework.test import APIClient

from api.adapters import SSOSocialAccountAdapter
from api.models import User
from api.tests.users_and_auth.test_oidc_sso_login import _make_social_login, _request
from api.tests.utils import create_password


class AutoCreateUserDirectoryTestCase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_superuser(
            "autodir_admin", "autodir_admin@test.com", create_password()
        )
        self.client.force_authenticate(user=self.admin)
        os.makedirs(settings.DATA_ROOT, exist_ok=True)
        for key in ("AUTO_CREATE_USER_DIRECTORY", "ALLOW_REGISTRATION"):
            self.addCleanup(setattr, site_config, key, getattr(site_config, key))

    def _folder(self, name):
        """``DATA_ROOT/<name>``, removed again after the test.

        DATA_ROOT is a real directory shared by the whole run, so a folder left
        behind here would be "pre-existing" for the next test.
        """
        path = os.path.abspath(os.path.join(settings.DATA_ROOT, name))
        self.addCleanup(shutil.rmtree, path, ignore_errors=True)
        return path

    def _create(self, username, **extra):
        self._folder(username)
        payload = {
            "username": username,
            "password": create_password(),
            "email": f"{username}@test.com",
        }
        payload.update(extra)
        return self.client.post("/api/user/", payload)

    def _sign_up(self, username):
        """Anonymous self-registration, which uses SignupUserSerializer."""
        self._folder(username)
        site_config.ALLOW_REGISTRATION = True
        return APIClient().post(
            "/api/user/",
            {
                "username": username,
                "password": create_password(),
                "email": f"{username}@test.com",
                "first_name": "Self",
                "last_name": "Registered",
            },
        )

    def _sso_sign_up(self, username):
        self._folder(username)
        sociallogin = _make_social_login(email=f"{username}@example.com")
        sociallogin.user = User(username=username, email=f"{username}@example.com")
        return SSOSocialAccountAdapter().save_user(_request(), sociallogin)

    def test_it_is_off_by_default(self):
        self.assertFalse(site_config.AUTO_CREATE_USER_DIRECTORY)
        response = self._create("autodir_off")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(User.objects.get(username="autodir_off").scan_directory, "")

    def test_a_folder_is_created_and_assigned_when_on(self):
        site_config.AUTO_CREATE_USER_DIRECTORY = True
        response = self._create("autodir_on")
        self.assertEqual(response.status_code, 201)

        expected = os.path.abspath(os.path.join(settings.DATA_ROOT, "autodir_on"))
        self.assertTrue(os.path.isdir(expected))
        self.assertEqual(
            User.objects.get(username="autodir_on").scan_directory, expected
        )

    def test_an_explicit_directory_is_not_overwritten(self):
        site_config.AUTO_CREATE_USER_DIRECTORY = True
        chosen = self._folder("autodir-chosen")
        os.makedirs(chosen, exist_ok=True)

        response = self._create("autodir_explicit", scan_directory=chosen)
        self.assertEqual(response.status_code, 201)

        user = User.objects.get(username="autodir_explicit")
        self.assertEqual(user.scan_directory, os.path.abspath(chosen))
        self.assertFalse(
            os.path.isdir(os.path.join(settings.DATA_ROOT, "autodir_explicit"))
        )

    def test_an_unwritable_data_root_does_not_fail_user_creation(self):
        # A read-only library mount must not stop accounts being made. The user
        # is created without a directory, exactly as a self-registered one is.
        site_config.AUTO_CREATE_USER_DIRECTORY = True
        with mock.patch(
            "api.serializers.user.os.makedirs",
            side_effect=OSError("Read-only file system"),
        ):
            response = self._create("autodir_readonly")

        self.assertEqual(response.status_code, 201)
        self.assertEqual(
            User.objects.get(username="autodir_readonly").scan_directory, ""
        )

    def test_a_folder_that_would_overlap_another_user_is_refused(self):
        # The #2034 overlap rule applies to the candidate too -- and refusing
        # it must neither fail the account nor leave an empty folder behind.
        # This is the default layout, where the admin scans DATA_ROOT itself.
        site_config.AUTO_CREATE_USER_DIRECTORY = True
        squatter = User.objects.create_user(
            "autodir_squatter", "autodir_squatter@test.com", create_password()
        )
        squatter.scan_directory = os.path.abspath(settings.DATA_ROOT)
        squatter.save()

        response = self._create("autodir_blocked")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(
            User.objects.get(username="autodir_blocked").scan_directory, ""
        )
        self.assertFalse(
            os.path.exists(os.path.join(settings.DATA_ROOT, "autodir_blocked"))
        )

    def test_an_existing_folder_is_reused_when_an_admin_creates_the_user(self):
        # The admin can see what is in the folder, so handing it out is theirs
        # to decide.
        site_config.AUTO_CREATE_USER_DIRECTORY = True
        already = self._folder("autodir_existing")
        os.makedirs(already, exist_ok=True)

        response = self._create("autodir_existing")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(
            User.objects.get(username="autodir_existing").scan_directory, already
        )

    def test_self_registration_gets_a_folder(self):
        # Anonymous sign-up goes through SignupUserSerializer, not
        # UserSerializer.create, and was missed at first.
        site_config.AUTO_CREATE_USER_DIRECTORY = True
        response = self._sign_up("autodir_signup")
        self.assertEqual(response.status_code, 201)

        expected = os.path.abspath(os.path.join(settings.DATA_ROOT, "autodir_signup"))
        self.assertTrue(os.path.isdir(expected))
        self.assertEqual(
            User.objects.get(username="autodir_signup").scan_directory, expected
        )

    def test_self_registration_does_not_claim_an_existing_folder(self):
        # Otherwise anyone who can sign up gets e.g. DATA_ROOT/family, photos
        # and all, by picking "family" as a username.
        site_config.AUTO_CREATE_USER_DIRECTORY = True
        existing = self._folder("family")
        os.makedirs(existing)

        response = self._sign_up("family")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(User.objects.get(username="family").scan_directory, "")

    def test_sso_sign_up_gets_a_folder(self):
        site_config.AUTO_CREATE_USER_DIRECTORY = True
        user = self._sso_sign_up("autodir_sso")

        expected = os.path.abspath(os.path.join(settings.DATA_ROOT, "autodir_sso"))
        self.assertTrue(os.path.isdir(expected))
        user.refresh_from_db()
        self.assertEqual(user.scan_directory, expected)

    def test_sso_sign_up_does_not_claim_an_existing_folder(self):
        site_config.AUTO_CREATE_USER_DIRECTORY = True
        existing = self._folder("autodir_sso_existing")
        os.makedirs(existing)

        user = self._sso_sign_up("autodir_sso_existing")
        user.refresh_from_db()
        self.assertEqual(user.scan_directory, "")

    def test_usernames_that_do_not_name_a_child_folder_are_refused(self):
        # "." would be DATA_ROOT itself and ".." its parent; neither is a
        # per-user folder, even for an admin who may claim existing ones.
        site_config.AUTO_CREATE_USER_DIRECTORY = True
        for username in (".", ".."):
            with self.subTest(username=username):
                response = self.client.post(
                    "/api/user/",
                    {
                        "username": username,
                        "password": create_password(),
                        "email": "dots@test.com",
                    },
                )
                self.assertEqual(response.status_code, 201)
                self.assertEqual(User.objects.get(username=username).scan_directory, "")

    @mock.patch("api.views.views.do_all_models_exist", return_value=True)
    def test_the_switch_is_exposed_in_site_settings(self, _models_exist):
        # The docs send admins to Admin Area -> Site settings for this.
        self.assertFalse(
            self.client.get("/api/sitesettings").json()["auto_create_user_directory"]
        )
        response = self.client.post(
            "/api/sitesettings",
            data={"auto_create_user_directory": True},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["auto_create_user_directory"])
        self.assertTrue(site_config.AUTO_CREATE_USER_DIRECTORY)
