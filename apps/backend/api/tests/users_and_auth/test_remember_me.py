""" "Remember me" on the login page (#2024).

A sign-in with ``remember_me`` gets a refresh token for ``REMEMBER_ME_DAYS``
with a ``remember_until`` claim, and a ``jwt`` cookie with a ``Max-Age`` that
runs out with it, on the sign-in and on every refresh. Without the flag, and
over SSO, the cookies stay session cookies and the refresh token lasts
``REFRESH_TOKEN_DAYS``. Logout clears a remembered session like any other.
"""

import time

from django.test import SimpleTestCase, override_settings
from rest_framework_simplejwt.token_blacklist.models import OutstandingToken
from rest_framework_simplejwt.tokens import AccessToken, RefreshToken

from api.accounts.tokens import REMEMBER_UNTIL_CLAIM, remembered_max_age
from api.tests.infra.test_auth_cookies import (
    FINISH_URL,
    LOGOUT_URL,
    OBTAIN_URL,
    PASSWORD,
    REFRESH_URL,
    AuthCookieTestCase,
)

DAY = 24 * 60 * 60
# Seconds a slow test run may take between minting a token and checking it.
SLACK = 120


class RememberMeTestCase(AuthCookieTestCase):
    def sign_in_remembered(self, **body: object) -> dict[str, str]:
        response = self.client.post(
            OBTAIN_URL,
            {
                "username": self.user.username,
                "password": PASSWORD,
                "remember_me": True,
                **body,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.last_response = response
        return response.json()

    def assertLastsAbout(self, seconds: object, expected: int) -> None:
        self.assertIsInstance(seconds, int)
        assert isinstance(seconds, int)
        self.assertLessEqual(seconds, expected)
        self.assertGreater(seconds, expected - SLACK)

    def assertSessionCookie(self, morsel_max_age: object) -> None:
        # Morsel keeps "" for an attribute the Set-Cookie header did not send.
        self.assertEqual(morsel_max_age, "")


class RememberedSignInTest(RememberMeTestCase):
    def test_the_refresh_token_lasts_remember_me_days(self):
        tokens = self.sign_in_remembered()

        refresh = RefreshToken(tokens["refresh"])
        self.assertLastsAbout(refresh["exp"] - int(time.time()), 30 * DAY)
        self.assertEqual(refresh[REMEMBER_UNTIL_CLAIM], refresh["exp"])

    def test_the_access_token_carries_the_claim(self):
        tokens = self.sign_in_remembered()

        access = AccessToken(tokens["access"])
        refresh = RefreshToken(tokens["refresh"])
        self.assertEqual(access[REMEMBER_UNTIL_CLAIM], refresh["exp"])
        # Still a 5 minute access token: only the session lasts longer.
        self.assertLessEqual(access["exp"] - int(time.time()), 5 * 60)
        # The user claims are there as on a plain sign-in.
        self.assertEqual(access["name"], self.user.username)

    def test_the_jwt_cookie_lasts_as_long_as_the_refresh_token(self):
        self.sign_in_remembered()

        jwt = self.last_response.cookies["jwt"]
        self.assertLastsAbout(jwt["max-age"], 30 * DAY)
        self.assertTrue(jwt["expires"])
        self.assertCookie(jwt, httponly=True)

    @override_settings(AUTH_COOKIE_SECURE=True)
    def test_the_cookie_keeps_the_secure_flag(self):
        self.sign_in_remembered()

        self.assertCookie(self.last_response.cookies["jwt"], httponly=True, secure=True)

    def test_the_blacklist_knows_the_real_expiry(self):
        tokens = self.sign_in_remembered()

        refresh = RefreshToken(tokens["refresh"])
        outstanding = OutstandingToken.objects.get(jti=refresh["jti"])
        assert outstanding.expires_at is not None
        self.assertEqual(int(outstanding.expires_at.timestamp()), refresh["exp"])

    @override_settings(REMEMBER_ME_DAYS=90)
    def test_the_lifetime_follows_the_setting(self):
        tokens = self.sign_in_remembered()

        refresh = RefreshToken(tokens["refresh"])
        self.assertLastsAbout(refresh["exp"] - int(time.time()), 90 * DAY)

    @override_settings(REMEMBER_ME_DAYS=0)
    def test_zero_days_ignores_the_flag(self):
        tokens = self.sign_in_remembered()

        refresh = RefreshToken(tokens["refresh"])
        self.assertNotIn(REMEMBER_UNTIL_CLAIM, refresh.payload)
        self.assertLastsAbout(refresh["exp"] - int(time.time()), 7 * DAY)
        self.assertSessionCookie(self.last_response.cookies["jwt"]["max-age"])

    def test_a_flag_that_is_not_a_boolean_is_a_400(self):
        response = self.client.post(
            OBTAIN_URL,
            {
                "username": self.user.username,
                "password": PASSWORD,
                "remember_me": "maybe",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(response.json()["errors"][0]["field"], "remember_me")

    def test_wrong_credentials_are_refused_with_the_flag(self):
        response = self.client.post(
            OBTAIN_URL,
            {"username": self.user.username, "password": "wrong", "remember_me": True},
            format="json",
        )

        self.assertEqual(response.status_code, 401, response.content)
        self.assertNotIn("jwt", response.cookies)


class PlainSignInTest(RememberMeTestCase):
    def test_without_the_flag_the_cookie_is_a_session_cookie(self):
        tokens = self.sign_in()

        self.assertSessionCookie(self.last_response.cookies["jwt"]["max-age"])
        refresh = RefreshToken(tokens["refresh"])
        self.assertNotIn(REMEMBER_UNTIL_CLAIM, refresh.payload)
        self.assertLastsAbout(refresh["exp"] - int(time.time()), 7 * DAY)

    def test_remember_me_false_is_a_plain_sign_in(self):
        tokens = self.sign_in_remembered(remember_me=False)

        self.assertSessionCookie(self.last_response.cookies["jwt"]["max-age"])
        self.assertNotIn(REMEMBER_UNTIL_CLAIM, RefreshToken(tokens["refresh"]).payload)

    def test_sso_keeps_session_cookies(self):
        self.client.force_login(self.user)

        response = self.client.get(FINISH_URL)

        self.assertEqual(response.status_code, 302)
        for name in ("jwt", "access", "refresh"):
            self.assertSessionCookie(response.cookies[name]["max-age"])


class RememberedRefreshTest(RememberMeTestCase):
    def test_a_refresh_keeps_the_cookie_lifetime(self):
        tokens = self.sign_in_remembered()
        remember_until = RefreshToken(tokens["refresh"])["exp"]

        response = self.client.post(
            REFRESH_URL, {"refresh": tokens["refresh"]}, format="json"
        )

        self.assertEqual(response.status_code, 200, response.content)
        access = AccessToken(response.json()["access"])
        self.assertEqual(access[REMEMBER_UNTIL_CLAIM], remember_until)
        jwt = response.cookies["jwt"]
        self.assertLastsAbout(jwt["max-age"], remember_until - int(time.time()))
        self.assertCookie(jwt, httponly=True)

    def test_a_plain_refresh_stays_a_session_cookie(self):
        tokens = self.sign_in()

        response = self.client.post(
            REFRESH_URL, {"refresh": tokens["refresh"]}, format="json"
        )

        self.assertEqual(response.status_code, 200, response.content)
        self.assertSessionCookie(response.cookies["jwt"]["max-age"])

    def test_logout_ends_a_remembered_session(self):
        tokens = self.sign_in_remembered()

        response = self.client.post(
            LOGOUT_URL, {"refresh": tokens["refresh"]}, format="json"
        )

        self.assertEqual(response.status_code, 200, response.content)
        for name, httponly in (("jwt", True), ("access", False), ("refresh", False)):
            self.assertCleared(response.cookies[name], httponly=httponly)
        refused = self.client.post(
            REFRESH_URL, {"refresh": tokens["refresh"]}, format="json"
        )
        self.assertEqual(refused.status_code, 401)


class PublicSettingsTest(RememberMeTestCase):
    def test_the_login_page_learns_the_day_count(self):
        response = self.client.get("/api/sitesettings/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["remember_me_days"], 30)

    @override_settings(REMEMBER_ME_DAYS=-3)
    def test_a_negative_setting_reads_as_off(self):
        response = self.client.get("/api/sitesettings/")

        self.assertEqual(response.json()["remember_me_days"], 0)


class RememberedMaxAgeTest(SimpleTestCase):
    def test_a_token_that_cannot_be_read_gives_session_cookies(self):
        self.assertIsNone(remembered_max_age("not a token"))

    def test_a_non_integer_claim_gives_session_cookies(self):
        access = AccessToken()
        access[REMEMBER_UNTIL_CLAIM] = "soon"

        self.assertIsNone(remembered_max_age(str(access)))

    def test_a_claim_in_the_past_gives_zero(self):
        access = AccessToken()
        access[REMEMBER_UNTIL_CLAIM] = int(time.time()) - 10

        self.assertEqual(remembered_max_age(str(access)), 0)
