"""Query strings of the smaller views, read through serializers (#2326)."""

from django.test import TestCase
from rest_framework.test import APIClient

from api.tests.utils import create_test_job, create_test_photos, create_test_user


class SyncPageSizeTest(TestCase):
    URL = "/api/sync/photos/"

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        create_test_photos(number_of_photos=3, owner=self.user)

    def test_page_size_is_used_and_clamped(self):
        for sent, rows in (("2", 2), ("0", 1), ("-4", 1), ("1000", 3), ("99999", 3)):
            with self.subTest(sent=sent):
                response = self.client.get(self.URL, {"page_size": sent})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(len(response.json()["items"]), rows)

    def test_a_blank_cursor_is_a_seed_pull(self):
        response = self.client.get(self.URL, {"cursor": ""})
        self.assertEqual(response.status_code, 200)
        self.assertIn("total", response.json())

    def test_a_non_numeric_page_size_is_a_400(self):
        response = self.client.get(self.URL, {"page_size": "lots"})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["errors"][0]["field"], "page_size")


class JobListMineTest(TestCase):
    URL = "/api/jobs/"

    def setUp(self):
        self.staff = create_test_user(is_admin=True)
        self.other = create_test_user()
        create_test_job(started_by=self.staff)
        create_test_job(started_by=self.other)
        self.client = APIClient()
        self.client.force_authenticate(user=self.staff)

    def count(self, query: dict[str, str]) -> int:
        response = self.client.get(self.URL, query)
        self.assertEqual(response.status_code, 200)
        return response.json()["count"]

    def test_staff_see_every_job_unless_they_ask_for_their_own(self):
        self.assertEqual(self.count({}), 2)
        self.assertEqual(self.count({"mine": "true"}), 1)
        self.assertEqual(self.count({"mine": "True"}), 1)
        # Only "true" narrows, as before; anything else is the full list.
        self.assertEqual(self.count({"mine": "1"}), 2)
        self.assertEqual(self.count({"mine": "false"}), 2)

    def test_a_user_sees_only_their_own_jobs_whatever_mine_says(self):
        self.client.force_authenticate(user=self.other)
        self.assertEqual(self.count({"mine": "false"}), 1)
