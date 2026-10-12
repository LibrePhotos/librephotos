"""Album sharing, tag and OCR bodies read through serializers (#2326)."""

from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from api.tests.utils import (
    create_test_album_user,
    create_test_photo,
    create_test_tag,
    create_test_user,
)


def error_fields(response) -> list[str]:
    return [error["field"] for error in response.json()["errors"]]


class AlbumShareBodyTest(TestCase):
    URL = "/api/useralbum/share"

    def setUp(self):
        self.user = create_test_user()
        self.other = create_test_user()
        self.album = create_test_album_user(owner=self.user)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_a_missing_key_is_a_400_naming_it(self):
        full = {
            "shared": True,
            "target_user_id": self.other.id,
            "album_id": self.album.id,
        }
        for missing in full:
            body = {key: value for key, value in full.items() if key != missing}
            with self.subTest(missing=missing):
                response = self.client.post(self.URL, body, format="json")
                self.assertEqual(response.status_code, 400)
                self.assertEqual(error_fields(response), [missing])

    def test_sharing_and_unsharing(self):
        body = {
            "shared": True,
            "target_user_id": self.other.id,
            "album_id": self.album.id,
        }
        response = self.client.post(self.URL, body, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(self.album.shared_to.filter(id=self.other.id).exists())
        response = self.client.post(self.URL, {**body, "shared": False}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(self.album.shared_to.filter(id=self.other.id).exists())


class TagBodyTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.tag = create_test_tag(owner=self.user, name="trip")
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_creating_an_existing_name_answers_with_that_tag(self):
        response = self.client.post("/api/tags/", {"name": " trip "}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["id"], self.tag.id)

    def test_merging_needs_a_numeric_tag(self):
        url = f"/api/tags/{self.tag.pk}/merge/"
        for body in ({}, {"tag": None}, {"tag": "abc"}):
            with self.subTest(body=body):
                response = self.client.post(url, body, format="json")
                self.assertEqual(response.status_code, 400)
                self.assertEqual(error_fields(response), ["tag"])
        other = create_test_tag(owner=self.user, name="other")
        response = self.client.post(url, {"tag": str(other.pk)}, format="json")
        self.assertEqual(response.status_code, 200)

    def test_adding_photos(self):
        photo = create_test_photo(owner=self.user)
        url = f"/api/tags/{self.tag.pk}/add/"
        response = self.client.post(url, {"photos": [photo.image_hash]}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(self.tag.photos.filter(pk=photo.pk).exists())
        for body in ({}, {"photos": []}):
            with self.subTest(body=body):
                self.assertEqual(
                    self.client.post(url, body, format="json").status_code, 400
                )
        response = self.client.post(
            url, {"select_all": True, "query": "all"}, format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(error_fields(response), ["query"])

    def test_listing_the_tags_of_a_photo(self):
        photo = create_test_photo(owner=self.user)
        self.tag.photos.add(photo)
        create_test_tag(owner=self.user, name="untouched")
        response = self.client.get("/api/tags/", {"photo": photo.image_hash})
        self.assertEqual(
            [row["id"] for row in response.json()["results"]], [self.tag.id]
        )


class GenerateOcrBodyTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(user=create_test_user())

    @patch("api.views.scan_triggers.AsyncTask")
    def test_full_scan_is_a_boolean(self, async_task):
        for body, full_scan in (
            ({}, False),
            ({"full_scan": "false"}, False),
            ({"full_scan": True}, True),
        ):
            with self.subTest(body=body):
                response = self.client.post("/api/generateocr", body, format="json")
                self.assertEqual(response.status_code, 200)
                self.assertIs(async_task.call_args.args[3], full_scan)
        response = self.client.post(
            "/api/generateocr", {"full_scan": "x"}, format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(error_fields(response), ["full_scan"])
