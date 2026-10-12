"""The album and photo share views read their bodies through serializers (#2326).

``POST /api/useralbum/makepublic/`` read ``val_public`` by truthiness (the
string ``"false"`` published the album), crashed on an ``album_id`` that is not
a number and on sharing options that are not booleans, and cleared the expiry
for a date it could not read. ``POST /api/photo/share/`` answered its errors
without naming the field. Well-formed bodies behave as before.
"""

import datetime

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from api.models.album_user_share import AlbumUserShare
from api.models.photo_share import PhotoShare
from api.tests.utils import create_test_album_user, create_test_photo, create_test_user

ALBUM_URL = "/api/useralbum/makepublic/"
PHOTO_URL = "/api/photo/share/"


def error_fields(response) -> list[str]:
    return [error["field"] for error in response.json()["errors"]]


class SetUserAlbumPublicRequestTest(TestCase):
    def setUp(self):
        self.owner = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.owner)
        self.album = create_test_album_user(owner=self.owner)
        self.expiry = timezone.now() + datetime.timedelta(days=5)
        self.share = AlbumUserShare.objects.create(
            album=self.album, enabled=True, slug="kept", expires_at=self.expiry
        )

    def post(self, **fields):
        body = {"album_id": self.album.id, "val_public": True, **fields}
        return self.client.post(ALBUM_URL, body, format="json")

    def stored(self) -> AlbumUserShare:
        return AlbumUserShare.objects.get(album=self.album)

    # --- well-formed input, as before ------------------------------------

    def test_the_web_clients_body(self):
        response = self.post(
            album_id=str(self.album.id),
            slug=" summer ",
            expires_at="2030-01-02T03:04:05.000Z",
            sharing_options={"share_location": False, "share_faces": None},
        )
        self.assertEqual(200, response.status_code, response.content)
        share = self.stored()
        self.assertEqual("summer", share.slug)
        self.assertEqual(
            datetime.datetime(2030, 1, 2, 3, 4, 5, tzinfo=datetime.timezone.utc),
            share.expires_at,
        )
        self.assertIs(False, share.share_location)
        self.assertIsNone(share.share_faces)

    def test_an_empty_expiry_clears_it(self):
        self.assertEqual(200, self.post(expires_at="").status_code)
        self.assertIsNone(self.stored().expires_at)

    def test_null_sharing_options_and_slug_change_nothing(self):
        self.assertEqual(200, self.post(sharing_options=None, slug=None).status_code)
        share = self.stored()
        self.assertEqual(("kept", self.expiry), (share.slug, share.expires_at))

    def test_unknown_sharing_options_are_ignored(self):
        self.assertEqual(
            200, self.post(sharing_options={"share_everything": True}).status_code
        )

    # --- malformed input is a 400 -----------------------------------------

    def test_missing_fields_are_a_400_naming_them(self):
        for body, field in (
            ({"val_public": True}, "album_id"),
            ({"album_id": self.album.id}, "val_public"),
            ({"album_id": None, "val_public": True}, "album_id"),
            ({"album_id": self.album.id, "val_public": None}, "val_public"),
        ):
            with self.subTest(body=body):
                response = self.client.post(ALBUM_URL, body, format="json")
                self.assertEqual(400, response.status_code)
                self.assertEqual([field], error_fields(response))

    def test_malformed_fields_are_a_400_naming_them(self):
        for fields, field in (
            ({"album_id": "abc"}, "album_id"),
            ({"val_public": "false"}, "val_public"),
            ({"val_public": 0}, "val_public"),
            ({"expires_at": "not-a-date"}, "expires_at"),
            ({"expires_at": "2030-13-45T99:99:99"}, "expires_at"),
            ({"sharing_options": "share_location"}, "sharing_options"),
            ({"sharing_options": {"share_location": "yes"}}, "sharing_options"),
        ):
            with self.subTest(fields=fields):
                response = self.post(**fields)
                self.assertEqual(400, response.status_code, response.content)
                self.assertEqual([field], error_fields(response))
                share = self.stored()
                self.assertEqual(
                    (True, "kept", self.expiry, None),
                    (share.enabled, share.slug, share.expires_at, share.share_location),
                )


class SetPhotoShareRequestTest(TestCase):
    def setUp(self):
        self.owner = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.owner)
        self.photo = create_test_photo(owner=self.owner)

    def post(self, body):
        return self.client.post(PHOTO_URL, body, format="json")

    def test_a_missing_or_empty_action_enables(self):
        for body in ({}, {"action": None}, {"action": ""}):
            with self.subTest(body=body):
                response = self.post({"photo_id": str(self.photo.pk), **body})
                self.assertEqual(200, response.status_code)
                self.assertTrue(response.json()["share"]["enabled"])

    def test_the_action_ignores_case(self):
        slug = self.post({"photo_id": str(self.photo.pk)}).json()["share"]["slug"]
        response = self.post({"photo_id": str(self.photo.pk), "action": "ROTATE"})
        self.assertNotEqual(slug, response.json()["share"]["slug"])
        response = self.post({"photo_id": str(self.photo.pk), "action": "Disable"})
        self.assertFalse(response.json()["share"]["enabled"])
        self.assertFalse(PhotoShare.objects.get(photo=self.photo).enabled)

    def test_errors_name_the_field(self):
        for body, field in (
            ({}, "photo_id"),
            ({"photo_id": ""}, "photo_id"),
            ({"photo_id": 5}, "photo_id"),
            ({"photo_id": str(self.photo.pk), "action": "explode"}, "action"),
            ({"photo_id": str(self.photo.pk), "action": True}, "action"),
        ):
            with self.subTest(body=body):
                response = self.post(body)
                self.assertEqual(400, response.status_code)
                self.assertEqual([field], error_fields(response))
        self.assertFalse(PhotoShare.objects.exists())
