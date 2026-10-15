"""The photo edit views read their bodies through serializers (#2326).

Each body that used to crash on a missing or mistyped field (``data["key"]``,
``dict.fromkeys`` over a string) is now a 400 naming the field; well-formed
bodies behave as before.
"""

from unittest.mock import ANY, patch

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from api.models import User
from api.tests.utils import create_test_photo, create_test_user


def error_fields(response) -> list[str]:
    return [error["field"] for error in response.json()["errors"]]


class PhotoBodyTestCase(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.other = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def assert_rejected(self, method: str, url: str, body: object, field: str):
        response = getattr(self.client, method)(url, body, format="json")
        self.assertEqual(response.status_code, 400, (url, body, response.content))
        self.assertEqual(error_fields(response), [field], body)


@override_settings(FEATURE_IMAGE_CAPTIONING=True)
class CaptionBodyTest(PhotoBodyTestCase):
    def test_generating_without_an_image_hash_is_a_400(self):
        for body in ({}, {"image_hash": None}, {"image_hash": 5}):
            with self.subTest(body=body):
                self.assert_rejected(
                    "post", "/api/photosedit/generateim2txt", body, "image_hash"
                )

    def test_saving_without_an_image_hash_or_caption_is_a_400(self):
        photo = create_test_photo(owner=self.user)
        url = "/api/photosedit/savecaption"
        self.assert_rejected("post", url, {"caption": "x"}, "image_hash")
        self.assert_rejected("post", url, {"image_hash": photo.image_hash}, "caption")
        self.assert_rejected(
            "post", url, {"image_hash": photo.image_hash, "caption": 3}, "caption"
        )

    def test_saving_an_empty_caption_still_works(self):
        photo = create_test_photo(owner=self.user)
        response = self.client.post(
            "/api/photosedit/savecaption",
            {"image_hash": photo.image_hash, "caption": ""},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)


class SharePhotosBodyTest(PhotoBodyTestCase):
    URL = "/api/photosedit/share"

    def test_missing_fields_are_a_400(self):
        photo = create_test_photo(owner=self.user)
        hashes = [photo.image_hash]
        for body, field in (
            ({"val_shared": True, "target_user_id": self.other.id}, "image_hashes"),
            ({"image_hashes": hashes, "target_user_id": self.other.id}, "val_shared"),
            ({"image_hashes": hashes, "val_shared": True}, "target_user_id"),
            (
                {"image_hashes": hashes, "val_shared": True, "target_user_id": "x"},
                "target_user_id",
            ),
            (
                {
                    "image_hashes": photo.image_hash,
                    "val_shared": True,
                    "target_user_id": self.other.id,
                },
                "image_hashes",
            ),
        ):
            with self.subTest(body=body):
                self.assert_rejected("post", self.URL, body, field)

    def test_sharing_and_unsharing_by_hash(self):
        photo = create_test_photo(owner=self.user)
        body = {
            "image_hashes": [photo.image_hash],
            "val_shared": True,
            "target_user_id": self.other.id,
        }
        response = self.client.post(self.URL, body, format="json")
        self.assertEqual(response.json(), {"status": True, "count": 1})
        self.assertTrue(photo.shared_to.filter(id=self.other.id).exists())
        response = self.client.post(
            self.URL, {**body, "val_shared": False}, format="json"
        )
        self.assertEqual(response.json(), {"status": True, "count": 1})
        self.assertFalse(photo.shared_to.filter(id=self.other.id).exists())

    def test_sharing_by_select_all(self):
        kept = create_test_photo(owner=self.user)
        excluded = create_test_photo(owner=self.user)
        response = self.client.post(
            self.URL,
            {
                "select_all": True,
                "query": {},
                "excluded_hashes": [excluded.image_hash],
                "val_shared": True,
                "target_user_id": self.other.id,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(kept.shared_to.filter(id=self.other.id).exists())
        self.assertFalse(excluded.shared_to.filter(id=self.other.id).exists())


class DeletePhotosBodyTest(PhotoBodyTestCase):
    URL = "/api/photosedit/delete"

    def test_missing_or_mistyped_hashes_are_a_400(self):
        for body in ({}, {"image_hashes": "abc"}, {"image_hashes": [1]}):
            with self.subTest(body=body):
                self.assert_rejected("delete", self.URL, body, "image_hashes")

    def test_deleting_trashed_photos_by_hash(self):
        photo = create_test_photo(owner=self.user, in_trashcan=True)
        response = self.client.delete(
            self.URL, {"image_hashes": [photo.image_hash, "nope"]}, format="json"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["deleted"], [photo.image_hash])
        self.assertEqual(response.json()["not_deleted"], ["nope"])


class SaveMetadataBodyTest(PhotoBodyTestCase):
    URL = "/api/savemetadata"

    def setUp(self):
        super().setUp()
        # With "Write edits to files" Off the endpoint is a 400 (#2293).
        self.user.save_metadata_to_disk = User.SaveMetadata.SIDECAR_FILE
        self.user.save()

    @patch("api.jobs.queue.AsyncTask")
    def test_types_default_to_what_the_settings_write(self, async_task):
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(self.URL, {}, format="json")
        self.assertEqual(response.status_code, 202, response.content)
        self.assertNotIn("face_tags", response.json()["types"])
        self.assertIn("ratings", response.json()["types"])

    @patch("api.jobs.queue.AsyncTask")
    def test_given_types_are_passed_on(self, async_task):
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(
                self.URL, {"types": ["ratings", "captions"]}, format="json"
            )
        self.assertEqual(response.status_code, 202, response.content)
        self.assertEqual(async_task.call_args.args[2], ["ratings", "captions"])

    def test_unknown_types_are_rejected(self):
        self.assert_rejected("post", self.URL, {"types": ["titles"]}, "types")

    def test_types_must_be_a_list(self):
        self.assert_rejected("post", self.URL, {"types": "ratings"}, "types")


class RotateBodyTest(PhotoBodyTestCase):
    URL = "/api/photosedit/rotate"

    @patch("api.views.photos.rotate_photo", return_value=None)
    def test_flip_is_a_boolean_not_truthiness(self, rotate):
        photo = create_test_photo(owner=self.user)
        response = self.client.post(
            self.URL,
            {"image_hash": photo.image_hash, "angle": 90, "flip_horizontal": "false"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        rotate.assert_called_once_with(ANY, angle=90, flip_horizontal=False)

    @patch("api.views.photos.rotate_photo", return_value=None)
    def test_defaults(self, rotate):
        photo = create_test_photo(owner=self.user)
        response = self.client.post(
            self.URL, {"image_hash": photo.image_hash}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.content)
        rotate.assert_called_once_with(ANY, angle=0, flip_horizontal=False)
