"""Tests for revocable per-photo share links (issue #2028).

Cover the three things the old content-derived link could not do: mint a random
slug, rotate it, and revoke it so the withdrawn URL stops working -- for the
metadata endpoint and for the media it points at.
"""

import datetime
from unittest import mock

from django.test import TestCase
from rest_framework.test import APIClient

from api.accounts.deletion import _turn_off_public_links
from api.models.photo_share import PhotoShare
from api.models.user import get_default_public_sharing_settings
from api.tests.utils import (
    create_test_face,
    create_test_person,
    create_test_photo,
    create_test_user,
)

SHARE_URL = "/api/photo/share"
LIST_URL = "/api/photo/share/list"


def public_url(slug):
    return f"/api/public/photo/{slug}/"


def media_url(slug, kind="thumbnail"):
    return f"/api/public/photo/{slug}/media/{kind}/"


def realistic_hash(photo):
    """Give ``photo`` a production-shaped image_hash: md5 plus the owner's id.

    The test factory hands out a bare md5, which is 32 hex digits and so also
    parses as a UUID; a real hash does not, and must not reach a pk lookup.
    """
    photo.image_hash = f"{photo.image_hash}{photo.owner_id}"
    photo.save(update_fields=["image_hash"])
    return photo.image_hash


class PhotoShareTestBase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = create_test_user()
        self.other = create_test_user()
        self.photo = create_test_photo(owner=self.owner)
        realistic_hash(self.photo)
        self.client.force_authenticate(user=self.owner)

    def post(self, payload):
        return self.client.post(SHARE_URL, format="json", data=payload)

    def share(self, action="enable"):
        return self.post({"photo_id": str(self.photo.pk), "action": action}).json()[
            "share"
        ]["slug"]


class SetPhotoShareValidationTest(PhotoShareTestBase):
    def test_missing_photo_id_returns_400(self):
        self.assertEqual(400, self.post({"action": "enable"}).status_code)

    def test_unknown_action_returns_400(self):
        response = self.post({"photo_id": str(self.photo.pk), "action": "explode"})

        self.assertEqual(400, response.status_code)

    def test_non_string_action_returns_400(self):
        response = self.post({"photo_id": str(self.photo.pk), "action": 1})

        self.assertEqual(400, response.status_code)

    def test_non_string_photo_id_returns_400(self):
        self.assertEqual(400, self.post({"photo_id": ["a", "b"]}).status_code)

    def test_unknown_photo_returns_404(self):
        response = self.post({"photo_id": "00000000-0000-0000-0000-000000000000"})

        self.assertEqual(404, response.status_code)

    def test_non_owner_cannot_share_someones_photo(self):
        self.client.force_authenticate(user=self.other)

        by_pk = self.post({"photo_id": str(self.photo.pk)})
        by_hash = self.post({"photo_id": self.photo.image_hash})

        # Reported like a missing photo, so hashes cannot be probed.
        self.assertEqual(404, by_pk.status_code)
        self.assertEqual(404, by_hash.status_code)
        self.assertFalse(PhotoShare.objects.filter(photo=self.photo).exists())

    def test_form_encoded_post_is_accepted(self):
        response = self.client.post(
            SHARE_URL, data={"photo_id": str(self.photo.pk), "action": "enable"}
        )

        self.assertEqual(200, response.status_code)
        self.assertTrue(response.json()["share"]["enabled"])


class SetPhotoShareTest(PhotoShareTestBase):
    def test_enable_mints_a_random_slug(self):
        response = self.post({"photo_id": str(self.photo.pk), "action": "enable"})

        self.assertEqual(200, response.status_code)
        slug = response.json()["share"]["slug"]
        self.assertEqual(12, len(slug))
        self.assertNotIn(slug, self.photo.image_hash)
        self.assertEqual(f"/public/p/{slug}", response.json()["share"]["url"])

    def test_enabling_does_not_make_the_photo_public(self):
        self.share()

        self.photo.refresh_from_db()
        self.assertFalse(self.photo.public)

    def test_enabling_twice_keeps_the_same_link(self):
        first = self.share()

        second = self.share()

        self.assertEqual(first, second)

    def test_rotate_replaces_the_slug(self):
        first = self.share()

        rotated = self.share("rotate")

        self.assertNotEqual(first, rotated)
        self.assertEqual(404, self.client.get(public_url(first)).status_code)

    def test_disable_revokes_and_drops_the_slug(self):
        first = self.share()

        response = self.post({"photo_id": str(self.photo.pk), "action": "disable"})

        self.assertFalse(response.json()["share"]["enabled"])
        share = PhotoShare.objects.get(photo=self.photo)
        self.assertIsNone(share.slug)
        self.assertEqual(404, self.client.get(public_url(first)).status_code)

    def test_disable_without_a_share_creates_nothing(self):
        response = self.post({"photo_id": str(self.photo.pk), "action": "disable"})

        self.assertEqual(200, response.status_code)
        self.assertFalse(response.json()["share"]["enabled"])
        self.assertFalse(PhotoShare.objects.filter(photo=self.photo).exists())

    def test_re_enabling_after_revoke_mints_a_fresh_slug(self):
        first = self.share()
        self.share("disable")

        again = self.share()

        self.assertNotEqual(first, again)

    def test_photo_can_be_shared_by_image_hash(self):
        # md5 + user id: not a UUID, which used to 500 in the pk lookup.
        self.assertGreater(len(self.photo.image_hash), 32)

        response = self.post({"photo_id": self.photo.image_hash})

        self.assertEqual(200, response.status_code)
        self.assertTrue(response.json()["share"]["enabled"])
        self.assertEqual(self.photo, PhotoShare.objects.get().photo)


class PhotoShareListTest(PhotoShareTestBase):
    def test_lists_only_the_callers_active_shares(self):
        others_photo = create_test_photo(owner=self.other)
        PhotoShare.objects.create(photo=others_photo, enabled=True)
        revoked = create_test_photo(owner=self.owner)
        PhotoShare.objects.create(photo=revoked, enabled=False)
        self.share()

        results = self.client.get(LIST_URL).json()["results"]

        self.assertEqual(1, len(results))
        self.assertEqual(str(self.photo.pk), results[0]["photo_id"])


class PublicPhotoBySlugTest(PhotoShareTestBase):
    def test_anonymous_visitor_can_read_an_active_share(self):
        slug = self.share()

        response = APIClient().get(public_url(slug))

        self.assertEqual(200, response.status_code)
        results = response.json()["results"]
        self.assertEqual(media_url(slug), results["thumbnail_url"])
        self.assertIsNone(results["video_url"])
        self.assertIsNone(results["video_playback_type"])

    def test_hash_derived_fields_are_not_exposed(self):
        slug = self.share()

        body = APIClient().get(public_url(slug)).content.decode()

        self.assertNotIn(self.photo.image_hash, body)

    def test_face_crops_are_not_exposed(self):
        self.owner.public_sharing_defaults = {"share_faces": True}
        self.owner.save()
        person = create_test_person(cluster_owner=self.owner)
        create_test_face(photo=self.photo, person=person)
        slug = self.share()

        people = APIClient().get(public_url(slug)).json()["results"]["people"]

        self.assertEqual([{"name": person.name}], people)

    def test_video_share_exposes_a_video_url(self):
        video = create_test_photo(owner=self.owner, video=True)
        slug = self.post({"photo_id": str(video.pk)}).json()["share"]["slug"]

        results = APIClient().get(public_url(slug)).json()["results"]

        self.assertEqual(media_url(slug, "video"), results["video_url"])

    def test_video_share_tells_the_browser_what_the_video_is(self):
        # So the page can ask canPlayType before playing: an HEVC clip in a
        # Chrome without the decoder plays sound over a black picture.
        video = create_test_photo(
            owner=self.owner,
            video=True,
            video_codec="hevc",
            video_pixel_format="yuv420p10le",
            video_container="mov,mp4,m4a,3gp,3g2,mj2",
        )
        slug = self.post({"photo_id": str(video.pk)}).json()["share"]["slug"]

        results = APIClient().get(public_url(slug)).json()["results"]

        self.assertEqual(
            'video/mp4; codecs="hvc1.2.4.L120.90"', results["video_playback_type"]
        )

    def test_unknown_slug_returns_404(self):
        self.assertEqual(404, APIClient().get(public_url("deadbeefcafe")).status_code)

    def test_hidden_trashed_or_removed_photo_is_not_served(self):
        slug = self.share()
        for flag in ("hidden", "in_trashcan", "removed"):
            with self.subTest(flag=flag):
                setattr(self.photo, flag, True)
                self.photo.save()

                self.assertEqual(404, APIClient().get(public_url(slug)).status_code)

                setattr(self.photo, flag, False)
                self.photo.save()


class SharedPhotoMediaTest(PhotoShareTestBase):
    """The media a link grants is scoped to the slug, not to the photo."""

    def setUp(self):
        super().setUp()
        self.anonymous = APIClient()

    def test_thumbnail_is_served_while_the_share_is_active(self):
        slug = self.share()

        response = self.anonymous.get(media_url(slug))

        self.assertEqual(200, response.status_code)
        self.assertIn("thumbnails_big", response["X-Accel-Redirect"])
        self.assertIn("no-cache", response["Cache-Control"])

    def test_revoking_cuts_off_the_media(self):
        slug = self.share()

        self.share("disable")

        self.assertEqual(404, self.anonymous.get(media_url(slug)).status_code)

    def test_replacing_the_link_cuts_off_the_old_media_url(self):
        old = self.share()

        new = self.share("rotate")

        self.assertEqual(404, self.anonymous.get(media_url(old)).status_code)
        self.assertEqual(200, self.anonymous.get(media_url(new)).status_code)

    def test_share_does_not_open_the_hash_addressed_media(self):
        self.share()

        response = self.anonymous.get(f"/media/thumbnails_big/{self.photo.image_hash}")

        self.assertEqual(403, response.status_code)

    def test_hidden_trashed_or_removed_photo_media_is_not_served(self):
        slug = self.share()
        for flag in ("hidden", "in_trashcan", "removed"):
            with self.subTest(flag=flag):
                setattr(self.photo, flag, True)
                self.photo.save()

                self.assertEqual(404, self.anonymous.get(media_url(slug)).status_code)

                setattr(self.photo, flag, False)
                self.photo.save()

    def test_still_photo_has_no_video_or_original(self):
        slug = self.share()

        self.assertEqual(404, self.anonymous.get(media_url(slug, "video")).status_code)
        self.assertEqual(
            404, self.anonymous.get(media_url(slug, "original")).status_code
        )

    def test_video_is_playable_through_the_link(self):
        # Every public switch on: the original itself (otherwise its copy
        # without metadata, test_public_media_follow_sharing_switches).
        self.owner.public_sharing_defaults = dict.fromkeys(
            get_default_public_sharing_settings(), True
        )
        self.owner.save()
        video = create_test_photo(owner=self.owner, video=True)
        slug = self.post({"photo_id": str(video.pk)}).json()["share"]["slug"]

        response = self.anonymous.get(media_url(slug, "video"))

        self.assertEqual(200, response.status_code)
        self.assertTrue(response["X-Accel-Redirect"])


NOW = datetime.datetime(2026, 11, 20, 12, 0, tzinfo=datetime.UTC)
PAST = NOW - datetime.timedelta(seconds=1)
FUTURE = NOW + datetime.timedelta(days=1)


class PhotoShareExpiryTest(PhotoShareTestBase):
    def setUp(self):
        super().setUp()
        self.anonymous = APIClient()
        patcher = mock.patch("django.utils.timezone.now", return_value=NOW)
        patcher.start()
        self.addCleanup(patcher.stop)

    def share_at(self, expires_at, photo=None, action="enable"):
        return self.post(
            {
                "photo_id": str((photo or self.photo).pk),
                "action": action,
                "expires_at": expires_at,
            }
        ).json()["share"]

    def stored_expiry(self):
        return PhotoShare.objects.get(photo=self.photo).expires_at

    def test_the_payload_reports_the_expiry(self):
        share = self.share_at("2026-12-01T12:00:00Z")

        self.assertEqual("2026-12-01T12:00:00Z", share["expires_at"])

    def test_a_link_with_no_expiry_stays_open(self):
        share = self.share_at(None)

        self.assertIsNone(share["expires_at"])
        self.assertEqual(200, self.anonymous.get(public_url(share["slug"])).status_code)
        self.assertEqual(200, self.anonymous.get(media_url(share["slug"])).status_code)

    def test_a_link_is_open_up_to_its_expiry(self):
        share = self.share_at(NOW.isoformat())

        self.assertEqual(200, self.anonymous.get(public_url(share["slug"])).status_code)
        self.assertEqual(200, self.anonymous.get(media_url(share["slug"])).status_code)

    def test_an_offset_expiry_is_compared_as_an_instant(self):
        open_share = self.share_at("2026-11-20T13:00:01+01:00")
        self.assertEqual(
            200, self.anonymous.get(public_url(open_share["slug"])).status_code
        )

        closed_share = self.share_at("2026-11-20T12:59:59+01:00")
        self.assertEqual(
            410, self.anonymous.get(public_url(closed_share["slug"])).status_code
        )

    def test_an_expired_link_answers_gone_with_a_code(self):
        share = self.share_at(PAST.isoformat())

        response = self.anonymous.get(public_url(share["slug"]))

        self.assertEqual(410, response.status_code)
        self.assertEqual("link_expired", response.json()["errors"][0]["code"])
        self.assertNotIn("results", response.json())

    def test_an_expired_link_serves_no_media(self):
        self.owner.public_sharing_defaults = dict.fromkeys(
            get_default_public_sharing_settings(), True
        )
        self.owner.save()
        video = create_test_photo(owner=self.owner, video=True)
        still = self.share_at(PAST.isoformat())["slug"]
        clip = self.share_at(PAST.isoformat(), photo=video)["slug"]

        for url in (
            media_url(still),
            media_url(still, "original"),
            media_url(clip),
            media_url(clip, "video"),
        ):
            with self.subTest(url=url):
                self.assertEqual(404, self.anonymous.get(url).status_code)

    def test_an_expired_link_of_a_hidden_photo_is_not_found(self):
        slug = self.share_at(PAST.isoformat())["slug"]
        self.photo.hidden = True
        self.photo.save()

        self.assertEqual(404, self.anonymous.get(public_url(slug)).status_code)

    def test_a_revoked_link_is_not_found_rather_than_expired(self):
        slug = self.share_at(PAST.isoformat())["slug"]

        self.share("disable")

        self.assertEqual(404, self.anonymous.get(public_url(slug)).status_code)

    def test_an_absent_expiry_keeps_the_current_one(self):
        self.share_at(NOW.isoformat())

        share = self.post({"photo_id": str(self.photo.pk), "action": "enable"}).json()[
            "share"
        ]

        self.assertEqual(
            "2026-11-20T12:00:00Z", share["expires_at"].replace("+00:00", "Z")
        )

    def test_a_null_expiry_clears_it(self):
        self.share_at(NOW.isoformat())

        share = self.share_at(None)

        self.assertIsNone(share["expires_at"])

    def test_a_blank_expiry_clears_it(self):
        self.share_at(NOW.isoformat())

        share = self.share_at("")

        self.assertIsNone(share["expires_at"])

    def test_an_invalid_expiry_is_rejected_and_changes_nothing(self):
        self.share_at(FUTURE.isoformat())

        response = self.post(
            {
                "photo_id": str(self.photo.pk),
                "action": "enable",
                "expires_at": "next tuesday",
            }
        )

        self.assertEqual(400, response.status_code)
        self.assertEqual(FUTURE, self.stored_expiry())

    def test_a_new_date_reopens_an_expired_link(self):
        slug = self.share_at(PAST.isoformat())["slug"]

        share = self.share_at(FUTURE.isoformat())

        self.assertEqual(slug, share["slug"])
        self.assertEqual(200, self.anonymous.get(public_url(slug)).status_code)
        self.assertEqual(200, self.anonymous.get(media_url(slug)).status_code)

    def test_replacing_the_link_keeps_its_expiry(self):
        old = self.share_at(FUTURE.isoformat())["slug"]

        share = self.post({"photo_id": str(self.photo.pk), "action": "rotate"}).json()[
            "share"
        ]

        self.assertNotEqual(old, share["slug"])
        self.assertEqual(FUTURE, self.stored_expiry())

    def test_revoking_drops_the_expiry_so_a_new_link_starts_open(self):
        self.share_at(PAST.isoformat())

        revoked = self.share_at(None, action="disable")
        fresh = self.post({"photo_id": str(self.photo.pk), "action": "enable"}).json()[
            "share"
        ]

        self.assertIsNone(revoked["expires_at"])
        self.assertIsNone(fresh["expires_at"])
        self.assertIsNone(self.stored_expiry())
        self.assertEqual(200, self.anonymous.get(public_url(fresh["slug"])).status_code)

    def test_another_user_cannot_set_the_expiry(self):
        self.share_at(FUTURE.isoformat())
        self.client.force_authenticate(user=self.other)

        response = self.post(
            {
                "photo_id": str(self.photo.pk),
                "action": "enable",
                "expires_at": PAST.isoformat(),
            }
        )

        self.assertEqual(404, response.status_code)
        self.assertEqual(FUTURE, self.stored_expiry())

    def test_an_anonymous_visitor_cannot_set_the_expiry(self):
        self.share_at(FUTURE.isoformat())

        response = self.anonymous.post(
            SHARE_URL,
            format="json",
            data={"photo_id": str(self.photo.pk), "expires_at": None},
        )

        self.assertIn(response.status_code, (401, 403))
        self.assertEqual(FUTURE, self.stored_expiry())

    def test_the_owners_list_keeps_an_expired_link_with_its_expiry(self):
        slug = self.share_at(PAST.isoformat())["slug"]

        results = self.client.get(LIST_URL).json()["results"]

        self.assertEqual([slug], [result["slug"] for result in results])
        self.assertEqual(
            "2026-11-20T11:59:59Z", results[0]["expires_at"].replace("+00:00", "Z")
        )

    def test_deleting_the_account_drops_the_expiry_with_the_link(self):
        self.share_at(FUTURE.isoformat())

        _turn_off_public_links(self.owner)

        share = PhotoShare.objects.get(photo=self.photo)
        self.assertEqual(
            (False, None, None), (share.enabled, share.slug, share.expires_at)
        )
