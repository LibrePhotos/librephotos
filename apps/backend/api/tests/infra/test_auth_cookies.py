"""Auth cookies are set in one place, with explicit flags (#2332).

``api/auth_cookies.py`` is the only module that sets or deletes a cookie or
writes ``Access-Control-Allow-Credentials`` (django-cors-headers does that).
The token endpoints used to set ``jwt`` with Django's defaults (no HttpOnly,
no SameSite, no Secure) and hand-write the CORS header next to each.

The flag tests read the ``Set-Cookie`` headers of sign-in, refresh, the SSO
bridge and logout. The logout tests also pin what logout revokes: the refresh
token and the browser's cookies, not an access token already issued.
"""

import ast
import os
from collections.abc import Iterator
from http.cookies import Morsel

from django.core.cache import cache
from django.test import SimpleTestCase, TestCase, override_settings
from rest_framework.test import APIClient

from api.models import User
from api.tests.utils import create_test_photo, create_test_user

BACKEND = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
SOURCE_DIRS = ("api", "librephotos", "nextcloud")
SKIPPED_DIRS = ("tests", "migrations", "__pycache__")
HELPER = "api/auth_cookies.py"

COOKIE_METHODS = {"set_cookie", "delete_cookie"}
CORS_CREDENTIALS_HEADER = "access-control-allow-credentials"

OBTAIN_URL = "/api/auth/token/obtain/"
REFRESH_URL = "/api/auth/token/refresh/"
LOGOUT_URL = "/api/auth/token/blacklist/"
FINISH_URL = "/api/auth/sso/finish/"
PASSWORD = "correct horse battery staple"


def cookie_writes(source: str, filename: str) -> list[str]:
    """Calls of ``set_cookie``/``delete_cookie`` and CORS credential headers."""
    problems = []
    for node in ast.walk(ast.parse(source, filename)):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr in COOKIE_METHODS
        ):
            problems.append(f"{filename}:{node.lineno} calls {node.func.attr}()")
        if (
            isinstance(node, ast.Constant)
            and isinstance(node.value, str)
            and node.value.lower() == CORS_CREDENTIALS_HEADER
        ):
            problems.append(f"{filename}:{node.lineno} writes {node.value}")
    return problems


def _sources() -> Iterator[tuple[str, str]]:
    """(path relative to the backend in POSIX form, source) of every module."""
    for top in SOURCE_DIRS:
        for root, dirs, files in os.walk(os.path.join(BACKEND, top)):
            dirs[:] = [d for d in dirs if d not in SKIPPED_DIRS]
            for name in files:
                if name.endswith(".py"):
                    path = os.path.join(root, name)
                    with open(path, encoding="utf-8") as handle:
                        source = handle.read()
                    yield os.path.relpath(path, BACKEND).replace(os.sep, "/"), source


def cookie_writes_outside_the_helper() -> list[str]:
    return [
        problem
        for filename, source in _sources()
        if filename != HELPER
        for problem in cookie_writes(source, filename)
    ]


class CookieWritesGuardTest(SimpleTestCase):
    def test_only_the_helper_sets_or_deletes_cookies(self):
        problems = cookie_writes_outside_the_helper()
        self.assertEqual(
            problems,
            [],
            "Set and clear auth cookies with set_auth_cookies/clear_auth_cookies "
            "from api/auth_cookies.py; django-cors-headers writes the CORS "
            "headers.\n  " + "\n  ".join(problems),
        )

    def test_the_walk_reaches_the_helper(self):
        sources = dict(_sources())
        self.assertIn(HELPER, sources)
        self.assertNotEqual(cookie_writes(sources[HELPER], HELPER), [])

    def test_a_planted_set_cookie_is_caught(self):
        planted = 'def view(response):\n    response.set_cookie("x", "y")\n'
        self.assertEqual(
            cookie_writes(planted, "api/views/planted.py"),
            ["api/views/planted.py:2 calls set_cookie()"],
        )

    def test_a_planted_delete_cookie_and_cors_header_are_caught(self):
        planted = (
            "def view(response):\n"
            '    response.delete_cookie("jwt")\n'
            '    response["Access-Control-Allow-Credentials"] = "true"\n'
        )
        self.assertEqual(
            cookie_writes(planted, "librephotos/planted.py"),
            [
                "librephotos/planted.py:2 calls delete_cookie()",
                "librephotos/planted.py:3 writes Access-Control-Allow-Credentials",
            ],
        )


class AuthCookieTestCase(TestCase):
    def setUp(self):
        # The sign-in and refresh throttles count in the default cache.
        cache.clear()
        self.addCleanup(cache.clear)
        self.user = create_test_user()
        self.user.set_password(PASSWORD)
        self.user.save()
        self.client = APIClient()

    def sign_in(self, user: User | None = None, **extra: object) -> dict[str, str]:
        user = user or self.user
        response = self.client.post(
            OBTAIN_URL,
            {"username": user.username, "password": PASSWORD},
            format="json",
            **extra,
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.last_response = response
        return response.json()

    def assertCookie(
        self, morsel: Morsel[str], *, httponly: bool, secure: bool = False
    ) -> None:
        self.assertEqual(morsel["samesite"], "Lax", morsel.key)
        self.assertEqual(morsel["path"], "/", morsel.key)
        self.assertEqual(bool(morsel["httponly"]), httponly, morsel.key)
        self.assertEqual(bool(morsel["secure"]), secure, morsel.key)

    def assertCleared(self, morsel: Morsel[str], *, httponly: bool) -> None:
        self.assertEqual(morsel.value, "", morsel.key)
        self.assertEqual(morsel["max-age"], 0, morsel.key)
        self.assertCookie(morsel, httponly=httponly)


class SignInAndRefreshCookieTest(AuthCookieTestCase):
    def test_sign_in_sets_jwt_httponly_and_lax(self):
        tokens = self.sign_in()

        jwt = self.last_response.cookies["jwt"]
        self.assertEqual(jwt.value, tokens["access"])
        self.assertCookie(jwt, httponly=True)

    def test_sign_in_returns_access_and_refresh_in_the_body_only(self):
        self.sign_in()

        self.assertNotIn("access", self.last_response.cookies)
        self.assertNotIn("refresh", self.last_response.cookies)

    def test_refresh_sets_jwt_with_the_same_flags(self):
        tokens = self.sign_in()

        response = self.client.post(
            REFRESH_URL, {"refresh": tokens["refresh"]}, format="json"
        )

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.cookies["jwt"].value, response.json()["access"])
        self.assertCookie(response.cookies["jwt"], httponly=True)

    def test_secure_when_the_request_came_in_over_https(self):
        self.sign_in(secure=True)

        self.assertCookie(self.last_response.cookies["jwt"], httponly=True, secure=True)

    @override_settings(AUTH_COOKIE_SECURE=True)
    def test_secure_behind_a_tls_proxy_with_the_setting_on(self):
        self.sign_in()

        self.assertCookie(self.last_response.cookies["jwt"], httponly=True, secure=True)

    def test_cors_credentials_come_from_django_cors_headers(self):
        """The split-origin dev setup (web on localhost:3000) still gets them."""
        self.sign_in(HTTP_ORIGIN="http://localhost:3000")
        self.assertEqual(self.last_response["Access-Control-Allow-Credentials"], "true")
        self.assertEqual(
            self.last_response["Access-Control-Allow-Origin"], "http://localhost:3000"
        )

        cache.clear()
        self.sign_in(HTTP_ORIGIN="https://evil.example")
        self.assertNotIn("Access-Control-Allow-Credentials", self.last_response)


class SSOBridgeCookieTest(AuthCookieTestCase):
    def test_sso_finish_sets_jwt_httponly_and_the_web_cookies_readable(self):
        self.client.force_login(self.user)

        response = self.client.get(FINISH_URL)

        self.assertEqual(response.status_code, 302)
        self.assertCookie(response.cookies["jwt"], httponly=True)
        # The web boots from these two and sends them as bearer tokens.
        self.assertCookie(response.cookies["access"], httponly=False)
        self.assertCookie(response.cookies["refresh"], httponly=False)
        self.assertNotIn("Access-Control-Allow-Credentials", response)

    @override_settings(AUTH_COOKIE_SECURE=True)
    def test_sso_finish_cookies_are_secure_with_the_setting_on(self):
        self.client.force_login(self.user)

        response = self.client.get(FINISH_URL)

        for name, httponly in (("jwt", True), ("access", False), ("refresh", False)):
            self.assertCookie(response.cookies[name], httponly=httponly, secure=True)


class LogoutCookieTest(AuthCookieTestCase):
    def logout(self, body: dict[str, str]) -> object:
        response = self.client.post(LOGOUT_URL, body, format="json")
        for name, httponly in (("jwt", True), ("access", False), ("refresh", False)):
            self.assertCleared(response.cookies[name], httponly=httponly)
        return response

    def test_logout_blacklists_the_refresh_token_and_clears_the_cookies(self):
        tokens = self.sign_in()

        response = self.client.post(
            LOGOUT_URL, {"refresh": tokens["refresh"]}, format="json"
        )

        self.assertEqual(response.status_code, 200, response.content)
        self.assertCleared(response.cookies["jwt"], httponly=True)
        refused = self.client.post(
            REFRESH_URL, {"refresh": tokens["refresh"]}, format="json"
        )
        self.assertEqual(refused.status_code, 401)

    def test_logout_clears_the_cookies_when_the_token_is_already_blacklisted(self):
        tokens = self.sign_in()
        self.logout({"refresh": tokens["refresh"]})

        response = self.client.post(
            LOGOUT_URL, {"refresh": tokens["refresh"]}, format="json"
        )

        self.assertEqual(response.status_code, 401)
        self.assertCleared(response.cookies["jwt"], httponly=True)

    def test_logout_clears_the_cookies_without_a_refresh_token(self):
        self.sign_in()

        response = self.client.post(LOGOUT_URL, {}, format="json")

        self.assertEqual(response.status_code, 400)
        self.assertCleared(response.cookies["jwt"], httponly=True)

    def test_media_loads_after_sign_in_and_stops_after_logout(self):
        photo = create_test_photo(owner=self.user)
        url = f"/media/thumbnails_big/{photo.image_hash}"
        tokens = self.sign_in()

        # The client keeps the jwt cookie, as a browser does for an <img>.
        self.assertEqual(self.client.get(url).status_code, 200)

        self.logout({"refresh": tokens["refresh"]})

        response = self.client.get(url)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response["X-Media-Error"], "authentication")

    def test_logout_does_not_revoke_an_access_token_already_issued(self):
        """simplejwt cannot blacklist access tokens: a copy of the cookie stays
        valid until ACCESS_TOKEN_LIFETIME runs out. Documented on the API
        authentication docs page; this pins it so a change updates both."""
        photo = create_test_photo(owner=self.user)
        url = f"/media/thumbnails_big/{photo.image_hash}"
        tokens = self.sign_in()
        self.logout({"refresh": tokens["refresh"]})

        copy = APIClient()
        copy.cookies["jwt"] = tokens["access"]

        self.assertEqual(copy.get(url).status_code, 200)
