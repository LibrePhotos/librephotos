import json

from django.http import HttpResponseBase
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from api.accounts.demo_site import READ_ONLY_CODE, allows_on_demo_site
from api.models import User
from api.tests.utils import create_test_photo, create_test_user

DEMO_PASSWORD = "demo-pass-1234"


def _error_code(response: HttpResponseBase) -> str:
    return json.loads(response.content)["errors"][0]["code"]


class AllowsOnDemoSiteTest(TestCase):
    def test_reads_pass(self) -> None:
        for method in ("GET", "HEAD", "OPTIONS", "get"):
            self.assertTrue(allows_on_demo_site(method, "/api/photos/"))

    def test_sign_in_and_out_pass_with_or_without_slash(self) -> None:
        for path in (
            "/api/auth/token/obtain/",
            "/api/auth/token/obtain",
            "/api/auth/token/refresh/",
            "/api/auth/token/blacklist/",
        ):
            self.assertTrue(allows_on_demo_site("POST", path))

    def test_other_writes_are_refused(self) -> None:
        for method, path in (
            ("POST", "/api/user/"),
            ("PATCH", "/api/user/1/"),
            ("POST", "/api/upload/"),
            ("POST", "/api/photosedit/favorite/"),
            ("DELETE", "/api/photosedit/delete/"),
            ("POST", "/api/sitesettings"),
            ("POST", "/api/scanphotos/"),
            ("PUT", "/api/auth/token/obtain/extra/"),
            ("POST", "/api/django-admin/login/"),
        ):
            self.assertFalse(allows_on_demo_site(method, path), (method, path))


@override_settings(DEMO_SITE=True, DEMO_USERNAME="demo", DEMO_PASSWORD=DEMO_PASSWORD)
class DemoSiteRequestsTest(TestCase):
    def setUp(self) -> None:
        self.user = create_test_user(username="demo", password=DEMO_PASSWORD)
        self.admin = create_test_user(is_admin=True)
        self.photo = create_test_photo(owner=self.user)
        self.client = APIClient()

    def test_demo_account_signs_in_and_reads(self) -> None:
        response = self.client.post(
            "/api/auth/token/obtain/",
            {"username": "demo", "password": DEMO_PASSWORD},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.client.force_authenticate(user=self.user)
        self.assertEqual(self.client.get("/api/photos/").status_code, 200)

    def test_password_change_is_refused(self) -> None:
        self.client.force_authenticate(user=self.user)
        response = self.client.patch(
            f"/api/user/{self.user.id}/",
            {"password": "new-password-5678"},
            format="json",
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(_error_code(response), READ_ONLY_CODE)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password(DEMO_PASSWORD))

    def test_photo_edits_are_refused(self) -> None:
        self.client.force_authenticate(user=self.user)
        response = self.client.post(
            "/api/photosedit/favorite/",
            {"photo_ids": [str(self.photo.id)], "favorite": True},
            format="json",
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(_error_code(response), READ_ONLY_CODE)

    def test_deletes_are_refused(self) -> None:
        self.client.force_authenticate(user=self.user)
        response = self.client.delete(
            "/api/photosedit/delete/",
            {"photo_ids": [str(self.photo.id)]},
            format="json",
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(_error_code(response), READ_ONLY_CODE)

    def test_admin_writes_are_refused_too(self) -> None:
        self.client.force_authenticate(user=self.admin)
        for method, path, body in (
            ("post", "/api/sitesettings", {"allow_upload": True}),
            ("post", "/api/user/", {"username": "new", "password": "x" * 12}),
            ("post", "/api/scanphotos/", {}),
        ):
            response = getattr(self.client, method)(path, body, format="json")
            self.assertEqual(response.status_code, 403, path)
            self.assertEqual(_error_code(response), READ_ONLY_CODE, path)
        self.assertFalse(User.objects.filter(username="new").exists())

    def test_anonymous_writes_are_refused(self) -> None:
        response = self.client.post(
            "/api/user/",
            {"username": "visitor", "password": "x" * 12},
            format="json",
        )
        self.assertEqual(response.status_code, 403)
        self.assertFalse(User.objects.filter(username="visitor").exists())

    def test_site_settings_say_demo_and_turn_off_upload_and_sign_up(self) -> None:
        body = self.client.get("/api/sitesettings").json()
        self.assertTrue(body["demo_site"])
        self.assertEqual(body["demo_username"], "demo")
        self.assertEqual(body["demo_password"], DEMO_PASSWORD)
        self.assertFalse(body["allow_upload"])
        self.assertFalse(body["allow_registration"])


class NotDemoSiteTest(TestCase):
    def test_writes_pass_and_settings_say_no_demo(self) -> None:
        user = create_test_user()
        client = APIClient()
        client.force_authenticate(user=user)
        body = client.get("/api/sitesettings").json()
        self.assertFalse(body["demo_site"])
        self.assertEqual(body["demo_username"], "")
        self.assertEqual(body["demo_password"], "")
        response = client.patch(
            f"/api/user/{user.id}/", {"first_name": "Ada"}, format="json"
        )
        self.assertEqual(response.status_code, 200)
