"""Tests for OIDC/SSO login (#401).

Three things are worth guarding here, in rising order of consequence:

* the public-URL plumbing, because behind the standard proxy the request cannot
  tell us the origin and a wrong ``redirect_uri`` breaks the flow outright;
* the JWT bridge, because it is what turns an external identity into a
  LibrePhotos credential;
* the adapter policy, because getting it wrong means account takeover — linking
  an unverified provider email onto an existing account, or provisioning a
  privileged user.
"""

from allauth.account.models import EmailAddress
from allauth.core.exceptions import ImmediateHttpResponse
from allauth.socialaccount.models import SocialAccount, SocialApp, SocialLogin
from constance.test import override_config
from django.contrib.auth import get_user_model
from django.contrib.messages.middleware import MessageMiddleware
from django.contrib.sessions.middleware import SessionMiddleware
from django.contrib.sites.models import Site
from django.test import RequestFactory, TestCase, override_settings
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from api.adapters import SSOSocialAccountAdapter
from api.public_url import is_internal_base_url, public_base_url
from api.views.sso import LibrePhotosOIDCAdapter

User = get_user_model()

CONFIG_URL = "/api/auth/sso/config/"
FINISH_URL = "/api/auth/sso/finish/"
CALLBACK_PATH = "/api/accounts/oidc/keycloak/login/callback/"


def _request(path=CALLBACK_PATH):
    """A request complete enough for allauth to log a user in against.

    ``sociallogin.connect()`` touches the session and the message store, which a
    bare RequestFactory request does not have.
    """
    request = RequestFactory().get(path)
    SessionMiddleware(lambda r: None).process_request(request)
    request.session.save()
    MessageMiddleware(lambda r: None).process_request(request)
    return request


def _make_social_app(provider_id="keycloak", name="Keycloak"):
    """The admin-configured provider. allauth resolves it whenever it needs to
    turn a SocialAccount back into a provider, so linking needs one to exist."""
    app = SocialApp.objects.create(
        provider="openid_connect",
        provider_id=provider_id,
        name=name,
        client_id="librephotos",
        secret="s3cret",
        settings={"server_url": "https://idp.example.com"},
    )
    app.sites.add(Site.objects.get_current())
    return app


def _make_social_login(email="sso@example.com", verified=True, uid="idp-sub-1"):
    """A social login as it looks after the IdP round-trip but before commit."""
    account = SocialAccount(provider="keycloak", uid=uid)
    sociallogin = SocialLogin(user=User(), account=account)
    sociallogin.email_addresses = (
        [EmailAddress(email=email, verified=verified, primary=True)] if email else []
    )
    if email:
        sociallogin.account.extra_data = {"email": email, "email_verified": verified}
    else:
        sociallogin.account.extra_data = {}
    return sociallogin


class PublicBaseUrlTest(TestCase):
    """The proxy rewrites Host for /api/, so the origin has to be configured."""

    def setUp(self):
        self.rf = RequestFactory()

    @override_settings(FRONTEND_BASE_URL="https://photos.example.com/")
    def test_prefers_configured_url_and_strips_trailing_slash(self):
        request = self.rf.get("/api/anything/", HTTP_HOST="backend")
        self.assertEqual(public_base_url(request), "https://photos.example.com")

    @override_settings(FRONTEND_BASE_URL="")
    def test_falls_back_to_request_origin_when_unconfigured(self):
        request = self.rf.get("/api/anything/", HTTP_HOST="localhost")
        self.assertEqual(public_base_url(request), "http://localhost")

    @override_settings(FRONTEND_BASE_URL="")
    def test_no_request_and_no_config_yields_empty(self):
        self.assertEqual(public_base_url(None), "")

    def test_internal_detection(self):
        self.assertTrue(is_internal_base_url(""))
        self.assertTrue(is_internal_base_url("http://backend"))
        self.assertTrue(is_internal_base_url("http://backend:8001/api"))
        # localhost is a legitimate public origin for a single-machine install.
        self.assertFalse(is_internal_base_url("http://localhost:3000"))
        self.assertFalse(is_internal_base_url("https://photos.example.com"))


class CallbackUrlTest(TestCase):
    """The redirect_uri must be browser-reachable and independent of the Host."""

    @override_settings(FRONTEND_BASE_URL="https://photos.example.com")
    def test_callback_url_uses_configured_origin_not_request_host(self):
        request = RequestFactory().get(CALLBACK_PATH, HTTP_HOST="backend")
        adapter = LibrePhotosOIDCAdapter(request, "keycloak")

        url = adapter.get_callback_url(request, app=None)

        self.assertEqual(url, f"https://photos.example.com{CALLBACK_PATH}")
        self.assertNotIn("backend", url)

    def test_the_provider_actually_uses_our_adapter(self):
        """The whole login redirect hangs off this being installed.

        ``OAuth2Provider.redirect()`` builds its own adapter from
        ``oauth2_adapter_class`` rather than using the one the view holds, so if
        ApiConfig.ready() stopped setting it, the login redirect would silently go
        back to allauth's unreachable http://backend/... callback while the token
        exchange kept using ours.
        """
        from allauth.socialaccount.providers.openid_connect.provider import (
            OpenIDConnectProvider,
        )

        self.assertIs(
            OpenIDConnectProvider.oauth2_adapter_class, LibrePhotosOIDCAdapter
        )

    @override_config(OIDC_ENABLED=True)
    @override_settings(FRONTEND_BASE_URL="")
    def test_login_refuses_when_public_url_is_unknown(self):
        """Better a named error than an opaque failure at the provider."""
        # HTTP_HOST=backend reproduces what the proxy actually sends.
        resp = self.client.get(
            "/api/accounts/oidc/keycloak/login/", HTTP_HOST="backend"
        )

        self.assertEqual(resp.status_code, 302)
        self.assertEqual(resp["Location"], "/login?sso_error=public_url_not_configured")


class OidcKillSwitchTest(TestCase):
    """OIDC_ENABLED has to disable the flow, not just hide the button."""

    def setUp(self):
        _make_social_app()

    @override_config(OIDC_ENABLED=False)
    @override_settings(FRONTEND_BASE_URL="https://photos.example.com")
    def test_login_endpoint_is_gone_when_disabled(self):
        resp = self.client.get("/api/accounts/oidc/keycloak/login/")
        self.assertEqual(resp.status_code, 404)

    @override_config(OIDC_ENABLED=False)
    def test_callback_endpoint_is_gone_when_disabled(self):
        resp = self.client.get(CALLBACK_PATH, {"code": "x", "state": "y"})
        self.assertEqual(resp.status_code, 404)

    @override_config(OIDC_ENABLED=True)
    @override_settings(FRONTEND_BASE_URL="https://photos.example.com")
    def test_unknown_provider_is_a_404_not_a_crash(self):
        resp = self.client.get("/api/accounts/oidc/nosuchprovider/login/")
        self.assertEqual(resp.status_code, 404)


class SSOConfigViewTest(TestCase):
    """What the login screen is told, and that it can ask without a token."""

    def setUp(self):
        self.client = APIClient()

    @override_config(OIDC_ENABLED=False)
    def test_disabled_when_flag_off(self):
        _make_social_app()
        resp = self.client.get(CONFIG_URL)
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.json()["enabled"])

    @override_config(OIDC_ENABLED=True)
    def test_not_enabled_without_a_configured_provider(self):
        resp = self.client.get(CONFIG_URL)
        self.assertFalse(resp.json()["enabled"])
        self.assertEqual(resp.json()["providers"], [])

    @override_config(OIDC_ENABLED=True, OIDC_BUTTON_LABEL="Sign in with Keycloak")
    def test_lists_provider_when_enabled(self):
        _make_social_app()

        body = self.client.get(CONFIG_URL).json()

        self.assertTrue(body["enabled"])
        self.assertEqual(body["label"], "Sign in with Keycloak")
        self.assertEqual(
            body["providers"],
            [
                {
                    "id": "keycloak",
                    "name": "Keycloak",
                    "login_url": "/api/accounts/oidc/keycloak/login/",
                }
            ],
        )

    @override_config(OIDC_ENABLED=True)
    def test_reveals_no_secrets(self):
        _make_social_app()
        self.assertNotIn("s3cret", self.client.get(CONFIG_URL).content.decode())


class JWTBridgeTest(TestCase):
    """sso_finish is what makes an external login a LibrePhotos credential."""

    def setUp(self):
        self.user = User.objects.create(username="ssouser", email="sso@example.com")

    def test_unauthenticated_request_mints_nothing(self):
        resp = self.client.get(FINISH_URL)

        self.assertEqual(resp.status_code, 302)
        self.assertEqual(resp["Location"], "/login?sso_error=not_authenticated")
        self.assertNotIn("access", resp.cookies)
        self.assertNotIn("jwt", resp.cookies)

    def test_authenticated_request_sets_usable_tokens(self):
        self.client.force_login(self.user)

        resp = self.client.get(FINISH_URL)

        self.assertEqual(resp.status_code, 302)
        self.assertEqual(resp["Location"], "/")
        for name in ("access", "refresh", "jwt"):
            self.assertIn(name, resp.cookies, f"{name} cookie not set")

        access = resp.cookies["access"].value
        self.assertEqual(int(AccessToken(access)["user_id"]), self.user.pk)
        # The SPA reads `jwt` and `access` interchangeably; keep them in step.
        self.assertEqual(resp.cookies["jwt"].value, access)

    def test_the_allauth_session_does_not_outlive_the_handoff(self):
        """Otherwise every SSO login leaves a second, session-based auth path."""
        self.client.force_login(self.user)

        resp = self.client.get(FINISH_URL)

        self.assertNotIn("_auth_user_id", self.client.session)
        # Django signals the drop by expiring the cookie.
        self.assertEqual(resp.cookies["sessionid"].value, "")

    def test_minted_token_carries_no_privilege_it_should_not(self):
        self.client.force_login(self.user)

        access = self.client.get(FINISH_URL).cookies["access"].value

        self.assertFalse(AccessToken(access).get("is_admin", False))


class AdapterLinkingPolicyTest(TestCase):
    """Who an SSO login is allowed to become."""

    def setUp(self):
        _make_social_app()
        self.adapter = SSOSocialAccountAdapter()
        self.request = _request()

    def _run(self, sociallogin):
        """Return the error reason the adapter bounced with, or None if allowed."""
        try:
            self.adapter.pre_social_login(self.request, sociallogin)
        except ImmediateHttpResponse as exc:
            location = exc.response["Location"]
            return location.split("sso_error=")[-1]
        return None

    def test_verified_email_links_to_the_matching_account(self):
        user = User.objects.create(username="alice", email="sso@example.com")
        sociallogin = _make_social_login(email="sso@example.com", verified=True)

        self.assertIsNone(self._run(sociallogin))
        self.assertEqual(sociallogin.user.pk, user.pk)

    def test_unverified_email_cannot_claim_an_existing_account(self):
        """The account-takeover guard: anyone can register an address at some IdP."""
        User.objects.create(username="alice", email="sso@example.com")
        sociallogin = _make_social_login(email="sso@example.com", verified=False)

        self.assertEqual(self._run(sociallogin), "email_not_verified")

    def test_email_match_is_case_insensitive(self):
        user = User.objects.create(username="alice", email="Alice@Example.com")
        sociallogin = _make_social_login(email="alice@example.com", verified=True)

        self.assertIsNone(self._run(sociallogin))
        self.assertEqual(sociallogin.user.pk, user.pk)

    @override_config(OIDC_ALLOW_SIGNUP=False)
    def test_unknown_email_is_refused_when_signup_is_off(self):
        sociallogin = _make_social_login(email="nobody@example.com", verified=True)

        self.assertEqual(self._run(sociallogin), "signup_disabled")

    def test_ambiguous_email_never_links(self):
        """Two accounts share the address: linking either one is a guess."""
        User.objects.create(username="alice", email="shared@example.com")
        User.objects.create(username="bob", email="shared@example.com")
        sociallogin = _make_social_login(email="shared@example.com", verified=True)

        self.assertEqual(self._run(sociallogin), "signup_disabled")

    def test_blank_idp_email_never_links(self):
        """Many LibrePhotos accounts have no email; none of them is a match."""
        User.objects.create(username="alice", email="")
        sociallogin = _make_social_login(email="", verified=True)

        self.assertEqual(self._run(sociallogin), "signup_disabled")

    def test_already_linked_account_skips_the_policy(self):
        user = User.objects.create(username="alice", email="sso@example.com")
        SocialAccount.objects.create(user=user, provider="keycloak", uid="idp-sub-1")
        sociallogin = _make_social_login(email="other@example.com", verified=False)
        sociallogin.user = user
        sociallogin.account = SocialAccount.objects.get(uid="idp-sub-1")

        self.assertIsNone(self._run(sociallogin))


class AdapterProvisioningTest(TestCase):
    """Provisioning needs both the admin's say-so and a meaningful email claim."""

    def setUp(self):
        self.adapter = SSOSocialAccountAdapter()
        self.request = _request()

    @override_config(OIDC_ALLOW_SIGNUP=True)
    def test_signup_stays_closed_while_email_is_unconfigured(self):
        """Without email configured a "verified" claim cannot be trusted."""
        self.assertFalse(self.adapter.is_open_for_signup(self.request, None))

    @override_config(OIDC_ALLOW_SIGNUP=False)
    def test_signup_stays_closed_when_the_admin_has_not_opted_in(self):
        with self.settings(EMAIL_HOST="smtp.example.com"):
            self.assertFalse(self.adapter.is_open_for_signup(self.request, None))

    def test_provisioned_user_is_never_privileged(self):
        """Notably also during first-time setup, when no superuser exists yet."""
        self.assertFalse(User.objects.filter(is_superuser=True).exists())
        sociallogin = _make_social_login(email="new@example.com", verified=True)
        sociallogin.user = User(username="newcomer", email="new@example.com")
        sociallogin.user.is_superuser = True
        sociallogin.user.is_staff = True

        user = self.adapter.save_user(self.request, sociallogin)

        self.assertFalse(user.is_superuser)
        self.assertFalse(user.is_staff)
        user.refresh_from_db()
        self.assertFalse(user.is_superuser)
        self.assertFalse(user.is_staff)


class AllauthSurfaceTest(TestCase):
    """allauth is here to broker OIDC, not to add a second way to log in."""

    def test_allauth_local_auth_routes_are_not_exposed(self):
        for path in (
            "/api/accounts/signup/",
            "/api/accounts/password/reset/",
            "/api/accounts/password/change/",
            "/api/accounts/email/",
        ):
            with self.subTest(path=path):
                self.assertEqual(self.client.get(path).status_code, 404)

    def test_the_remaining_login_view_cannot_authenticate(self):
        resp = self.client.post(
            "/api/accounts/login/", {"login": "alice", "password": "hunter2"}
        )
        self.assertEqual(resp.status_code, 403)
