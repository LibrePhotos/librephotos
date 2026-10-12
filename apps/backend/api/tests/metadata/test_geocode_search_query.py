"""GET /api/geocode/search reads its query through a serializer (#2326)."""

from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from api.tests.utils import create_test_user


@patch("api.views.geocode.search_location", return_value=[{"name": "Berlin"}])
class GeocodeSearchQueryTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(user=create_test_user())

    def test_the_query_is_trimmed_and_the_limit_defaults_to_five(self, search):
        response = self.client.get("/api/geocode/search", {"q": "  Berlin "})
        self.assertEqual(response.json(), [{"name": "Berlin"}])
        search.assert_called_once_with("Berlin", limit=5)

    def test_a_blank_query_asks_no_provider(self, search):
        for query in ({}, {"q": ""}, {"q": "   "}):
            with self.subTest(query=query):
                self.assertEqual(
                    self.client.get("/api/geocode/search", query).json(), []
                )
        search.assert_not_called()

    def test_the_limit_is_passed_on_and_bounded(self, search):
        for sent, used in (("3", 3), ("0", 1), ("1000", 50)):
            with self.subTest(sent=sent):
                self.client.get("/api/geocode/search", {"q": "x", "limit": sent})
                self.assertEqual(search.call_args.kwargs["limit"], used)

    def test_a_malformed_limit_is_a_400(self, search):
        response = self.client.get("/api/geocode/search", {"q": "x", "limit": "x"})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["errors"][0]["field"], "limit")
        search.assert_not_called()
