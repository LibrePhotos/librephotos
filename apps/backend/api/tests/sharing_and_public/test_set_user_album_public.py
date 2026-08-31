"""Characterization tests for api.views.public_albums.SetUserAlbumPublic.post.

These pin CURRENT behavior of POST /api/useralbum/makepublic/ before refactoring.
They intentionally assert what the code does today, including quirks that are
arguably bugs (documented inline).
"""

import datetime

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from api.models import AlbumUser
from api.models.album_user_share import AlbumUserShare
from api.tests.utils import create_test_photo, create_test_user

URL = "/api/useralbum/makepublic/"


class SetUserAlbumPublicTestBase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = create_test_user()
        self.other = create_test_user()
        self.client.force_authenticate(user=self.owner)
        self.photo = create_test_photo(owner=self.owner)
        self.album = AlbumUser.objects.create(title="album-a", owner=self.owner)
        self.album.photos.add(self.photo)

    def post(self, payload):
        return self.client.post(URL, format="json", data=payload)


class SetUserAlbumPublicValidationTest(SetUserAlbumPublicTestBase):
    def test_missing_album_id_returns_400(self):
        response = self.post({"val_public": True})

        self.assertEqual(400, response.status_code)
        self.assertEqual(
            {"status": False, "message": "Missing parameters"}, response.json()
        )

    def test_missing_val_public_returns_400(self):
        response = self.post({"album_id": self.album.id})

        self.assertEqual(400, response.status_code)
        self.assertEqual(
            {"status": False, "message": "Missing parameters"}, response.json()
        )

    def test_empty_payload_returns_400(self):
        response = self.post({})

        self.assertEqual(400, response.status_code)
        self.assertFalse(response.json()["status"])

    def test_explicit_null_album_id_returns_400(self):
        response = self.post({"album_id": None, "val_public": True})

        self.assertEqual(400, response.status_code)

    def test_val_public_false_is_not_treated_as_missing(self):
        # False is not None, so validation passes and the album is unpublished.
        response = self.post({"album_id": self.album.id, "val_public": False})

        self.assertEqual(200, response.status_code)
        self.assertTrue(response.json()["status"])

    def test_unknown_album_returns_404(self):
        response = self.post({"album_id": 999999, "val_public": True})

        self.assertEqual(404, response.status_code)
        self.assertEqual({"status": False, "message": "No such album"}, response.json())
        self.assertEqual(0, AlbumUserShare.objects.count())

    def test_non_owner_returns_403_and_creates_no_share(self):
        self.client.force_authenticate(user=self.other)

        response = self.post({"album_id": self.album.id, "val_public": True})

        self.assertEqual(403, response.status_code)
        self.assertEqual(
            {
                "status": False,
                "message": "You are not the owner of this album",
            },
            response.json(),
        )
        self.assertEqual(0, AlbumUserShare.objects.count())

    def test_unauthenticated_is_rejected(self):
        client = APIClient()

        response = client.post(
            URL, format="json", data={"album_id": self.album.id, "val_public": True}
        )

        self.assertIn(response.status_code, (401, 403))
        self.assertEqual(0, AlbumUserShare.objects.count())


class SetUserAlbumPublicEnableTest(SetUserAlbumPublicTestBase):
    def test_enable_creates_share_with_generated_slug(self):
        response = self.post({"album_id": self.album.id, "val_public": True})

        self.assertEqual(200, response.status_code)
        body = response.json()
        self.assertTrue(body["status"])

        share = AlbumUserShare.objects.get(album=self.album)
        self.assertTrue(share.enabled)
        # AlbumUserShare.save() auto-generates a slug when enabled and unset.
        self.assertTrue(share.slug)
        self.assertEqual(12, len(share.slug))
        self.assertIsNone(share.expires_at)
        # sharing option overrides default to None (inherit user defaults)
        self.assertIsNone(share.share_location)
        self.assertIsNone(share.share_faces)

    def test_response_body_is_album_list_serializer_payload(self):
        response = self.post({"album_id": self.album.id, "val_public": True})

        album_data = response.json()["album"]
        share = AlbumUserShare.objects.get(album=self.album)
        self.assertEqual(self.album.id, album_data["id"])
        self.assertEqual("album-a", album_data["title"])
        self.assertTrue(album_data["public"])
        self.assertEqual(share.slug, album_data["public_slug"])
        self.assertIsNone(album_data["public_expires_at"])
        self.assertEqual(1, album_data["photo_count"])
        self.assertEqual(
            {
                "share_location": None,
                "share_camera_info": None,
                "share_timestamps": None,
                "share_captions": None,
                "share_faces": None,
            },
            album_data["public_sharing_options"],
        )

    def test_explicit_slug_is_used(self):
        response = self.post(
            {"album_id": self.album.id, "val_public": True, "slug": "my-album"}
        )

        self.assertEqual(200, response.status_code)
        share = AlbumUserShare.objects.get(album=self.album)
        self.assertEqual("my-album", share.slug)
        self.assertEqual("my-album", response.json()["album"]["public_slug"])

    def test_empty_slug_string_falls_back_to_generated_slug(self):
        # `share.slug = slug or None` -> "" becomes None, then save() generates one.
        response = self.post(
            {"album_id": self.album.id, "val_public": True, "slug": ""}
        )

        self.assertEqual(200, response.status_code)
        share = AlbumUserShare.objects.get(album=self.album)
        self.assertTrue(share.slug)
        self.assertNotEqual("", share.slug)

    def test_null_slug_is_ignored_and_existing_slug_kept(self):
        AlbumUserShare.objects.create(album=self.album, enabled=True, slug="keep-me")

        response = self.post(
            {"album_id": self.album.id, "val_public": True, "slug": None}
        )

        self.assertEqual(200, response.status_code)
        self.assertEqual("keep-me", AlbumUserShare.objects.get(album=self.album).slug)

    def test_truthy_non_boolean_val_public_enables_sharing(self):
        # bool("false") is True -- string payloads enable the share.
        response = self.post({"album_id": self.album.id, "val_public": "false"})

        self.assertEqual(200, response.status_code)
        self.assertTrue(AlbumUserShare.objects.get(album=self.album).enabled)

    def test_falsy_non_boolean_val_public_disables_sharing(self):
        # 0 is not None so it passes the None check, and disables the share.
        AlbumUserShare.objects.create(album=self.album, enabled=True, slug="s1")

        response = self.post({"album_id": self.album.id, "val_public": 0})

        self.assertEqual(200, response.status_code)
        self.assertFalse(AlbumUserShare.objects.get(album=self.album).enabled)

    def test_album_id_as_string_is_accepted(self):
        response = self.post({"album_id": str(self.album.id), "val_public": True})

        self.assertEqual(200, response.status_code)
        self.assertTrue(AlbumUserShare.objects.get(album=self.album).enabled)


class SetUserAlbumPublicDisableTest(SetUserAlbumPublicTestBase):
    def test_disable_keeps_share_row_and_slug(self):
        AlbumUserShare.objects.create(album=self.album, enabled=True, slug="old-slug")

        response = self.post({"album_id": self.album.id, "val_public": False})

        self.assertEqual(200, response.status_code)
        share = AlbumUserShare.objects.get(album=self.album)
        self.assertFalse(share.enabled)
        # The slug is NOT cleared when unpublishing.
        self.assertEqual("old-slug", share.slug)
        self.assertFalse(response.json()["album"]["public"])
        self.assertEqual("old-slug", response.json()["album"]["public_slug"])

    def test_disable_without_existing_share_creates_disabled_share_without_slug(self):
        response = self.post({"album_id": self.album.id, "val_public": False})

        self.assertEqual(200, response.status_code)
        share = AlbumUserShare.objects.get(album=self.album)
        self.assertFalse(share.enabled)
        self.assertIsNone(share.slug)
        self.assertEqual("", response.json()["album"]["public_slug"])


class SetUserAlbumPublicExpiresAtTest(SetUserAlbumPublicTestBase):
    def test_valid_iso_expires_at_is_parsed(self):
        response = self.post(
            {
                "album_id": self.album.id,
                "val_public": True,
                "expires_at": "2030-01-02T03:04:05+00:00",
            }
        )

        self.assertEqual(200, response.status_code)
        share = AlbumUserShare.objects.get(album=self.album)
        self.assertEqual(
            datetime.datetime(2030, 1, 2, 3, 4, 5, tzinfo=datetime.timezone.utc),
            share.expires_at,
        )

    def test_unparseable_expires_at_sets_none(self):
        # parse_datetime returns None for a non-matching string; no exception is
        # raised, so expires_at is silently set to None.
        AlbumUserShare.objects.create(
            album=self.album,
            enabled=True,
            slug="s2",
            expires_at=timezone.now() + datetime.timedelta(days=1),
        )

        response = self.post(
            {
                "album_id": self.album.id,
                "val_public": True,
                "expires_at": "not-a-date",
            }
        )

        self.assertEqual(200, response.status_code)
        self.assertIsNone(AlbumUserShare.objects.get(album=self.album).expires_at)

    def test_invalid_calendar_date_is_swallowed_and_leaves_value_unchanged(self):
        # parse_datetime raises ValueError for a well-formed but invalid date;
        # the bare `except Exception: pass` keeps the previous value.
        previous = timezone.now() + datetime.timedelta(days=5)
        AlbumUserShare.objects.create(
            album=self.album, enabled=True, slug="s3", expires_at=previous
        )

        response = self.post(
            {
                "album_id": self.album.id,
                "val_public": True,
                "expires_at": "2030-13-45T99:99:99",
            }
        )

        self.assertEqual(200, response.status_code)
        self.assertEqual(
            previous, AlbumUserShare.objects.get(album=self.album).expires_at
        )

    def test_null_expires_at_does_not_clear_existing_value(self):
        previous = timezone.now() + datetime.timedelta(days=3)
        AlbumUserShare.objects.create(
            album=self.album, enabled=True, slug="s4", expires_at=previous
        )

        response = self.post(
            {"album_id": self.album.id, "val_public": True, "expires_at": None}
        )

        self.assertEqual(200, response.status_code)
        self.assertEqual(
            previous, AlbumUserShare.objects.get(album=self.album).expires_at
        )


class SetUserAlbumPublicSharingOptionsTest(SetUserAlbumPublicTestBase):
    def test_all_sharing_options_applied(self):
        response = self.post(
            {
                "album_id": self.album.id,
                "val_public": True,
                "sharing_options": {
                    "share_location": True,
                    "share_camera_info": False,
                    "share_timestamps": True,
                    "share_captions": False,
                    "share_faces": True,
                },
            }
        )

        self.assertEqual(200, response.status_code)
        share = AlbumUserShare.objects.get(album=self.album)
        self.assertTrue(share.share_location)
        self.assertFalse(share.share_camera_info)
        self.assertTrue(share.share_timestamps)
        self.assertFalse(share.share_captions)
        self.assertTrue(share.share_faces)
        self.assertEqual(
            {
                "share_location": True,
                "share_camera_info": False,
                "share_timestamps": True,
                "share_captions": False,
                "share_faces": True,
            },
            response.json()["album"]["public_sharing_options"],
        )

    def test_partial_sharing_options_leave_other_fields_untouched(self):
        AlbumUserShare.objects.create(
            album=self.album,
            enabled=True,
            slug="s5",
            share_location=True,
            share_faces=False,
        )

        response = self.post(
            {
                "album_id": self.album.id,
                "val_public": True,
                "sharing_options": {"share_captions": True},
            }
        )

        self.assertEqual(200, response.status_code)
        share = AlbumUserShare.objects.get(album=self.album)
        self.assertTrue(share.share_captions)
        self.assertTrue(share.share_location)
        self.assertFalse(share.share_faces)

    def test_explicit_none_sharing_option_resets_to_inherit(self):
        AlbumUserShare.objects.create(
            album=self.album, enabled=True, slug="s6", share_location=True
        )

        response = self.post(
            {
                "album_id": self.album.id,
                "val_public": True,
                "sharing_options": {"share_location": None},
            }
        )

        self.assertEqual(200, response.status_code)
        self.assertIsNone(AlbumUserShare.objects.get(album=self.album).share_location)

    def test_empty_sharing_options_dict_is_a_no_op(self):
        AlbumUserShare.objects.create(
            album=self.album, enabled=True, slug="s7", share_location=True
        )

        response = self.post(
            {
                "album_id": self.album.id,
                "val_public": True,
                "sharing_options": {},
            }
        )

        self.assertEqual(200, response.status_code)
        self.assertTrue(AlbumUserShare.objects.get(album=self.album).share_location)

    def test_unknown_sharing_option_keys_are_ignored(self):
        response = self.post(
            {
                "album_id": self.album.id,
                "val_public": True,
                "sharing_options": {"share_everything": True},
            }
        )

        self.assertEqual(200, response.status_code)
        share = AlbumUserShare.objects.get(album=self.album)
        self.assertIsNone(share.share_location)
        self.assertFalse(hasattr(share, "share_everything"))


class SetUserAlbumPublicIdempotencyTest(SetUserAlbumPublicTestBase):
    def test_repeated_enable_reuses_the_same_share_row_and_slug(self):
        first = self.post({"album_id": self.album.id, "val_public": True})
        slug = first.json()["album"]["public_slug"]

        second = self.post({"album_id": self.album.id, "val_public": True})

        self.assertEqual(200, second.status_code)
        self.assertEqual(1, AlbumUserShare.objects.filter(album=self.album).count())
        self.assertEqual(slug, second.json()["album"]["public_slug"])

    def test_second_album_gets_its_own_share(self):
        album2 = AlbumUser.objects.create(title="album-b", owner=self.owner)

        self.post({"album_id": self.album.id, "val_public": True})
        self.post({"album_id": album2.id, "val_public": True})

        slugs = set(AlbumUserShare.objects.values_list("slug", flat=True))
        self.assertEqual(2, AlbumUserShare.objects.count())
        self.assertEqual(2, len(slugs))
