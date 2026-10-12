"""The zip download reads its body through a serializer (#2326).

It keeps the lenient shapes it always took (a JSON body or a form, a single
hash for a list of one, flags by their spelling, a ``query`` sent as a list);
a value of the wrong kind altogether is a 400 naming the field instead of a
500. A form listing several hashes now archives all of them, not the last.
"""

from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from api.tests.utils import create_test_photo, create_test_stack, create_test_user

URL = "/api/photos/download"


def error_fields(response) -> list[str]:
    return [error["field"] for error in response.json()["errors"]]


class ZipDownloadRequestTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.photo = create_test_photo(owner=self.user, size=100)
        self.other_photo = create_test_photo(owner=self.user, size=100)
        self.stacked = create_test_photo(owner=self.user, size=100)
        stack = create_test_stack(owner=self.user)
        stack.photos.add(self.photo, self.stacked)

        disk = patch("shutil.disk_usage")
        disk.start().return_value.free = 500000000
        self.addCleanup(disk.stop)
        job = patch("api.views.zip_downloads.create_download_job")
        self.create_job = job.start()
        self.create_job.return_value = "job-id"
        self.addCleanup(job.stop)

    def queued(self, response) -> set[str]:
        self.assertEqual(200, response.status_code, response.content)
        photos = self.create_job.call_args.kwargs["photos"]
        return {photo.image_hash for photo in photos}

    def post_json(self, body):
        return self.client.post(URL, body, format="json")

    # --- well-formed input, as before ------------------------------------

    def test_a_json_list_of_hashes(self):
        response = self.post_json({"image_hashes": [self.photo.image_hash]})
        self.assertEqual({self.photo.image_hash}, self.queued(response))

    def test_a_single_hash_string_is_a_list_of_one(self):
        response = self.post_json({"image_hashes": self.photo.image_hash})
        self.assertEqual({self.photo.image_hash}, self.queued(response))

    def test_a_form_with_one_hash(self):
        response = self.client.post(URL, {"image_hashes": self.photo.image_hash})
        self.assertEqual({self.photo.image_hash}, self.queued(response))

    def test_include_stacked_photos_spellings(self):
        both = {self.photo.image_hash, self.stacked.image_hash}
        only = {self.photo.image_hash}
        for value, expected in (
            (True, both),
            ("true", both),
            (" TRUE ", both),
            ("1", both),
            ("yes", both),
            ("on", both),
            ([True], both),
            (1, both),
            (False, only),
            ("false", only),
            ("0", only),
            ("nope", only),
            (None, only),
            ([], only),
        ):
            with self.subTest(include_stacked_photos=value):
                response = self.post_json(
                    {
                        "image_hashes": [self.photo.image_hash],
                        "include_stacked_photos": value,
                    }
                )
                self.assertEqual(expected, self.queued(response))

    def test_include_stacked_photos_in_a_form(self):
        response = self.client.post(
            URL, {"image_hashes": self.photo.image_hash, "include_stacked_photos": "on"}
        )
        self.assertEqual(
            {self.photo.image_hash, self.stacked.image_hash}, self.queued(response)
        )

    def test_select_all_with_a_query_list_and_a_single_excluded_hash(self):
        response = self.post_json(
            {
                "select_all": True,
                "query": [{"show_all_stack_photos": True}],
                "excluded_hashes": self.other_photo.image_hash,
            }
        )
        self.assertEqual(
            {self.photo.image_hash, self.stacked.image_hash}, self.queued(response)
        )

    def test_select_all_with_a_null_query_and_excluded_hashes(self):
        response = self.post_json(
            {"select_all": True, "query": None, "excluded_hashes": None}
        )
        # The default filter leaves out the stacked photos (no primary here).
        self.assertEqual({self.other_photo.image_hash}, self.queued(response))

    def test_missing_hashes_are_a_400(self):
        for body in ({}, {"image_hashes": []}, {"image_hashes": None}):
            with self.subTest(body=body):
                response = self.post_json(body)
                self.assertEqual(400, response.status_code)
                self.assertEqual(["image_hashes"], error_fields(response))

    # --- changed: a false word is false, a form keeps every hash -----------

    def test_a_false_select_all_string_is_not_select_all(self):
        response = self.post_json(
            {"select_all": "false", "image_hashes": [self.stacked.image_hash]}
        )
        self.assertEqual({self.stacked.image_hash}, self.queued(response))

    def test_a_form_with_several_hashes_archives_them_all(self):
        response = self.client.post(
            URL, {"image_hashes": [self.photo.image_hash, self.other_photo.image_hash]}
        )
        self.assertEqual(
            {self.photo.image_hash, self.other_photo.image_hash}, self.queued(response)
        )

    # --- malformed input is a 400 -----------------------------------------

    def test_values_of_the_wrong_kind_are_a_400_naming_the_field(self):
        for body, field in (
            ({"image_hashes": 5}, "image_hashes"),
            ({"image_hashes": {"a": 1}}, "image_hashes"),
            ({"image_hashes": [1, 2]}, "image_hashes"),
            ({"select_all": True, "query": "public"}, "query"),
            ({"select_all": True, "excluded_hashes": 5}, "excluded_hashes"),
        ):
            with self.subTest(body=body):
                response = self.post_json(body)
                self.assertEqual(400, response.status_code, response.content)
                self.assertEqual([field], error_fields(response))
        self.create_job.assert_not_called()

    def test_polling_without_a_job_id_is_a_400_naming_it(self):
        for query in ("", "?job_id="):
            with self.subTest(query=query):
                response = self.client.get(f"{URL}{query}")
                self.assertEqual(400, response.status_code)
                self.assertEqual(["job_id"], error_fields(response))
