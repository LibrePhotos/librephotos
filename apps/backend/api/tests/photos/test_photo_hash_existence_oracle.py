"""A photo hash must not tell a stranger whether that file exists (GHSA-hq2w-x39h-8wmp).

``image_hash`` is ``md5(file bytes) + owner id``, so anyone holding a file can
compute the hash it would have in any user's library. Two surfaces used to
answer differently for "exists but not yours" and "does not exist":

* ``GET /api/photos/<hash>/albums/`` looked the photo up across every owner,
  answering 200 for a foreign hash and 404 for an unknown one.
* The anonymous media routes answered 403 for an existing private photo and
  404 for an unknown hash.

Both must now give a stranger the same answer either way, while owners,
share recipients and public links keep working.
"""

from django.test import TestCase
from rest_framework.test import APIClient, APIRequestFactory

from api.models import AlbumUser
from api.tests.utils import create_test_photo, create_test_user
from api.views.media import UnifiedMediaAccessView

UNKNOWN_HASH = "0000000000000000000000000000beef"

factory = APIRequestFactory()


def _media(path, fname):
    """Fetch ``/media/<path>/<fname>`` without any credential."""
    request = factory.get(f"/media/{path}/{fname}")
    return UnifiedMediaAccessView.as_view()(request, path=path, fname=fname)


class PhotoAlbumsLookupOracleTest(TestCase):
    def setUp(self):
        self.owner = create_test_user()
        self.stranger = create_test_user()
        self.photo = create_test_photo(owner=self.owner)
        self.album = AlbumUser.objects.create(title="Private", owner=self.owner)
        self.album.photos.add(self.photo)
        self.client = APIClient()

    def _albums(self, lookup, user=None):
        self.client.force_authenticate(user=user)
        return self.client.get(f"/api/photos/{lookup}/albums/")

    def test_foreign_hash_answers_like_an_unknown_one(self):
        foreign = self._albums(self.photo.image_hash, self.stranger)
        unknown = self._albums(UNKNOWN_HASH, self.stranger)
        self.assertEqual(unknown.status_code, 404)
        self.assertEqual(foreign.status_code, 404)

    def test_foreign_uuid_answers_like_an_unknown_one(self):
        response = self._albums(str(self.photo.pk), self.stranger)
        self.assertEqual(response.status_code, 404)

    def test_anonymous_foreign_hash_answers_like_an_unknown_one(self):
        foreign = self._albums(self.photo.image_hash)
        unknown = self._albums(UNKNOWN_HASH)
        self.assertEqual(unknown.status_code, 404)
        self.assertEqual(foreign.status_code, 404)

    def test_owner_still_gets_their_albums(self):
        response = self._albums(self.photo.image_hash, self.owner)
        self.assertEqual(response.status_code, 200)
        self.assertEqual([a["id"] for a in response.json()["results"]], [self.album.id])

    def test_direct_share_recipient_still_gets_an_answer(self):
        self.photo.shared_to.add(self.stranger)
        response = self._albums(self.photo.image_hash, self.stranger)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["results"], [])

    def test_album_share_recipient_still_gets_the_shared_album(self):
        self.album.shared_to.add(self.stranger)
        response = self._albums(self.photo.image_hash, self.stranger)
        self.assertEqual(response.status_code, 200)
        self.assertEqual([a["id"] for a in response.json()["results"]], [self.album.id])

    def test_public_photo_answers_anyone(self):
        self.photo.public = True
        self.photo.save(update_fields=["public"])
        response = self._albums(self.photo.image_hash, self.stranger)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["results"], [])


class AnonymousMediaOracleTest(TestCase):
    """Anonymous callers get one answer for private and unknown hashes alike."""

    def setUp(self):
        self.owner = create_test_user()
        self.photo = create_test_photo(owner=self.owner)

    def _assert_indistinguishable(self, path, suffix=""):
        foreign = _media(path, f"{self.photo.image_hash}{suffix}")
        unknown = _media(path, f"{UNKNOWN_HASH}{suffix}")
        self.assertEqual(foreign.status_code, unknown.status_code)
        self.assertEqual(foreign.get("X-Media-Error"), unknown.get("X-Media-Error"))
        # A caller with no session is told to sign in, whether or not the
        # hash exists -- the same answer the frontend already acts on.
        self.assertEqual(unknown.status_code, 403)
        self.assertEqual(unknown["X-Media-Error"], "authentication")

    def test_square_thumbnail(self):
        self._assert_indistinguishable("square_thumbnails", ".jpg")

    def test_big_thumbnail(self):
        self._assert_indistinguishable("thumbnails_big", ".jpg")

    def test_original(self):
        self._assert_indistinguishable("photos")

    def test_public_photo_is_still_served_anonymously(self):
        self.photo.public = True
        self.photo.save(update_fields=["public"])
        response = _media("square_thumbnails", f"{self.photo.image_hash}.jpg")
        self.assertEqual(response.status_code, 200)
