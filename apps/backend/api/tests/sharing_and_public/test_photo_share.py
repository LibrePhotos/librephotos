"""Tests for revocable per-photo share links (issue #2028).

Cover the three things the old content-derived link could not do: mint a random
slug, rotate it, and revoke it so the withdrawn URL stops working.
"""

from django.test import TestCase
from rest_framework.test import APIClient

from api.models.photo_share import PhotoShare
from api.tests.utils import create_test_photo, create_test_user

SHARE_URL = "/api/photo/share"
LIST_URL = "/api/photo/share/list"


def public_url(slug):
    return f"/api/public/photo/{slug}/"


class PhotoShareTestBase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = create_test_user()
        self.other = create_test_user()
        self.photo = create_test_photo(owner=self.owner)
        self.client.force_authenticate(user=self.owner)

    def post(self, payload):
        return self.client.post(SHARE_URL, format="json", data=payload)


class SetPhotoShareValidationTest(PhotoShareTestBase):
    def test_missing_photo_id_returns_400(self):
        self.assertEqual(400, self.post({"action": "enable"}).status_code)

    def test_unknown_action_returns_400(self):
        response = self.post({"photo_id": str(self.photo.pk), "action": "explode"})

        self.assertEqual(400, response.status_code)

    def test_unknown_photo_returns_404(self):
        response = self.post({"photo_id": "00000000-0000-0000-0000-000000000000"})

        self.assertEqual(404, response.status_code)

    def test_non_owner_cannot_share_someones_photo(self):
        self.client.force_authenticate(user=self.other)

        response = self.post({"photo_id": str(self.photo.pk)})

        self.assertEqual(403, response.status_code)
        self.assertFalse(PhotoShare.objects.filter(photo=self.photo).exists())


class SetPhotoShareTest(PhotoShareTestBase):
    def test_enable_mints_a_random_slug(self):
        response = self.post({"photo_id": str(self.photo.pk), "action": "enable"})

        self.assertEqual(200, response.status_code)
        slug = response.json()["share"]["slug"]
        self.assertEqual(12, len(slug))
        self.assertNotIn(self.photo.image_hash, slug)
        self.assertEqual(f"/public/p/{slug}", response.json()["share"]["url"])

    def test_enabling_twice_keeps_the_same_link(self):
        first = self.post({"photo_id": str(self.photo.pk)}).json()["share"]["slug"]

        second = self.post({"photo_id": str(self.photo.pk)}).json()["share"]["slug"]

        self.assertEqual(first, second)

    def test_rotate_replaces_the_slug(self):
        first = self.post({"photo_id": str(self.photo.pk)}).json()["share"]["slug"]

        rotated = self.post(
            {"photo_id": str(self.photo.pk), "action": "rotate"}
        ).json()["share"]["slug"]

        self.assertNotEqual(first, rotated)
        self.assertEqual(404, self.client.get(public_url(first)).status_code)

    def test_disable_revokes_and_drops_the_slug(self):
        first = self.post({"photo_id": str(self.photo.pk)}).json()["share"]["slug"]

        response = self.post({"photo_id": str(self.photo.pk), "action": "disable"})

        self.assertFalse(response.json()["share"]["enabled"])
        share = PhotoShare.objects.get(photo=self.photo)
        self.assertIsNone(share.slug)
        self.assertEqual(404, self.client.get(public_url(first)).status_code)

    def test_re_enabling_after_revoke_mints_a_fresh_slug(self):
        first = self.post({"photo_id": str(self.photo.pk)}).json()["share"]["slug"]
        self.post({"photo_id": str(self.photo.pk), "action": "disable"})

        again = self.post({"photo_id": str(self.photo.pk)}).json()["share"]["slug"]

        self.assertNotEqual(first, again)

    def test_photo_can_be_shared_by_image_hash(self):
        response = self.post({"photo_id": self.photo.image_hash})

        self.assertEqual(200, response.status_code)
        self.assertTrue(response.json()["share"]["enabled"])


class PhotoShareListTest(PhotoShareTestBase):
    def test_lists_only_the_callers_active_shares(self):
        others_photo = create_test_photo(owner=self.other)
        PhotoShare.objects.create(photo=others_photo, enabled=True)
        revoked = create_test_photo(owner=self.owner)
        PhotoShare.objects.create(photo=revoked, enabled=False)
        self.post({"photo_id": str(self.photo.pk)})

        results = self.client.get(LIST_URL).json()["results"]

        self.assertEqual(1, len(results))
        self.assertEqual(str(self.photo.pk), results[0]["photo_id"])


class PublicPhotoBySlugTest(PhotoShareTestBase):
    def test_anonymous_visitor_can_read_an_active_share(self):
        slug = self.post({"photo_id": str(self.photo.pk)}).json()["share"]["slug"]
        anonymous = APIClient()

        response = anonymous.get(public_url(slug))

        self.assertEqual(200, response.status_code)
        self.assertEqual(
            self.photo.image_hash, response.json()["results"]["image_hash"]
        )

    def test_unknown_slug_returns_404(self):
        self.assertEqual(404, APIClient().get(public_url("deadbeefcafe")).status_code)

    def test_hidden_photo_is_not_served(self):
        slug = self.post({"photo_id": str(self.photo.pk)}).json()["share"]["slug"]
        self.photo.hidden = True
        self.photo.save()

        self.assertEqual(404, APIClient().get(public_url(slug)).status_code)
