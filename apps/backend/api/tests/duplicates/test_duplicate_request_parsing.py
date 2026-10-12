"""The duplicate views read their input through serializers (#2326).

Well-formed input behaves as it did when the views parsed it by hand (defaults,
clamps, the echoed page); malformed input is a 400 naming the field instead of
a 500 from ``int()``.
"""

from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from api.models.duplicate import Duplicate
from api.tests.utils import create_test_duplicate, create_test_photo, create_test_user


def error_fields(response) -> list[str]:
    return [error["field"] for error in response.json()["errors"]]


class DuplicateListQueryTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        for duplicate_type in (
            Duplicate.DuplicateType.EXACT_COPY,
            Duplicate.DuplicateType.EXACT_COPY,
            Duplicate.DuplicateType.VISUAL_DUPLICATE,
        ):
            duplicate = create_test_duplicate(
                owner=self.user, duplicate_type=duplicate_type
            )
            duplicate.photos.add(
                create_test_photo(owner=self.user), create_test_photo(owner=self.user)
            )

    def test_defaults(self):
        data = self.client.get("/api/duplicates/").json()
        self.assertEqual((data["page"], data["page_size"]), (1, 20))
        self.assertEqual(data["count"], 3)

    def test_page_and_page_size_are_clamped(self):
        data = self.client.get("/api/duplicates/?page=0&page_size=1000").json()
        self.assertEqual((data["page"], data["page_size"]), (1, 100))
        data = self.client.get("/api/duplicates/?page=-3&page_size=0").json()
        self.assertEqual((data["page"], data["page_size"]), (1, 1))
        self.assertEqual(len(data["results"]), 1)

    def test_a_page_past_the_end_is_echoed_and_shows_the_last_page(self):
        data = self.client.get("/api/duplicates/?page=7&page_size=2").json()
        self.assertEqual(data["page"], 7)
        self.assertEqual(len(data["results"]), 1)

    def test_filters(self):
        data = self.client.get(
            "/api/duplicates/?duplicate_type=visual_duplicate&status=pending"
        ).json()
        self.assertEqual(data["count"], 1)
        data = self.client.get("/api/duplicates/?duplicate_type=nonsense").json()
        self.assertEqual(data["count"], 0)
        data = self.client.get("/api/duplicates/?duplicate_type=&status=").json()
        self.assertEqual(data["count"], 3)

    def test_a_malformed_page_is_a_400(self):
        for query, field in (("page=x", "page"), ("page_size=1.5", "page_size")):
            with self.subTest(query=query):
                response = self.client.get(f"/api/duplicates/?{query}")
                self.assertEqual(response.status_code, 400)
                self.assertEqual(error_fields(response), [field])


@patch("api.views.duplicates.async_task")
class DetectDuplicatesRequestTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def detect(self, body: object):
        return self.client.post("/api/duplicates/detect", body, format="json")

    def test_defaults(self, async_task):
        response = self.detect({})
        self.assertEqual(response.status_code, 202)
        expected = {
            "detect_exact_copies": True,
            "detect_visual_duplicates": True,
            "visual_threshold": 10,
            "clear_pending": False,
            "batch_size": 10000,
        }
        self.assertEqual(response.json()["options"], expected)
        self.assertEqual(async_task.call_args.args[2], expected)

    def test_given_options_are_passed_on(self, async_task):
        body = {
            "detect_exact_copies": False,
            "detect_visual_duplicates": True,
            "visual_threshold": 3,
            "clear_pending": True,
            "batch_size": 2000,
        }
        response = self.detect(body)
        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.json()["options"], body)
        self.assertEqual(async_task.call_args.args[2], body)

    def test_numbers_sent_as_strings_still_count(self, async_task):
        response = self.detect({"visual_threshold": "4", "batch_size": "500"})
        self.assertEqual(response.status_code, 202)
        options = response.json()["options"]
        self.assertEqual((options["visual_threshold"], options["batch_size"]), (4, 500))

    def test_negative_threshold_is_passed_on(self, async_task):
        response = self.detect({"visual_threshold": -5})
        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.json()["options"]["visual_threshold"], -5)

    def test_batch_size_is_clamped(self, async_task):
        for sent, used in (
            (5, 100),
            (99, 100),
            (100, 100),
            (50000, 50000),
            (10**9, 50000),
        ):
            with self.subTest(sent=sent):
                response = self.detect({"batch_size": sent})
                self.assertEqual(response.json()["options"]["batch_size"], used)

    def test_malformed_numbers_are_a_400(self, async_task):
        for field in ("batch_size", "visual_threshold"):
            for value in ("lots", None, [1]):
                with self.subTest(field=field, value=value):
                    response = self.detect({field: value})
                    self.assertEqual(response.status_code, 400)
                    self.assertEqual(error_fields(response), [field])
        async_task.assert_not_called()

    def test_flags_are_booleans_not_truthiness(self, async_task):
        response = self.detect({"clear_pending": "false", "detect_exact_copies": "0"})
        self.assertEqual(response.status_code, 202)
        options = response.json()["options"]
        self.assertIs(options["clear_pending"], False)
        self.assertIs(options["detect_exact_copies"], False)
        response = self.detect({"clear_pending": "maybe"})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(error_fields(response), ["clear_pending"])


class DuplicateResolveRequestTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.keep = create_test_photo(owner=self.user)
        self.other = create_test_photo(owner=self.user)
        self.duplicate = create_test_duplicate(
            owner=self.user, duplicate_type=Duplicate.DuplicateType.EXACT_COPY
        )
        self.duplicate.photos.add(self.keep, self.other)

    def resolve(self, body: object):
        return self.client.post(
            f"/api/duplicates/{self.duplicate.id}/resolve/", body, format="json"
        )

    def test_trash_others_defaults_to_true(self):
        response = self.resolve({"keep_photo_hash": self.keep.image_hash})
        self.assertEqual(response.status_code, 200, response.content)
        self.other.refresh_from_db()
        self.assertTrue(self.other.in_trashcan)

    def test_trash_others_false_keeps_them(self):
        response = self.resolve(
            {"keep_photo_hash": self.keep.image_hash, "trash_others": False}
        )
        self.assertEqual(response.status_code, 200)
        self.other.refresh_from_db()
        self.assertFalse(self.other.in_trashcan)

    def test_a_missing_or_blank_hash_is_a_400_naming_it(self):
        for body in ({}, {"keep_photo_hash": ""}, {"keep_photo_hash": None}):
            with self.subTest(body=body):
                response = self.resolve(body)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(error_fields(response), ["keep_photo_hash"])

    def test_a_hash_outside_the_group_is_a_400(self):
        response = self.resolve({"keep_photo_hash": "not-in-group"})
        self.assertEqual(response.status_code, 400)

    def test_a_malformed_trash_others_is_a_400(self):
        response = self.resolve(
            {"keep_photo_hash": self.keep.image_hash, "trash_others": "perhaps"}
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(error_fields(response), ["trash_others"])


class DetectDuplicatesSchemaTest(TestCase):
    def test_detection_documents_a_request_body_not_query_parameters(self):
        from drf_spectacular.generators import SchemaGenerator

        schema = SchemaGenerator().get_schema(request=None, public=True)
        operation = schema["paths"]["/api/duplicates/detect"]["post"]
        self.assertEqual(
            [p["name"] for p in operation.get("parameters", []) if p["in"] == "query"],
            [],
        )
        body = operation["requestBody"]["content"]["application/json"]["schema"]
        self.assertIn("$ref", body)
