import os

from django.conf import settings
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
        # The view only accepts paths inside settings.DATA_ROOT, and DATA_ROOT is
        # os.path.join(BASE_DATA, "data") - "/data" only when BASE_DATA is unset
        # or "/", i.e. inside the container. Ask for the real data root instead of
        # the containerised spelling of it.
        os.makedirs(settings.DATA_ROOT, exist_ok=True)
        self.client.force_authenticate(user=self.admin)
        # Pass the path as query data so the client url-encodes it: outside the
        # container DATA_ROOT can contain characters that are not query-safe.
        response = self.client.get("/api/dirtree/", {"path": settings.DATA_ROOT})
        self.assertEqual(200, response.status_code)

    def test_should_fail_when_listing_with_invalid_path(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.get("/api/dirtree/?path=/does_not_exist")
        data = response.json()
        self.assertEqual(403, response.status_code)
        self.assertEqual(
            data["message"], "Access denied. Path is outside the allowed directory."
        )

    def test_children_list_should_be_alphabetical_case_insensitive(self):
        # The view lists settings.DATA_ROOT, which is only "/data" inside the
        # container, so the fixture directories have to be created under the
        # configured data root. Read it before entering the Patcher: inside it
        # every path lookup goes to the fake filesystem, and settings must not be
        # resolved for the first time against a filesystem that has no real files.
        data_root = settings.DATA_ROOT

        with Patcher() as patcher:
            # The fake filesystem starts out empty, so these have to be created
            # through patcher.fs rather than on disk beforehand - anything the
            # real filesystem holds is invisible in here.
            patcher.fs.create_dir(data_root)
            for name in ("Z", "a", "X", "b"):
                patcher.fs.create_dir(os.path.join(data_root, name))

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
