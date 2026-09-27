"""``JWTCookieAuthentication``: a bearer header, else the ``jwt`` cookie.

The contract the media and upload views rely on:

* no credentials -> anonymous (None), never an error;
* a usable cookie -> that user;
* an unusable cookie (expired, garbage, a refresh token, a deleted or inactive
  user) -> anonymous, so public content keeps working with a stale cookie;
* a bearer header wins over the cookie, and a bad one fails loudly, exactly as
  simplejwt's own ``JWTAuthentication`` does on every other endpoint.
"""

import datetime

from django.test import TestCase, override_settings
from django.urls import path
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.test import APIClient, APIRequestFactory
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import AuthenticationFailed, InvalidToken
from rest_framework_simplejwt.tokens import AccessToken, RefreshToken

from api.authentication import JWT_COOKIE_NAME, JWTCookieAuthentication
from api.tests.utils import create_test_user

factory = APIRequestFactory()


def access_token(user, lifetime=None):
    token = AccessToken.for_user(user)
    if lifetime is not None:
        token.set_exp(lifetime=lifetime)
    return str(token)


def expired_token(user):
    return access_token(user, lifetime=datetime.timedelta(seconds=-30))


def make_request(cookie=None, header=None):
    extra = {"HTTP_AUTHORIZATION": header} if header is not None else {}
    request = factory.get("/anything/", **extra)
    if cookie is not None:
        request.COOKIES[JWT_COOKIE_NAME] = cookie
    return request


class CookieTest(TestCase):
    def setUp(self):
        self.auth = JWTCookieAuthentication()
        self.user = create_test_user()

    def test_the_cookie_is_named_jwt(self):
        # The name the token endpoints and the SSO bridge set.
        self.assertEqual(JWT_COOKIE_NAME, "jwt")

    def test_no_credentials_is_anonymous(self):
        self.assertIsNone(self.auth.authenticate(make_request()))

    def test_valid_cookie_authenticates_its_user(self):
        user, token = self.auth.authenticate(
            make_request(cookie=access_token(self.user))
        )
        self.assertEqual(user.pk, self.user.pk)
        self.assertEqual(int(token["user_id"]), self.user.pk)

    def test_expired_cookie_is_anonymous(self):
        self.assertIsNone(
            self.auth.authenticate(make_request(cookie=expired_token(self.user)))
        )

    def test_garbage_cookie_is_anonymous(self):
        self.assertIsNone(self.auth.authenticate(make_request(cookie="not-a-jwt")))

    def test_empty_cookie_is_anonymous(self):
        self.assertIsNone(self.auth.authenticate(make_request(cookie="")))

    def test_tampered_cookie_is_anonymous(self):
        head, _, signature = access_token(self.user).rpartition(".")
        tampered = f"{head}.{'A' * len(signature)}"
        self.assertIsNone(self.auth.authenticate(make_request(cookie=tampered)))

    def test_refresh_token_in_the_cookie_is_anonymous(self):
        refresh = str(RefreshToken.for_user(self.user))
        self.assertIsNone(self.auth.authenticate(make_request(cookie=refresh)))

    def test_cookie_for_a_deleted_user_is_anonymous(self):
        cookie = access_token(self.user)
        self.user.delete()
        self.assertIsNone(self.auth.authenticate(make_request(cookie=cookie)))

    def test_cookie_for_an_inactive_user_is_anonymous(self):
        self.user.is_active = False
        self.user.save()
        self.assertIsNone(
            self.auth.authenticate(make_request(cookie=access_token(self.user)))
        )


class HeaderTest(TestCase):
    def setUp(self):
        self.auth = JWTCookieAuthentication()
        self.user = create_test_user()
        self.other = create_test_user()

    def test_bearer_header_authenticates(self):
        user, _ = self.auth.authenticate(
            make_request(header=f"Bearer {access_token(self.user)}")
        )
        self.assertEqual(user.pk, self.user.pk)

    def test_bearer_scheme_is_case_insensitive(self):
        user, _ = self.auth.authenticate(
            make_request(header=f"bearer {access_token(self.user)}")
        )
        self.assertEqual(user.pk, self.user.pk)

    def test_header_wins_over_the_cookie(self):
        user, _ = self.auth.authenticate(
            make_request(
                header=f"Bearer {access_token(self.user)}",
                cookie=access_token(self.other),
            )
        )
        self.assertEqual(user.pk, self.user.pk)

    def test_expired_header_fails_even_with_a_valid_cookie(self):
        # The header is an explicit credential: a bad one is an error, not a
        # reason to fall back to whatever cookie the browser also sent.
        request = make_request(
            header=f"Bearer {expired_token(self.user)}",
            cookie=access_token(self.other),
        )
        with self.assertRaises(InvalidToken):
            self.auth.authenticate(request)

    def test_bearer_without_a_token_fails(self):
        with self.assertRaises(AuthenticationFailed):
            self.auth.authenticate(make_request(header="Bearer"))

    def test_non_bearer_header_falls_through_to_the_cookie(self):
        # Basic credentials are BasicAuthentication's business; this class
        # neither rejects them nor lets them hide a usable cookie.
        user, _ = self.auth.authenticate(
            make_request(header="Basic Zm9vOmJhcg==", cookie=access_token(self.user))
        )
        self.assertEqual(user.pk, self.user.pk)

    def test_non_bearer_header_without_a_cookie_is_anonymous(self):
        self.assertIsNone(self.auth.authenticate(make_request(header="Basic Zm9v")))


class StrictTest(TestCase):
    """``authenticate_strict``: for callers that report bad credentials."""

    def setUp(self):
        self.auth = JWTCookieAuthentication()
        self.user = create_test_user()

    def test_no_credentials_is_none(self):
        self.assertIsNone(self.auth.authenticate_strict(make_request()))

    def test_valid_cookie_authenticates(self):
        user, _ = self.auth.authenticate_strict(
            make_request(cookie=access_token(self.user))
        )
        self.assertEqual(user.pk, self.user.pk)

    def test_expired_cookie_raises_invalid_token(self):
        with self.assertRaises(InvalidToken):
            self.auth.authenticate_strict(make_request(cookie=expired_token(self.user)))

    def test_empty_cookie_raises_invalid_token(self):
        with self.assertRaises(InvalidToken):
            self.auth.authenticate_strict(make_request(cookie=""))

    def test_cookie_for_a_deleted_user_raises_authentication_failed(self):
        cookie = access_token(self.user)
        self.user.delete()
        with self.assertRaises(AuthenticationFailed) as ctx:
            self.auth.authenticate_strict(make_request(cookie=cookie))
        self.assertNotIsInstance(ctx.exception, InvalidToken)

    def test_header_wins_over_the_cookie(self):
        other = create_test_user()
        user, _ = self.auth.authenticate_strict(
            make_request(
                header=f"Bearer {access_token(self.user)}",
                cookie=access_token(other),
            )
        )
        self.assertEqual(user.pk, self.user.pk)


class WhoAmI(APIView):
    authentication_classes = (JWTCookieAuthentication,)
    permission_classes = (AllowAny,)

    def get(self, request):
        return Response({"user_id": request.user.pk})


urlpatterns = [path("whoami/", WhoAmI.as_view())]


@override_settings(ROOT_URLCONF=__name__)
class ThroughDRFTest(TestCase):
    """The class wired into a view, as the media views use it."""

    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user()

    def test_anonymous(self):
        response = self.client.get("/whoami/")
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json()["user_id"])

    def test_cookie(self):
        self.client.cookies[JWT_COOKIE_NAME] = access_token(self.user)
        response = self.client.get("/whoami/")
        self.assertEqual(response.json()["user_id"], self.user.pk)

    def test_expired_cookie_is_anonymous_not_401(self):
        self.client.cookies[JWT_COOKIE_NAME] = expired_token(self.user)
        response = self.client.get("/whoami/")
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json()["user_id"])

    def test_expired_header_is_401(self):
        response = self.client.get(
            "/whoami/", HTTP_AUTHORIZATION=f"Bearer {expired_token(self.user)}"
        )
        self.assertEqual(response.status_code, 401)
