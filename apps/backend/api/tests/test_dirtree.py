from django.test import TestCase
from pyfakefs.fake_filesystem_unittest import Patcher
from rest_framework.test import APIClient

from api.models import User
from api.tests.utils import create_password


class DirTreeTest(TestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser(
            "admin", "admin@test.com", create_password()
        )
        self.user = User.objects.create_user("user", "user@test.com", create_password())
        self.client = APIClient()

    def test_admin_should_allow_to_retrieve_dirtree(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.get("/api/dirtree/")
        self.assertEqual(200, response.status_code)

    def test_should_retrieve_dir_listing_by_path(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.get("/api/dirtree/?path=/")
        self.assertEqual(200, response.status_code)

    def test_should_fail_when_listing_with_invalid_path(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.get("/api/dirtree/?path=/does_not_exist")
        data = response.json()
        self.assertEqual(200, response.status_code)
        self.assertEqual(
            data["message"], "[Errno 2] No such file or directory: '/does_not_exist'"
        )

    def test_children_list_should_be_alphabetical_case_insensitive(self):
        with Patcher() as patcher:
            patcher.fs.create_dir("/data")
            patcher.fs.create_dir("/data/Z")
            patcher.fs.create_dir("/data/a")
            patcher.fs.create_dir("/data/X")
            patcher.fs.create_dir("/data/b")

            self.client.force_authenticate(user=self.admin)
            response = self.client.get("/api/dirtree/")
            data = response.json()[0]
            self.assertEqual(200, response.status_code)
            self.assertEqual(data["children"][0]["title"], "a")
            self.assertEqual(data["children"][1]["title"], "b")
            self.assertEqual(data["children"][2]["title"], "X")
            self.assertEqual(data["children"][3]["title"], "Z")

    def test_regular_user_is_not_allowed_to_retrieve_dirtree(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.get("/api/dirtree/")
        self.assertEqual(403, response.status_code)

    def test_anonymous_user_is_not_allower_to_retrieve_dirtree(self):
        self.client.force_authenticate(user=None)
        response = self.client.get("/api/dirtree/")
        self.assertEqual(401, response.status_code)
