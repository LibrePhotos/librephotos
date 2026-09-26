"""``/api/searchtermexamples/`` must never serve one user's examples to another.

The view used to be wrapped in ``cache_page`` + ``vary_on_cookie``. DRF
authenticates from the ``Authorization`` header, which ``vary_on_cookie`` knows
nothing about, so two header-authenticated clients (the mobile app, scripts)
shared one cache entry - the first caller's examples, built from their photos,
people and places, were handed to everyone else for two hours.
"""

from unittest.mock import patch

from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from api.tests.utils import create_test_user


def _examples_for(user):
    return [f"examples of {user.username}"]


@patch("api.views.search.get_search_term_examples", side_effect=_examples_for)
class SearchTermExamplesPerUserCacheTest(TestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        self.alice = create_test_user()
        self.bob = create_test_user()

    def _get_with_header(self, user):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {AccessToken.for_user(user)}")
        response = client.get("/api/searchtermexamples/")
        self.assertEqual(200, response.status_code)
        return response.json()["results"]

    def test_header_auth_users_get_their_own_examples(self, _examples):
        self.assertEqual(_examples_for(self.alice), self._get_with_header(self.alice))
        self.assertEqual(_examples_for(self.bob), self._get_with_header(self.bob))

    def test_repeat_requests_are_still_cached_per_user(self, examples):
        self._get_with_header(self.alice)
        self._get_with_header(self.alice)
        self.assertEqual(1, examples.call_count)

    def test_anonymous_request_is_rejected(self, examples):
        self.assertEqual(401, APIClient().get("/api/searchtermexamples/").status_code)
        examples.assert_not_called()
