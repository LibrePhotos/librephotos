"""Role checks are permission classes, so refusals use the API's error shape (#2329).

Server logs and stats answered a non-staff user with an empty, non-JSON 403
from the view body; deleting a user answered a staff user who is not a
superuser with a 401, which the web client treats as an expired session and
signs out on. The caption endpoints listed an object-only permission that
never ran, so anonymous requests reached their bodies.
"""

from django.test import TestCase
from rest_framework.test import APIClient

from api.models import User
from api.models.photo_caption import PhotoCaption
from api.tests.utils import create_test_photo, create_test_user


def user_with(**roles: bool) -> User:
    user = create_test_user()
    for role, value in roles.items():
        setattr(user, role, value)
    user.save()
    return user


SERVER_ENDPOINTS = ("/api/serverlogs", "/api/serverlogs/view", "/api/serverstats")


class ServerEndpointsTest(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_anonymous_callers_get_401(self):
        for url in SERVER_ENDPOINTS:
            with self.subTest(url):
                self.assertEqual(self.client.get(url).status_code, 401)

    def test_a_non_staff_user_gets_a_json_403(self):
        self.client.force_authenticate(user=create_test_user())
        for url in SERVER_ENDPOINTS:
            with self.subTest(url):
                response = self.client.get(url)
                self.assertEqual(response.status_code, 403)
                self.assertEqual(response["Content-Type"], "application/json")
                self.assertEqual(response.json()["errors"][0]["field"], "detail")

    def test_staff_get_past_the_permission_check(self):
        self.client.force_authenticate(user=user_with(is_staff=True))
        response = self.client.get("/api/serverstats")
        self.assertEqual(response.status_code, 200)


class DeleteUserPermissionTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.victim = create_test_user()
        self.url = f"/api/delete/user/{self.victim.id}/"

    def test_anonymous_callers_get_401(self):
        self.assertEqual(self.client.delete(self.url).status_code, 401)
        self.assertTrue(User.objects.filter(pk=self.victim.pk).exists())

    def test_a_regular_user_gets_403(self):
        self.client.force_authenticate(user=create_test_user())
        self.assertEqual(self.client.delete(self.url).status_code, 403)
        self.assertTrue(User.objects.filter(pk=self.victim.pk).exists())

    def test_staff_who_is_not_a_superuser_gets_403_not_401(self):
        self.client.force_authenticate(user=user_with(is_staff=True))
        response = self.client.delete(self.url)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["errors"][0]["field"], "detail")
        self.assertTrue(User.objects.filter(pk=self.victim.pk).exists())

    def test_a_superuser_who_is_not_staff_is_still_refused(self):
        # The view always required staff as well; IsSuperUser did not widen it.
        self.client.force_authenticate(user=user_with(is_superuser=True))
        self.assertEqual(self.client.delete(self.url).status_code, 403)
        self.assertTrue(User.objects.filter(pk=self.victim.pk).exists())

    def test_a_superuser_deletes_the_user(self):
        self.client.force_authenticate(user=create_test_user(is_admin=True))
        self.assertEqual(self.client.delete(self.url).status_code, 204)
        self.assertFalse(User.objects.filter(pk=self.victim.pk).exists())


class CaptionEndpointsTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = create_test_user()
        self.photo = create_test_photo(owner=self.owner)

    def test_anonymous_callers_get_401(self):
        for url, body in (
            ("/api/photosedit/generateim2txt", {"image_hash": self.photo.image_hash}),
            (
                "/api/photosedit/savecaption",
                {"image_hash": self.photo.image_hash, "caption": "pwned"},
            ),
        ):
            with self.subTest(url):
                response = self.client.post(url, body, format="json")
                self.assertEqual(response.status_code, 401)
        self.assertFalse(
            PhotoCaption.objects.filter(
                photo=self.photo, captions_json__icontains="pwned"
            ).exists()
        )

    def test_the_owner_still_reaches_the_caption_save(self):
        self.client.force_authenticate(user=self.owner)
        response = self.client.post(
            "/api/photosedit/savecaption",
            {"image_hash": self.photo.image_hash, "caption": "A dog"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": True})
        captions = PhotoCaption.objects.get(photo=self.photo).captions_json
        self.assertEqual(captions["user_caption"], "A dog")

    def test_another_user_still_gets_photo_not_found(self):
        self.client.force_authenticate(user=create_test_user())
        response = self.client.post(
            "/api/photosedit/savecaption",
            {"image_hash": self.photo.image_hash, "caption": "pwned"},
            format="json",
        )
        self.assertEqual(response.status_code, 404)
