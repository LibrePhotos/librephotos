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
