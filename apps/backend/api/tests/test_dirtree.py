from django.test import TestCase
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

    def test_regular_user_is_not_allowed_to_retrieve_dirtree(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.get("/api/dirtree/")
        self.assertEqual(403, response.status_code)

    def test_anonymous_user_is_not_allower_to_retrieve_dirtree(self):
        self.client.force_authenticate(user=None)
        response = self.client.get("/api/dirtree/")
        self.assertEqual(401, response.status_code)
