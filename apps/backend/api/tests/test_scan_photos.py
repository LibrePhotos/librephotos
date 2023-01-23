import os
from unittest import skip

from django.test import TestCase
from django_rq import get_worker
from rest_framework.test import APIClient

from api.models import User

samplephotos_dir = os.path.abspath("samplephotos")


@skip("broken")
class ScanPhotosTestCase(TestCase):
    def setUp(self):
        self.client_admin = APIClient()

        self.client_users = [APIClient() for _ in range(2)]

        User.objects.create_superuser(
            "test_admin", "test_admin@test.com", "test_password"
        )
        admin_auth_res = self.client_admin.post(
            "/api/auth/token/obtain/",
            {
                "username": "test_admin",
                "password": "test_password",
            },
        )
        self.client_admin.credentials(
            HTTP_AUTHORIZATION="Bearer " + admin_auth_res.json()["access"]
        )

        # enable signup as admin
        change_settings_res = self.client_admin.post(
            "/api/sitesettings/", {"allow_registration": True}
        )
        self.assertEqual(change_settings_res.json()["allow_registration"], "True")
        self.assertEqual(change_settings_res.status_code, 200)

        logged_in_clients = []

        # sign up 6 test users
        user_ids = []

        for idx, client in enumerate(self.client_users):
            create_user_res = client.post(
                "/api/user/",
                {
                    "email": "test_user_{}@test.com".format(idx),
                    "username": "test_user_{}".format(idx),
                    "password": "test_password",
                },
            )

            self.assertEqual(create_user_res.status_code, 201)
            user_ids.append(create_user_res.json()["id"])

            login_user_res = client.post(
                "/api/auth/token/obtain/",
                {
                    "username": "test_user_{}".format(idx),
                    "password": "test_password",
                },
            )
            self.assertEqual(login_user_res.status_code, 200)

            client.credentials(
                HTTP_AUTHORIZATION="Bearer " + login_user_res.json()["access"]
            )
            logged_in_clients.append(client)
        self.client_users = logged_in_clients

        # set scan directories for each user as admin
        for idx, (user_id, client) in enumerate(zip(user_ids, self.client_users)):
            user_scan_directory = os.path.join(samplephotos_dir, "test{}".format(idx))
            self.assertNotEqual(user_scan_directory, "")
            patch_res = self.client_admin.patch(
                "/api/manage/user/{}/".format(user_id),
                {"scan_directory": user_scan_directory},
            )
            self.assertEqual(patch_res.json(), {})
            self.assertEqual(patch_res.status_code, 200)
            self.assertEqual(patch_res.json()["scan_directory"], user_scan_directory)

        # make sure users are logged in
        for client in self.client_users:
            res = client.get("/api/photos/")
            self.assertEqual(res.status_code, 200)

        # scan photos
        scan_photos_res = self.client_users[0].get("/api/scanphotos/")
        self.assertEqual(scan_photos_res.status_code, 200)
        get_worker().work(burst=True)

        # make sure photos are imported
        get_photos_res = self.client_users[0].get("/api/photos/")
        self.assertEqual(get_photos_res.status_code, 200)
        self.assertTrue(len(get_photos_res.json()["results"]) > 0)

        # try scanning again and make sure there are no duplicate imports
        num_photos = len(get_photos_res.json()["results"])
        scan_photos_res = self.client_users[0].get("/api/scanphotos/")
        self.assertEqual(scan_photos_res.status_code, 200)
        get_worker().work(burst=True)
        get_photos_res = self.client_users[0].get("/api/photos/")
        self.assertEqual(get_photos_res.status_code, 200)
        self.assertEqual(len(get_photos_res.json()["results"]), num_photos)

    def test_auto_albums(self):
        """make sure user can make auto albums, list and retrieve them"""
        # make auto albums
        auto_album_gen_res = self.client_users[0].get("/api/autoalbumgen/")
        self.assertEqual(auto_album_gen_res.status_code, 200)
        get_worker().work(burst=True)

        # make sure auto albums are there
        auto_album_list_res = self.client_users[0].get("/api/albums/auto/list/")
        self.assertEqual(auto_album_list_res.status_code, 200)

        # make sure user can retrieve each auto album
        for album in auto_album_list_res.json()["results"]:
            auto_album_retrieve_res = self.client_users[0].get(
                "/api/albums/auto/%d/" % album["id"]
            )
            self.assertEqual(auto_album_retrieve_res.status_code, 200)
            self.assertTrue(len(auto_album_retrieve_res.json()["photos"]) > 0)

        # try making auto albums again and make sure there are no duplicates
        num_auto_albums = len(auto_album_list_res.json()["results"])

        auto_album_gen_res = self.client_users[0].get("/api/autoalbumgen/")
        self.assertEqual(auto_album_gen_res.status_code, 200)
        get_worker().work(burst=True)

        auto_album_list_res = self.client_users[0].get("/api/albums/auto/list/")
        self.assertEqual(len(auto_album_list_res.json()["results"]), num_auto_albums)

    def test_place_albums(self):
        """make sure user can list and retrieve place albums"""
        place_album_list_res = self.client_users[0].get("/api/albums/place/list/")
        self.assertEqual(place_album_list_res.status_code, 200)

        for album in place_album_list_res.json()["results"]:
            place_album_retrieve_res = self.client_users[0].get(
                "/api/albums/place/%d/" % album["id"]
            )
            self.assertEqual(place_album_retrieve_res.status_code, 200)

    def test_thing_albums(self):
        """make sure user can list and retrieve thing albums"""
        thing_album_list_res = self.client_users[0].get("/api/albums/thing/list/")
        self.assertEqual(thing_album_list_res.status_code, 200)

        for album in thing_album_list_res.json()["results"]:
            thing_album_retrieve_res = self.client_users[0].get(
                "/api/albums/thing/%d/" % album["id"]
            )
            self.assertEqual(thing_album_retrieve_res.status_code, 200)
