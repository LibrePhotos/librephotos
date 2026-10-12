"""The one pagination style of the list endpoints (``api/pagination.py``, #2327)."""

from django.test import TestCase
from rest_framework.test import APIClient

from api.pagination import PhotoGridPagination, WholeListPagination
from api.tests.utils import create_test_job, create_test_tag, create_test_user


class DefaultPaginationTest(TestCase):
    """Through /api/jobs/, which pages with DefaultPagination itself."""

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        for _ in range(5):
            create_test_job(started_by=self.user)

    def get(self, query: str = ""):
        return self.client.get(f"/api/jobs/{query}")

    def test_the_envelope(self):
        data = self.get("?page_size=2&page=2").json()

        self.assertEqual(
            list(data),
            ["count", "next", "previous", "results", "page", "page_size", "num_pages"],
        )
        self.assertEqual(
            (data["count"], data["page"], data["page_size"], data["num_pages"]),
            (5, 2, 2, 3),
        )
        self.assertEqual(len(data["results"]), 2)
        self.assertIn("page=3", data["next"])
        self.assertIn("page_size=2", data["next"])
        self.assertNotIn("page=", data["previous"].replace("page_size=", ""))

    def test_the_default_page_size_is_100(self):
        data = self.get().json()
        self.assertEqual((data["page_size"], data["num_pages"]), (100, 1))
        self.assertIsNone(data["next"])

    def test_page_and_page_size_are_clamped(self):
        data = self.get("?page=0&page_size=5000").json()
        self.assertEqual((data["page"], data["page_size"]), (1, 1000))
        data = self.get("?page=-2&page_size=0").json()
        self.assertEqual((data["page"], data["page_size"]), (1, 1))

    def test_blank_values_are_the_defaults(self):
        data = self.get("?page=&page_size=").json()
        self.assertEqual((data["page"], data["page_size"]), (1, 100))

    def test_a_value_that_is_not_a_number_is_a_400_naming_it(self):
        for query, field in (("?page=x", "page"), ("?page_size=1.5", "page_size")):
            with self.subTest(query=query):
                response = self.get(query)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json()["errors"][0]["field"], field)

    def test_a_page_past_the_end_is_a_404(self):
        self.assertEqual(self.get("?page=4&page_size=2").status_code, 404)

    def test_last_is_the_last_page(self):
        data = self.get("?page=last&page_size=2").json()
        self.assertEqual(data["page"], 3)
        self.assertEqual(len(data["results"]), 1)


class PresetTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_presets_keep_the_page_sizes_clients_read_whole(self):
        self.assertEqual(WholeListPagination.page_size, 1000)
        self.assertEqual(WholeListPagination.max_page_size, 1000)
        self.assertEqual(PhotoGridPagination.page_size, 2500)
        self.assertEqual(PhotoGridPagination.max_page_size, 2500)

    def test_a_whole_list_answers_1000_a_page_and_still_pages(self):
        for _ in range(3):
            create_test_tag(owner=self.user)

        data = self.client.get("/api/tags/").json()
        self.assertEqual((data["count"], data["page_size"]), (3, 1000))

        data = self.client.get("/api/tags/?page_size=2").json()
        self.assertEqual(len(data["results"]), 2)
        self.assertIn("page=2", data["next"])

    def test_the_user_list_pages_by_number_now(self):
        """It was the 20000-row limit/offset default; old ?limit is ignored."""
        create_test_user()

        data = self.client.get("/api/user/?limit=1").json()
        self.assertEqual((data["count"], data["page_size"]), (2, 1000))
        self.assertEqual(len(data["results"]), 2)

        data = self.client.get("/api/user/?page_size=1").json()
        self.assertEqual(len(data["results"]), 1)
        self.assertIn("page=2", data["next"])
