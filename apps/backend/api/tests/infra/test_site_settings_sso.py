"""The single sign-on switches in the site settings (#2725).

OIDC_ENABLED, OIDC_BUTTON_LABEL and OIDC_ALLOW_SIGNUP were reachable only on the
Constance page of the Django admin while the guide sent admins to Site Settings.
"""

from unittest.mock import patch

from allauth.socialaccount.models import SocialApp
from constance import config as site_config
from constance.test import override_config
from django.contrib.sites.models import Site
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from api.tests.utils import create_test_user

URL = "/api/sitesettings"


def _make_social_app(name, on_site=True):
    app = SocialApp.objects.create(
        provider="openid_connect",
        provider_id=name.lower(),
        name=name,
        client_id="librephotos",
        secret="s3cret",
    )
    if on_site:
        app.sites.add(Site.objects.get_current())
    return app


def _error_fields(resp):
    return [error["field"] for error in resp.json()["errors"]]


@patch("api.views.site_settings.do_all_models_exist", return_value=True)
class SsoSiteSettingsTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(user=create_test_user(is_admin=True))

    @override_config(
        OIDC_ENABLED=True,
        OIDC_BUTTON_LABEL="Sign in with Keycloak",
        OIDC_ALLOW_SIGNUP=False,
    )
    def test_get_reads_the_three_switches(self, _models):
        body = self.client.get(URL).json()

        self.assertTrue(body["oidc_enabled"])
        self.assertEqual(body["oidc_button_label"], "Sign in with Keycloak")
        self.assertFalse(body["oidc_allow_signup"])

    def test_post_round_trip(self, _models):
        resp = self.client.post(
            URL,
            {
                "oidc_enabled": True,
                "oidc_button_label": "  Sign in with Authentik  ",
                "oidc_allow_signup": True,
            },
            format="json",
        )

        self.assertEqual(resp.status_code, 200, resp.content)
        body = resp.json()
        self.assertTrue(body["oidc_enabled"])
        # Trimmed: the login button shows the label as it is stored.
        self.assertEqual(body["oidc_button_label"], "Sign in with Authentik")
        self.assertTrue(body["oidc_allow_signup"])
        self.assertTrue(site_config.OIDC_ENABLED)
        self.assertEqual(site_config.OIDC_BUTTON_LABEL, "Sign in with Authentik")
        self.assertTrue(site_config.OIDC_ALLOW_SIGNUP)

    @override_config(OIDC_ENABLED=True)
    def test_the_login_page_follows_the_switch(self, _models):
        _make_social_app("Keycloak")
        self.assertTrue(self.client.get("/api/auth/sso/config/").json()["enabled"])

        self.client.post(URL, {"oidc_enabled": False}, format="json")

        self.assertFalse(self.client.get("/api/auth/sso/config/").json()["enabled"])

    @override_config(OIDC_BUTTON_LABEL="Sign in with SSO")
    def test_a_too_long_label_is_refused(self, _models):
        resp = self.client.post(URL, {"oidc_button_label": "x" * 65}, format="json")

        self.assertEqual(resp.status_code, 400)
        self.assertEqual(_error_fields(resp), ["oidc_button_label"])
        self.assertEqual(site_config.OIDC_BUTTON_LABEL, "Sign in with SSO")

    def test_a_label_of_64_characters_is_kept(self, _models):
        resp = self.client.post(URL, {"oidc_button_label": "x" * 64}, format="json")

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(site_config.OIDC_BUTTON_LABEL, "x" * 64)

    def test_the_switches_take_json_booleans_only(self, _models):
        resp = self.client.post(URL, {"oidc_enabled": "yes"}, format="json")

        self.assertEqual(resp.status_code, 400)
        self.assertEqual(_error_fields(resp), ["oidc_enabled"])

    @override_config(OIDC_ENABLED=False)
    def test_non_admins_cannot_change_them(self, _models):
        self.client.force_authenticate(user=create_test_user())

        resp = self.client.post(URL, {"oidc_enabled": True}, format="json")

        self.assertEqual(resp.status_code, 403)
        self.assertFalse(site_config.OIDC_ENABLED)

    def test_admin_sees_the_providers_and_whether_they_are_on_this_site(self, _models):
        _make_social_app("Keycloak")
        _make_social_app("Authentik", on_site=False)

        body = self.client.get(URL).json()

        self.assertEqual(
            body["sso_providers"],
            [
                {"name": "Authentik", "on_this_site": False},
                {"name": "Keycloak", "on_this_site": True},
            ],
        )

    @override_settings(FRONTEND_BASE_URL="https://photos.example.com")
    def test_admin_sees_that_the_public_url_is_set(self, _models):
        self.assertTrue(self.client.get(URL).json()["public_url_configured"])

    @override_settings(FRONTEND_BASE_URL="")
    def test_admin_sees_that_the_public_url_is_missing_behind_the_proxy(self, _models):
        # The proxy rewrites Host to backend for /api/; SSO cannot start then.
        body = self.client.get(URL, HTTP_HOST="backend").json()

        self.assertFalse(body["public_url_configured"])

    def test_anonymous_get_has_the_switches_but_not_the_setup(self, _models):
        _make_social_app("Keycloak")
        self.client.force_authenticate(user=None)

        body = self.client.get(URL).json()

        self.assertIn("oidc_enabled", body)
        self.assertIn("oidc_button_label", body)
        self.assertNotIn("sso_providers", body)
        self.assertNotIn("public_url_configured", body)
