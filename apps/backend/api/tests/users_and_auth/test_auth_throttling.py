"""The endpoints that take credentials without a session are throttled (#2329).

The bundled proxy appends the client address to X-Forwarded-For and the
backend trusts one proxy (NUM_PROXIES=1), so each client has its own counter
instead of all of them sharing the proxy's address. Sign-in also keys on the
username, so a flood against one account does not lock out the others.

Each test sets a rate of 3 a minute and starts from an empty cache.
"""

from pathlib import Path
from unittest.mock import patch

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import SimpleTestCase, TestCase, override_settings
from rest_framework.test import APIClient
from rest_framework.throttling import SimpleRateThrottle

from api.tests.utils import create_test_user

User = get_user_model()

OBTAIN_URL = "/api/auth/token/obtain/"
REFRESH_URL = "/api/auth/token/refresh/"
RESET_CONFIRM_URL = "/api/auth/password/reset/confirm/"
SIGNUP_URL = "/api/user/"

# The address every request arrives from: the bundled proxy container.
PROXY = "172.18.0.5"
CLIENT_A = "203.0.113.7"
CLIENT_B = "198.51.100.9"

# settings.BASE_DIR is apps/backend/librephotos.
REPO_ROOT = Path(settings.BASE_DIR).parents[2]
NGINX_CONF = REPO_ROOT / "deploy" / "docker" / "proxy" / "nginx.conf"


def via_proxy(client_address: str, sent: str | None = None) -> dict[str, str]:
    """The request headers the bundled proxy hands the backend.

    ``$proxy_add_x_forwarded_for`` appends the peer address to whatever the
    client sent itself.
    """
    forwarded = f"{sent}, {client_address}" if sent else client_address
    return {"REMOTE_ADDR": PROXY, "HTTP_X_FORWARDED_FOR": forwarded}


# The bundled proxy's setting, whatever NUM_PROXIES the shell running the
# suite has (librephotos/settings/production.py defaults to 1).
@override_settings(REST_FRAMEWORK={**settings.REST_FRAMEWORK, "NUM_PROXIES": 1})
class ThrottleTestCase(TestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        rates = patch.dict(
            SimpleRateThrottle.THROTTLE_RATES,
            {"auth": "3/minute", "token_refresh": "3/minute"},
        )
        rates.start()
        self.addCleanup(rates.stop)
        self.client = APIClient()

    def sign_in(self, username: str, password: str = "wrong", **headers: str) -> int:
        response = self.client.post(
            OBTAIN_URL, {"username": username, "password": password}, **headers
        )
        return response.status_code


class SignInThrottleTest(ThrottleTestCase):
    def setUp(self):
        super().setUp()
        self.user = User.objects.create_user(username="alice", password="secret-pw-1")
        User.objects.create_user(username="bob", password="secret-pw-2")

    def test_attempts_beyond_the_rate_answer_429(self):
        headers = via_proxy(CLIENT_A)
        statuses = [self.sign_in("alice", **headers) for _ in range(4)]
        self.assertEqual(statuses, [401, 401, 401, 429])

        response = self.client.post(
            OBTAIN_URL, {"username": "alice", "password": "secret-pw-1"}, **headers
        )
        self.assertEqual(response.status_code, 429)
        self.assertIn("Retry-After", response)

    def test_two_clients_behind_the_proxy_have_separate_counters(self):
        for _ in range(4):
            self.sign_in("alice", **via_proxy(CLIENT_A))
        self.assertEqual(self.sign_in("alice", **via_proxy(CLIENT_A)), 429)

        response = self.client.post(
            OBTAIN_URL,
            {"username": "alice", "password": "secret-pw-1"},
            **via_proxy(CLIENT_B),
        )
        self.assertEqual(response.status_code, 200)

    def test_a_forged_forwarded_header_does_not_buy_a_fresh_counter(self):
        statuses = [
            self.sign_in("alice", **via_proxy(CLIENT_A, sent=f"10.0.0.{n}"))
            for n in range(4)
        ]
        self.assertEqual(statuses, [401, 401, 401, 429])

    def test_without_a_forwarded_address_each_account_keeps_its_own_counter(self):
        # A proxy in front that does not pass the client address on: everyone
        # shares one address, but flooding alice does not lock out bob.
        shared = {"REMOTE_ADDR": PROXY}
        for _ in range(4):
            self.sign_in("alice", **shared)
        self.assertEqual(self.sign_in("alice", **shared), 429)
        self.assertEqual(self.sign_in("bob", **shared), 401)

    def test_case_variants_of_a_username_share_a_counter(self):
        headers = via_proxy(CLIENT_A)
        statuses = [
            self.sign_in(name, **headers) for name in ("alice", "Alice", "ALICE ")
        ]
        self.assertEqual(statuses, [401, 401, 401])
        self.assertEqual(self.sign_in("aLiCe", **headers), 429)


class OtherAuthEndpointThrottleTest(ThrottleTestCase):
    def test_token_refresh_is_throttled(self):
        statuses = [
            self.client.post(
                REFRESH_URL, {"refresh": "not-a-token"}, **via_proxy(CLIENT_A)
            ).status_code
            for _ in range(4)
        ]
        self.assertEqual(statuses, [401, 401, 401, 429])
        self.assertEqual(
            self.client.post(
                REFRESH_URL, {"refresh": "not-a-token"}, **via_proxy(CLIENT_B)
            ).status_code,
            401,
        )

    def test_password_reset_confirm_is_throttled(self):
        body = {"uid": "x", "token": "y", "new_password": "Another-pw-123"}
        statuses = [
            self.client.post(
                RESET_CONFIRM_URL, body, format="json", **via_proxy(CLIENT_A)
            ).status_code
            for _ in range(4)
        ]
        self.assertEqual(statuses, [400, 400, 400, 429])

    def test_anonymous_sign_up_is_throttled(self):
        # No superuser yet: first-time setup lets anonymous callers create one.
        statuses = [
            self.client.post(SIGNUP_URL, {}, **via_proxy(CLIENT_A)).status_code
            for _ in range(4)
        ]
        self.assertEqual(statuses, [400, 400, 400, 429])

    def test_an_admin_adding_users_is_not_throttled(self):
        self.client.force_authenticate(user=create_test_user(is_admin=True))
        statuses = {
            self.client.post(SIGNUP_URL, {}, **via_proxy(CLIENT_A)).status_code
            for _ in range(5)
        }
        self.assertEqual(statuses, {400})


class BundledProxyForwardsTheClientTest(SimpleTestCase):
    def test_the_api_location_appends_the_client_address(self):
        if not NGINX_CONF.is_file():
            self.skipTest("deploy/ is not present outside a source checkout")
        conf = NGINX_CONF.read_text(encoding="utf-8")
        api_location = conf.split("location ~ ^/(api|media)/ {", 1)[1].split("}", 1)[0]
        self.assertIn(
            "proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;",
            api_location,
        )
