from constance.test import override_config
from django.test import TestCase
from rest_framework.test import APIClient

from api.models import User
from api.tests.utils import create_password


class UserTest(TestCase):
    public_user_properties = [
        "id",
        "avatar_url",
        "username",
        "first_name",
        "last_name",
        "public_photo_count",
        "public_photo_samples",
    ]

    private_user_properties = [
        "id",
        "username",
        "email",
        "scan_directory",
        "confidence",
        "confidence_person",
        "transcode_videos",
        "semantic_search_topk",
        "first_name",
        "public_photo_samples",
        "last_name",
        "public_photo_count",
        "date_joined",
        "avatar",
        "is_superuser",
        "photo_count",
        "nextcloud_server_address",
        "nextcloud_username",
        "nextcloud_scan_directory",
        "avatar_url",
        "favorite_min_rating",
        "image_scale",
        "save_metadata_to_disk",
        "datetime_rules",
        "default_timezone",
        "public_sharing",
    ]

    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create(
            username="admin",
            first_name="Super",
            last_name="Admin",
            email="admin@test.com",
            password=create_password(),
            is_superuser=True,
            is_staff=True,
        )
        self.user1 = User.objects.create(
            username="user1",
            first_name="Firstname1",
            last_name="Lastname1",
            email="user2@test.com",
            password=create_password(),
            public_sharing=True,
        )
        self.user2 = User.objects.create(
            username="user2",
            first_name="Firstname2",
            last_name="Lastname2",
            email="user2@test.com",
            password=create_password(),
        )

    def test_public_user_list_count(self):
        self.client.force_authenticate(user=None)
        response = self.client.get("/api/user/")
        data = response.json()
        self.assertEquals(
            len(User.objects.filter(public_sharing=True)), len(data["results"])
        )

    def test_public_user_list_properties(self):
        self.client.force_authenticate(user=None)
        response = self.client.get("/api/user/")
        data = response.json()
        for user in data["results"]:
            self.assertEqual(len(self.public_user_properties), len(user.keys()))
            for key in self.public_user_properties:
                self.assertTrue(key in user, f"user does not have key: {key}")

    def test_authenticated_user_list_count(self):
        self.client.force_authenticate(user=self.user1)
        response = self.client.get("/api/user/")
        data = response.json()
        self.assertEquals(len(User.objects.all()), len(data["results"]))

    def test_authenticated_user_list_properties(self):
        self.client.force_authenticate(user=self.user1)
        response = self.client.get("/api/user/")
        data = response.json()
        for user in data["results"]:
            self.assertEqual(len(self.private_user_properties), len(user.keys()))
            for key in self.private_user_properties:
                self.assertTrue(key in user, f"user does not have key: {key}")

    def test_user_update_self(self):
        self.client.force_authenticate(user=self.user1)
        response = self.client.patch(
            f"/api/user/{self.user1.id}/", data={"first_name": "Updated"}
        )
        self.assertEqual(200, response.status_code)

    def test_public_update_user(self):
        self.client.force_authenticate(user=None)
        response = self.client.patch(
            f"/api/user/{self.user1.id}/", data={"first_name": "Updated"}
        )
        self.assertEqual(401, response.status_code)

    def test_public_delete_user(self):
        self.client.force_authenticate(user=None)
        response = self.client.delete(f"/api/user/{self.user1.id}/")
        self.assertEqual(401, response.status_code)

    @override_config(ALLOW_REGISTRATION=False)
    def test_public_user_create_successful_on_first_setup(self):
        User.objects.all().delete()
        self.client.force_authenticate(user=None)
        data = {
            "username": "super-admin",
            "first_name": "Super",
            "last_name": "Admin",
            "email": "super-admin@test.com",
            "password": create_password(),
        }
        response = self.client.post("/api/user/", data=data)
        self.assertEqual(201, response.status_code)
        self.assertEqual(1, len(User.objects.all()))
        user = User.objects.get(username="super-admin")
        self.assertTrue(user.is_superuser)

    @override_config(ALLOW_REGISTRATION=True)
    def test_public_user_create_successful_when_registration_enabled(self):
        self.client.force_authenticate(user=None)
        data = {
            "username": "new-user",
            "first_name": "NewFirstname",
            "last_name": "NewLastname",
            "email": "new-user@test.com",
            "password": create_password(),
        }
        response = self.client.post("/api/user/", data=data)
        self.assertEqual(201, response.status_code)
        user = User.objects.get(username="new-user")
        self.assertEqual("new-user", user.username)
        self.assertEqual("new-user@test.com", user.email)
        self.assertEqual("NewFirstname", user.first_name)
        self.assertEqual("NewLastname", user.last_name)

    @override_config(ALLOW_REGISTRATION=True)
    def test_after_registration_user_can_authenticate(self):
        self.client.force_authenticate(user=None)
        user = {
            "username": "bart",
            "first_name": "Bart",
            "last_name": "Simpson",
            "email": "bart@test.com",
            "password": create_password(),
        }
        signup_response = self.client.post("/api/user/", data=user)
        self.assertEqual(201, signup_response.status_code)
        login_payload = {
            "username": user["username"],
            "password": user["password"],
        }
        response = self.client.post("/api/auth/token/obtain/", data=login_payload)
        self.assertEqual(200, response.status_code)
        data = response.json()
        self.assertTrue("access" in data.keys())
        self.assertTrue("refresh" in data.keys())

    @override_config(ALLOW_REGISTRATION=False)
    def test_public_user_create_fails_when_registration_disabled(self):
        self.client.force_authenticate(user=None)
        data = {
            "username": "another-user",
            "first_name": "NewFirstname",
            "last_name": "NewLastname",
            "email": "another-user@test.com",
            "password": create_password(),
        }
        response = self.client.post("/api/user/", data=data)
        # because IsAdminOrFirstTimeSetupOrRegistrationAllowed is **global** permission
        # on UserViewSet, we are returning 401 and not 403
        self.assertEqual(401, response.status_code)

    @override_config(ALLOW_REGISTRATION=True)
    def test_not_first_setup_create_admin_should_create_regular_user(self):
        self.client.force_authenticate(user=None)
        data = {
            "username": "user3",
            "first_name": "Firstname3",
            "last_name": "Lastname3",
            "email": "user3@test.com",
            "password": create_password(),
            "is_superuser": True,
        }
        response = self.client.post("/api/user/", data=data)
        self.assertEqual(201, response.status_code)
        user = User.objects.get(username="user3")
        self.assertEqual(False, user.is_superuser)

    def test_user_update_another_user(self):
        self.client.force_authenticate(user=self.user1)
        response = self.client.patch(
            f"/api/user/{self.user2.id}/", data={"first_name": "Updated"}
        )
        self.assertEqual(403, response.status_code)

    def test_user_delete_another_user(self):
        self.client.force_authenticate(user=self.user1)
        response = self.client.delete(f"/api/user/{self.user2.id}/")
        self.assertEqual(403, response.status_code)

    def test_admin_create_user(self):
        self.client.force_authenticate(user=self.admin)
        data = {
            "username": "new-user",
            "password": create_password(),
        }
        response = self.client.post("/api/user/", data=data)
        self.assertEqual(201, response.status_code)

    def test_admin_partial_update_user(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.patch(
            f"/api/user/{self.user1.id}/", data={"first_name": "Updated"}
        )
        self.assertEqual(200, response.status_code)

    def test_admin_delete_user(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.delete(f"/api/user/{self.user1.id}/")
        self.assertEqual(204, response.status_code)

    @override_config(ALLOW_REGISTRATION=False)
    def test_first_time_setup_creates_user_when_registration_is_disabled(self):
        User.objects.all().delete()
        self.client.force_authenticate(user=None)
        data = {
            "username": self.user1.username,
            "first_name": self.user1.first_name,
            "last_name": self.user1.last_name,
            "email": self.user1.email,
            "password": create_password(),
        }
        response = self.client.post("/api/user/", data=data)
        self.assertEqual(201, response.status_code)

    def test_first_time_setup(self):
        User.objects.all().delete()
        response = self.client.get("/api/firsttimesetup/")
        data = response.json()
        self.assertEqual(True, data["isFirstTimeSetup"])

    @override_config(ALLOW_REGISTRATION=True)
    def test_not_first_time_setup(self):
        self.client.force_authenticate(user=None)
        data = {
            "username": "user-name",
            "first_name": "First",
            "last_name": "Last",
            "email": "user-email@test.com",
            "password": create_password(),
        }
        signup_response = self.client.post("/api/user/", data=data)
        self.assertEqual(201, signup_response.status_code)
        user = User.objects.get(username="user-name")
        self.client.force_authenticate(user=user)
        response = self.client.get("/api/firsttimesetup/")
        data = response.json()
        self.assertEqual(False, data["isFirstTimeSetup"])

    def test_regular_user_not_allowed_to_set_scan_directory(self):
        self.client.force_authenticate(user=self.user1)
        response = self.client.patch(
            f"/api/user/{self.user1.id}/", {"scan_directory": "/data"}
        )
        data = response.json()
        self.assertNotEqual("/data", data["scan_directory"])
