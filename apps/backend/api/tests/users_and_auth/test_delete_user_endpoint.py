"""/api/delete/user/ deletes a user and does nothing else.

It used to be a full ModelViewSet over a serializer of every User column: an
admin could GET a user's password hash from it, and PUT or PATCH a
scan_directory or upload_directory past the DATA_ROOT and overlap checks that
/api/manage/user/ enforces.
"""

from django.test import TestCase
from rest_framework.test import APIClient

from api.models import User
from api.tests.utils import create_test_user


class DeleteUserEndpointTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = create_test_user(is_admin=True)
        self.user = create_test_user(scan_directory="/data/user")
        self.other = create_test_user()

    def url(self, user):
        return f"/api/delete/user/{user.id}/"

    def test_admin_cannot_read_a_user_through_it(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.get(self.url(self.user))
        self.assertEqual(405, response.status_code)
        self.assertNotIn(b"password", response.content)

    def test_admin_cannot_list_users_through_it(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.get("/api/delete/user/")
        self.assertEqual(404, response.status_code)

    def test_admin_cannot_create_a_user_through_it(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.post(
            "/api/delete/user/", data={"username": "sneaky", "password": "x"}
        )
        self.assertEqual(404, response.status_code)
        self.assertFalse(User.objects.filter(username="sneaky").exists())

    def test_admin_cannot_patch_a_scan_directory_through_it(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.patch(
            self.url(self.user), data={"scan_directory": "/etc"}, format="json"
        )
        self.assertEqual(405, response.status_code)
        self.user.refresh_from_db()
        self.assertEqual("/data/user", self.user.scan_directory)

    def test_admin_cannot_put_an_upload_directory_through_it(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.put(
            self.url(self.user),
            data={"username": self.user.username, "upload_directory": "/etc"},
            format="json",
        )
        self.assertEqual(405, response.status_code)
        self.user.refresh_from_db()
        self.assertNotEqual("/etc", self.user.upload_directory)

    def test_admin_deletes_a_user(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.delete(self.url(self.user))
        self.assertEqual(204, response.status_code)
        self.assertFalse(User.objects.filter(id=self.user.id).exists())

    def test_admin_still_cannot_delete_another_admin(self):
        other_admin = create_test_user(is_admin=True)
        self.client.force_authenticate(user=self.admin)
        response = self.client.delete(self.url(other_admin))
        self.assertEqual(400, response.status_code)
        self.assertTrue(User.objects.filter(id=other_admin.id).exists())

    def test_regular_user_cannot_delete_a_user(self):
        self.client.force_authenticate(user=self.other)
        response = self.client.delete(self.url(self.user))
        self.assertEqual(403, response.status_code)
        self.assertTrue(User.objects.filter(id=self.user.id).exists())

    def test_anonymous_cannot_delete_a_user(self):
        response = self.client.delete(self.url(self.user))
        self.assertIn(response.status_code, (401, 403))
        self.assertTrue(User.objects.filter(id=self.user.id).exists())
