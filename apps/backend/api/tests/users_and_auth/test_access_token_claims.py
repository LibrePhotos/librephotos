"""The access token's payload, as the clients decode it (unverified, base64url).

The web app (``useAuth``, ``useCurrentUserSelfDetailsQuery``), the mobile app
(``userIdFromToken`` in ``stores/auth.ts``) and the e2e suite read the signed-in
user's id from the ``user_id`` claim and request ``/api/user/<user_id>/`` with
it. simplejwt writes that claim as a string since 5.5.0 (``"1"``, not ``1``);
servers on older releases sent a number, so clients accept both. These tests
pin what the current server sends, through every way a token is issued: the
password login, the refresh endpoint and the OIDC SSO bridge.
"""

import base64
import json

from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from api.models import User
from api.tests.utils import create_test_user
from api.views.sso import _mint_jwt_for

PASSWORD = "correct horse battery staple"


def claims_of(token: str) -> dict[str, object]:
    """The JWT payload, decoded the way the clients do: no signature check."""
    payload = token.split(".")[1]
    padded = payload + "=" * (-len(payload) % 4)
    claims = json.loads(base64.urlsafe_b64decode(padded))
    assert isinstance(claims, dict)
    return claims


class AccessTokenClaimsTest(TestCase):
    def setUp(self) -> None:
        # The token endpoints are throttled per client address.
        cache.clear()
        self.addCleanup(cache.clear)
        self.user = create_test_user(password=PASSWORD)
        self.client = APIClient()

    def obtain(self) -> dict[str, str]:
        response = self.client.post(
            "/api/auth/token/obtain/",
            {"username": self.user.username, "password": PASSWORD},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertIsInstance(body, dict)
        return body

    def assert_user_id_claim(self, access: str, user: User) -> None:
        claims = claims_of(access)
        self.assertIn("user_id", claims)
        # A string of the primary key's digits, as simplejwt >= 5.5 writes it.
        self.assertEqual(claims["user_id"], str(user.pk))

    def test_login_token_carries_the_user_id_as_a_string(self) -> None:
        self.assert_user_id_claim(self.obtain()["access"], self.user)

    def test_login_token_carries_the_profile_claims_the_web_app_reads(self) -> None:
        claims = claims_of(self.obtain()["access"])
        self.assertEqual(claims["token_type"], "access")
        self.assertIsInstance(claims["exp"], int)
        self.assertEqual(claims["name"], self.user.username)
        self.assertIs(claims["is_admin"], False)
        for key in (
            "first_name",
            "last_name",
            "scan_directory",
            "confidence",
            "semantic_search_topk",
        ):
            self.assertIn(key, claims)

    def test_refreshed_token_carries_the_user_id_as_a_string(self) -> None:
        refresh = self.obtain()["refresh"]
        response = self.client.post(
            "/api/auth/token/refresh/", {"refresh": refresh}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assert_user_id_claim(response.json()["access"], self.user)

    def test_sso_token_carries_the_user_id_as_a_string(self) -> None:
        access, _refresh = _mint_jwt_for(self.user)
        self.assert_user_id_claim(access, self.user)

    def test_the_claim_as_sent_addresses_the_user_endpoint(self) -> None:
        # What every client does with it: GET /api/user/<user_id>/ verbatim.
        access = self.obtain()["access"]
        response = self.client.get(
            f"/api/user/{claims_of(access)['user_id']}/",
            HTTP_AUTHORIZATION=f"Bearer {access}",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["id"], self.user.pk)
