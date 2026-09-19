"""Issue #2038 - optionally give each new user their own folder under DATA_ROOT.

Split out of #492. Off by default, because on a shared-library install every
user is meant to point at the same folder; on a per-user install the admin
otherwise has to create a folder on the host and assign it for every account.
"""

import os
from unittest import mock

from constance import config as site_config
from django.conf import settings
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from api.models import User
from api.tests.utils import create_password


class AutoCreateUserDirectoryTestCase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_superuser(
            "autodir_admin", "autodir_admin@test.com", create_password()
        )
        self.client.force_authenticate(user=self.admin)
        os.makedirs(settings.DATA_ROOT, exist_ok=True)
        self._previous = site_config.AUTO_CREATE_USER_DIRECTORY
        self.addCleanup(
            setattr, site_config, "AUTO_CREATE_USER_DIRECTORY", self._previous
        )

    def _create(self, username, **extra):
        payload = {
            "username": username,
            "password": create_password(),
            "email": f"{username}@test.com",
        }
        payload.update(extra)
        return self.client.post("/api/user/", payload)

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
        chosen = os.path.join(settings.DATA_ROOT, "autodir-chosen")
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
        # The candidate goes through normalize_scan_directory, so the #2034
        # overlap rule applies to it too -- and refusing it must not fail the
        # account either.
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

    @override_settings()
    def test_an_existing_folder_is_reused_rather_than_failing(self):
        site_config.AUTO_CREATE_USER_DIRECTORY = True
        already = os.path.abspath(os.path.join(settings.DATA_ROOT, "autodir_existing"))
        os.makedirs(already, exist_ok=True)

        response = self._create("autodir_existing")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(
            User.objects.get(username="autodir_existing").scan_directory, already
        )
