from unittest import mock

from constance.test import override_config
from django.test import TestCase
from rest_framework.test import APIClient

from api.tests.utils import create_test_user

LISTDIR_URL = "/api/nextcloud/listdir/?fpath=/"
SCANPHOTOS_URL = "/api/nextcloud/scanphotos"


class NextcloudSiteSettingTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = create_test_user(is_admin=True)

    def test_get_reports_nextcloud_disabled_by_default(self):
        response = self.client.get("/api/sitesettings")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["nextcloud_enabled"])

    @override_config(NEXTCLOUD_ENABLED=True)
    def test_get_reports_nextcloud_enabled(self):
        response = self.client.get("/api/sitesettings")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["nextcloud_enabled"])

    @mock.patch("api.views.views.do_all_models_exist", return_value=True)
    def test_admin_can_enable_nextcloud(self, _mock_do_all_models_exist):
        self.client.force_authenticate(user=self.admin)
        response = self.client.post(
            "/api/sitesettings",
            data={"nextcloud_enabled": True},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["nextcloud_enabled"])


class NextcloudEndpointGatingTest(TestCase):
    def setUp(self):
        self.user = create_test_user(
            nextcloud_server_address="https://cloud.example.com",
            nextcloud_username="alice",
            nextcloud_app_password="app-password",
            nextcloud_scan_directory="/Photos",
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_listdir_is_forbidden_while_nextcloud_is_disabled(self):
        response = self.client.get(LISTDIR_URL)
        self.assertEqual(response.status_code, 403)

    def test_scanphotos_is_forbidden_while_nextcloud_is_disabled(self):
        response = self.client.post(SCANPHOTOS_URL)
        self.assertEqual(response.status_code, 403)

    @override_config(NEXTCLOUD_ENABLED=True)
    def test_listdir_is_reachable_once_nextcloud_is_enabled(self):
        folder = mock.MagicMock()
        folder.path = "/Photos/"
        folder.is_dir.return_value = True
        factory = mock.MagicMock()
        factory.return_value.list.return_value = [folder]

        with mock.patch("nextcloud.views.nextcloud.Client", factory):
            response = self.client.get(LISTDIR_URL)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            [{"absolute_path": "/Photos/", "title": "Photos", "children": []}],
            response.json(),
        )

    @override_config(NEXTCLOUD_ENABLED=True)
    def test_scanphotos_is_reachable_once_nextcloud_is_enabled(self):
        with mock.patch("nextcloud.views.AsyncTask") as async_task:
            response = self.client.post(SCANPHOTOS_URL)

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["status"])
        async_task.return_value.run.assert_called_once()


class NextcloudTokenClaimsTest(TestCase):
    def setUp(self):
        self.user = create_test_user(
            nextcloud_server_address="https://cloud.example.com",
            nextcloud_username="alice",
        )

    @staticmethod
    def _token_for(user):
        from librephotos.urls import CustomTokenObtainPairSerializer

        return CustomTokenObtainPairSerializer.get_token(user)

    def test_token_omits_nextcloud_claims_while_disabled(self):
        token = self._token_for(self.user)
        self.assertNotIn("nextcloud_server_address", token)
        self.assertNotIn("nextcloud_username", token)

    @override_config(NEXTCLOUD_ENABLED=True)
    def test_token_carries_nextcloud_claims_once_enabled(self):
        token = self._token_for(self.user)
        self.assertEqual("https://cloud.example.com", token["nextcloud_server_address"])
        self.assertEqual("alice", token["nextcloud_username"])
