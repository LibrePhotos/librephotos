"""Regression tests for UnifiedMediaAccessView authorization.

Two defects are covered here:

1. The album-share branch queried a field that does not exist. `AlbumUser`
   lost its `public` flag when sharing moved to the `AlbumUserShare` relation,
   but two call sites still did `.only("shared_to", "public")`. Django raises
   `FieldDoesNotExist` while *building* the query, so every album-level share
   returned HTTP 500 instead of the media, and unauthorized requests returned
   500 instead of 404.

2. When several Photo rows share one `image_hash`, the view resolved the
   ambiguity with `.first()` — an arbitrary row that may belong to a different
   user — so an owner could be denied their own photo.
"""

import datetime

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from api.models import AlbumUser
from api.models.album_user_share import AlbumUserShare
from api.tests.utils import create_test_photo, create_test_user


def _client_for(user):
    """The view reads the raw `jwt` cookie, so force_authenticate is not enough."""
    client = APIClient()
    if user is not None:
        client.cookies["jwt"] = str(RefreshToken.for_user(user).access_token)
    return client


class AlbumShareMediaAccessTest(TestCase):
    """An album shared with another user must serve media, not 500."""

    def setUp(self):
        self.owner = create_test_user()
        self.recipient = create_test_user()
        self.stranger = create_test_user()
        self.photo = create_test_photo(owner=self.owner)
        self.album = AlbumUser.objects.create(title="Holiday", owner=self.owner)
        self.album.photos.add(self.photo)
        self.album.shared_to.add(self.recipient)

    def test_recipient_can_fetch_thumbnail(self):
        resp = _client_for(self.recipient).get(
            f"/media/thumbnails_big/{self.photo.image_hash}"
        )
        self.assertEqual(resp.status_code, 200)

    def test_recipient_can_fetch_original(self):
        resp = _client_for(self.recipient).get(f"/media/photos/{self.photo.image_hash}")
        self.assertEqual(resp.status_code, 200)

    def test_owner_can_still_fetch_thumbnail(self):
        resp = _client_for(self.owner).get(
            f"/media/thumbnails_big/{self.photo.image_hash}"
        )
        self.assertEqual(resp.status_code, 200)

    def test_stranger_gets_404_not_500(self):
        for path in ("thumbnails_big", "photos"):
            with self.subTest(path=path):
                resp = _client_for(self.stranger).get(
                    f"/media/{path}/{self.photo.image_hash}"
                )
                self.assertEqual(resp.status_code, 404)

    def test_anonymous_is_forbidden(self):
        resp = _client_for(None).get(f"/media/thumbnails_big/{self.photo.image_hash}")
        self.assertEqual(resp.status_code, 403)


class PublicAlbumShareMediaAccessTest(TestCase):
    """A link-shared album grants anonymous access only while the share is live."""

    def setUp(self):
        self.owner = create_test_user()
        self.stranger = create_test_user()
        self.photo = create_test_photo(owner=self.owner)
        self.album = AlbumUser.objects.create(title="Public", owner=self.owner)
        self.album.photos.add(self.photo)
        self.share = AlbumUserShare.objects.create(album=self.album, enabled=True)

    def test_active_share_is_public(self):
        resp = _client_for(None).get(f"/media/thumbnails_big/{self.photo.image_hash}")
        self.assertEqual(resp.status_code, 200)

    def test_disabled_share_is_not_public(self):
        self.share.enabled = False
        self.share.save()
        resp = _client_for(None).get(f"/media/thumbnails_big/{self.photo.image_hash}")
        self.assertEqual(resp.status_code, 403)

    def test_expired_share_denied_to_other_user(self):
        self.share.expires_at = timezone.now() - datetime.timedelta(days=1)
        self.share.save()
        resp = _client_for(self.stranger).get(
            f"/media/thumbnails_big/{self.photo.image_hash}"
        )
        self.assertEqual(resp.status_code, 404)


class DuplicateImageHashResolutionTest(TestCase):
    """A hash shared by two Photo rows must resolve in the requester's favour.

    Two users who scan the same file end up with two Photo rows carrying an
    identical `image_hash`, because `File.create()` returns the row that
    already exists for that path and the second Photo inherits the first
    scanner's hash.
    """

    def setUp(self):
        self.alice = create_test_user()
        self.bob = create_test_user()
        self.stranger = create_test_user()
        self.alice_photo = create_test_photo(owner=self.alice)
        self.bob_photo = create_test_photo(owner=self.bob)
        # Capture the distinct originals before collapsing the hashes.
        self.alice_path = self.alice_photo.main_file.path
        self.bob_path = self.bob_photo.main_file.path
        self.shared_hash = self.alice_photo.image_hash
        self.bob_photo.image_hash = self.shared_hash
        self.bob_photo.save()

    def _redirect_for(self, user):
        resp = _client_for(user).get(f"/media/photos/{self.shared_hash}")
        self.assertEqual(resp.status_code, 200)
        return resp["X-Accel-Redirect"]

    def test_each_owner_gets_their_own_row(self):
        self.assertIn(self.alice_path.split("/")[-1], self._redirect_for(self.alice))
        self.assertIn(self.bob_path.split("/")[-1], self._redirect_for(self.bob))

    def test_owner_of_second_row_is_not_denied(self):
        # Before the fix `.first()` could hand back Alice's row, leaving Bob
        # unable to fetch a photo he owns.
        resp = _client_for(self.bob).get(f"/media/thumbnails_big/{self.shared_hash}")
        self.assertEqual(resp.status_code, 200)

    def test_stranger_still_denied(self):
        for path in ("thumbnails_big", "photos"):
            with self.subTest(path=path):
                resp = _client_for(self.stranger).get(
                    f"/media/{path}/{self.shared_hash}"
                )
                self.assertEqual(resp.status_code, 404)
