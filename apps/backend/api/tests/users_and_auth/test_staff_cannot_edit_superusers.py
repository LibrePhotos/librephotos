"""A staff account that is not a superuser cannot edit a superuser.

Both user editors (``PATCH /api/manage/user/<id>/`` and ``PATCH
/api/user/<id>/``) let any staff account set a superuser's password, email
or username, and so sign in as that superuser. Staff still manage the other
users, and a superuser still edits anyone.
"""

from django.test import TestCase
from rest_framework.test import APIClient

from api.tests.utils import create_test_user


def client_for(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


class StaffEditsSuperuserTest(TestCase):
    def setUp(self):
        self.superuser = create_test_user(is_admin=True, password="old-secret-1")
        self.staff = create_test_user(is_staff=True, is_superuser=False)
        self.user = create_test_user()

    def assert_untouched(self, email):
        self.superuser.refresh_from_db()
        self.assertTrue(self.superuser.check_password("old-secret-1"))
        self.assertEqual(self.superuser.email, email)

    def test_staff_cannot_reset_a_superusers_password_or_email(self):
        email = self.superuser.email
        for url in (
            f"/api/manage/user/{self.superuser.pk}/",
            f"/api/user/{self.superuser.pk}/",
        ):
            with self.subTest(url=url):
                resp = client_for(self.staff).patch(
                    url,
                    {"password": "taken-over-1", "email": "attacker@example.com"},
                    format="json",
                )
                self.assertEqual(resp.status_code, 403)
                self.assert_untouched(email)

    def test_staff_cannot_rename_a_superuser(self):
        resp = client_for(self.staff).patch(
            f"/api/manage/user/{self.superuser.pk}/",
            {"username": "renamed-admin"},
            format="json",
        )
        self.assertEqual(resp.status_code, 403)

    def test_staff_still_manage_regular_users(self):
        for url in (
            f"/api/manage/user/{self.user.pk}/",
            f"/api/user/{self.user.pk}/",
        ):
            with self.subTest(url=url):
                resp = client_for(self.staff).patch(
                    url, {"first_name": "Edited"}, format="json"
                )
                self.assertEqual(resp.status_code, 200)

    def test_a_superuser_edits_another_superuser(self):
        other = create_test_user(is_admin=True)
        resp = client_for(other).patch(
            f"/api/manage/user/{self.superuser.pk}/",
            {"password": "new-secret-2"},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        self.superuser.refresh_from_db()
        self.assertTrue(self.superuser.check_password("new-secret-2"))

    def test_a_superuser_edits_themself(self):
        resp = client_for(self.superuser).patch(
            f"/api/user/{self.superuser.pk}/", {"first_name": "Me"}, format="json"
        )
        self.assertEqual(resp.status_code, 200)
