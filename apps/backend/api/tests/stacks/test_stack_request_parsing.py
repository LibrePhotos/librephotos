"""The stack views read their input through serializers (#2326)."""

from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from api.models.photo_stack import PhotoStack
from api.tests.utils import create_test_photo, create_test_stack, create_test_user


def error_fields(response) -> list[str]:
    return [error["field"] for error in response.json()["errors"]]


class StackRequestTestCase(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.photos = [create_test_photo(owner=self.user) for _ in range(3)]
        self.stack = create_test_stack(
            owner=self.user, stack_type=PhotoStack.StackType.MANUAL
        )
        for photo in self.photos[:2]:
            photo.stacks.add(self.stack)


class ManualStackBodyTest(StackRequestTestCase):
    def test_photo_hashes_that_are_not_a_list_of_strings_are_a_400(self):
        for value in (5, "abcdef", {"a": 1}, [1, 2], None):
            with self.subTest(value=value):
                response = self.client.post(
                    "/api/stacks/manual/", {"photo_hashes": value}, format="json"
                )
                self.assertEqual(response.status_code, 400)
                self.assertEqual(error_fields(response), ["photo_hashes"])

    def test_missing_hashes_still_ask_for_two_photos(self):
        response = self.client.post("/api/stacks/manual/", {}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            response.json()["errors"][0]["message"],
            "At least 2 unique photos required to create a stack",
        )

    def test_add_and_remove_need_hashes(self):
        for action in ("add", "remove"):
            for body in ({}, {"photo_hashes": []}, {"photo_hashes": "x"}):
                with self.subTest(action=action, body=body):
                    response = self.client.post(
                        f"/api/stacks/{self.stack.id}/{action}/", body, format="json"
                    )
                    self.assertEqual(response.status_code, 400)
                    self.assertEqual(error_fields(response), ["photo_hashes"])

    def test_adding_a_photo(self):
        response = self.client.post(
            f"/api/stacks/{self.stack.id}/add/",
            {"photo_hashes": [self.photos[2].image_hash]},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["added_count"], 1)

    def test_set_primary_needs_a_hash(self):
        response = self.client.post(
            f"/api/stacks/{self.stack.id}/primary/", {}, format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(error_fields(response), ["photo_hash"])


@patch("api.views.stacks.async_task")
class DetectStacksBodyTest(StackRequestTestCase):
    def test_detect_bursts_defaults_to_true(self, async_task):
        response = self.client.post("/api/stacks/detect/", {}, format="json")
        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.json()["options"], {"detect_bursts": True})
        self.assertEqual(async_task.call_args.args[2], {"detect_bursts": True})

    def test_detect_bursts_is_a_boolean(self, async_task):
        response = self.client.post(
            "/api/stacks/detect/", {"detect_bursts": "false"}, format="json"
        )
        self.assertEqual(response.json()["options"], {"detect_bursts": False})
        response = self.client.post(
            "/api/stacks/detect/", {"detect_bursts": "sometimes"}, format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(error_fields(response), ["detect_bursts"])


class StackListQueryTest(StackRequestTestCase):
    def test_defaults_and_clamps(self):
        data = self.client.get("/api/stacks/").json()
        self.assertEqual((data["page"], data["page_size"]), (1, 20))
        data = self.client.get("/api/stacks/?page=-1&page_size=500").json()
        self.assertEqual((data["page"], data["page_size"]), (1, 100))

    def test_an_unknown_stack_type_is_ignored(self):
        data = self.client.get("/api/stacks/?stack_type=raw_jpeg").json()
        self.assertEqual(data["count"], 1)
        data = self.client.get("/api/stacks/?stack_type=burst").json()
        self.assertEqual(data["count"], 0)
