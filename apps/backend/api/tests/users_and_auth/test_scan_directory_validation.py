import os

from django.conf import settings
from django.test import TestCase
from rest_framework.test import APIClient

from api.models import User
from api.tests.utils import create_password


class SetupDirectoryTestCase(TestCase):
    userid = 0

    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_superuser(
            "test_admin", "test_admin@test.com", create_password()
        )

    def test_setup_directory(self):
        # UserSerializer.update accepts a scan directory only if it is inside
        # settings.DATA_ROOT *and* exists on disk. DATA_ROOT is
        # os.path.join(BASE_DATA, "data"), so "/data" is only correct inside the
        # container; use the configured root and make sure it is really there.
        os.makedirs(settings.DATA_ROOT, exist_ok=True)
        self.client.force_authenticate(user=self.admin)
        response = self.client.patch(
            f"/api/manage/user/{self.admin.id}/",
            {"scan_directory": settings.DATA_ROOT},
        )
        self.assertEqual(response.status_code, 200)

    def test_setup_not_existing_directory(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.patch(
            f"/api/manage/user/{self.admin.id}/",
            {"scan_directory": "/non-existent-directory"},
        )
        self.assertEqual(response.status_code, 400)
        # Check for the error message in the new format
        data = response.json()
        self.assertIn("errors", data)
        self.assertGreater(len(data["errors"]), 0)
        self.assertEqual(
            data["errors"][0]["message"], "Scan directory must be inside the data root."
        )


class CreateUserScanDirectoryTestCase(TestCase):
    """Creating a user must validate scan_directory the same way updating does.

    Before the fix for #492, ``UserSerializer.create`` stored whatever an admin
    sent, so a user could be created with a scan directory outside DATA_ROOT or
    pointing at a directory that does not exist -- with no error at all.
    """

    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_superuser(
            "create_admin", "create_admin@test.com", create_password()
        )
        self.client.force_authenticate(user=self.admin)
        os.makedirs(settings.DATA_ROOT, exist_ok=True)

    def _create(self, username, scan_directory):
        return self.client.post(
            "/api/user/",
            {
                "username": username,
                "password": create_password(),
                "email": f"{username}@test.com",
                "scan_directory": scan_directory,
            },
        )

    def test_create_with_missing_scan_directory_is_rejected(self):
        missing = os.path.join(settings.DATA_ROOT, "does-not-exist")
        response = self._create("missingdir", missing)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            response.json()["errors"][0]["message"], "Scan directory does not exist"
        )
        self.assertFalse(User.objects.filter(username="missingdir").exists())

    def test_create_with_scan_directory_outside_data_root_is_rejected(self):
        outside = os.path.abspath(os.path.join(settings.DATA_ROOT, "..", "elsewhere"))
        response = self._create("outsidedir", outside)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            response.json()["errors"][0]["message"],
            "Scan directory must be inside the data root.",
        )
        self.assertFalse(User.objects.filter(username="outsidedir").exists())

    def test_create_with_valid_scan_directory_is_accepted_and_normalized(self):
        response = self._create("gooddir", settings.DATA_ROOT + os.sep)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(
            User.objects.get(username="gooddir").scan_directory,
            os.path.abspath(settings.DATA_ROOT),
        )

    def test_create_with_initial_sentinel_still_works(self):
        response = self._create("initialdir", "initial")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(User.objects.get(username="initialdir").scan_directory, "")

    def test_per_field_validation_error_is_a_clean_sentence(self):
        """The custom exception handler used to ``str()`` the whole ErrorDetail
        list, so the response carried its Python repr. Now that the frontend
        shows these messages, they have to be readable."""
        User.objects.create_user("taken", "taken@test.com", create_password())
        response = self._create("taken", settings.DATA_ROOT)
        self.assertEqual(response.status_code, 400)
        errors = response.json()["errors"]
        self.assertEqual(errors[0]["field"], "username")
        self.assertEqual(
            errors[0]["message"], "A user with that username already exists."
        )
