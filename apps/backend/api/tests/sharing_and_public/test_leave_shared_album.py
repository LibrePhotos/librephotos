"""POST /api/useralbum/leave/: a recipient leaves an album shared with them (#2210)."""

from django.test import TestCase
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from api.models import AlbumUser, DeletionLog
from api.tests.utils import create_test_album_user, create_test_photo, create_test_user

URL = "/api/useralbum/leave/"


def _client_for(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


class LeaveSharedAlbumTest(TestCase):
    def setUp(self):
        self.owner = create_test_user()
        self.recipient = create_test_user()
        self.other_recipient = create_test_user()
        self.stranger = create_test_user()
        self.photo = create_test_photo(owner=self.owner)
        self.album = create_test_album_user(title="Lisbon", owner=self.owner)
        self.album.photos.add(self.photo)
        self.album.shared_to.add(self.recipient, self.other_recipient)

    def _leave(self, user, album_id):
        return _client_for(user).post(URL, {"album_id": album_id}, format="json")

    def _shared_to(self):
        return set(self.album.shared_to.values_list("id", flat=True))

    def test_leave_removes_only_the_caller(self):
        resp = self._leave(self.recipient, self.album.id)

        self.assertEqual(resp.status_code, 204)
        self.assertEqual(self._shared_to(), {self.other_recipient.id})
        self.assertTrue(AlbumUser.objects.filter(id=self.album.id).exists())
        self.assertIn(self.photo, self.album.photos.all())

    def test_leave_writes_a_tombstone_for_the_caller_only(self):
        self._leave(self.recipient, self.album.id)

        tombstones = DeletionLog.objects.filter(
            entity=DeletionLog.ENTITY_ALBUM_USER, entity_id=str(self.album.id)
        )
        self.assertEqual(
            list(tombstones.values_list("owner_id", flat=True)), [self.recipient.id]
        )

    def test_album_leaves_the_shared_with_me_list(self):
        self._leave(self.recipient, self.album.id)

        resp = _client_for(self.recipient).get("/api/albums/user/shared/tome/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["results"], [])
        still = _client_for(self.other_recipient).get("/api/albums/user/shared/tome/")
        self.assertEqual(len(still.json()["results"]), 1)

    def test_former_recipient_cannot_open_the_album_or_its_photos(self):
        self._leave(self.recipient, self.album.id)

        detail = _client_for(self.recipient).get(f"/api/albums/user/{self.album.id}/")
        self.assertEqual(detail.status_code, 404)
        media = APIClient()
        media.cookies["jwt"] = str(RefreshToken.for_user(self.recipient).access_token)
        resp = media.get(f"/media/thumbnails_big/{self.photo.image_hash}")
        self.assertEqual(resp.status_code, 404)

    def test_owner_cannot_leave_their_own_album(self):
        # Even one they shared to themselves: they own it.
        self.album.shared_to.add(self.owner)

        resp = self._leave(self.owner, self.album.id)

        self.assertEqual(resp.status_code, 404)
        self.assertIn(self.owner.id, self._shared_to())

    def test_non_recipient_gets_404_and_changes_nothing(self):
        resp = self._leave(self.stranger, self.album.id)

        self.assertEqual(resp.status_code, 404)
        self.assertEqual(
            self._shared_to(), {self.recipient.id, self.other_recipient.id}
        )
        self.assertFalse(DeletionLog.objects.exists())

    def test_unknown_album_is_the_same_404(self):
        unknown = self._leave(self.recipient, self.album.id + 1000)
        unshared = self._leave(self.stranger, self.album.id)

        self.assertEqual(unknown.status_code, 404)
        self.assertEqual(unknown.json(), unshared.json())

    def test_leaving_twice_is_a_404(self):
        self._leave(self.recipient, self.album.id)

        self.assertEqual(self._leave(self.recipient, self.album.id).status_code, 404)

    def test_missing_album_id_is_a_400(self):
        resp = _client_for(self.recipient).post(URL, {}, format="json")

        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()["errors"][0]["field"], "album_id")

    def test_anonymous_is_rejected(self):
        resp = APIClient().post(URL, {"album_id": self.album.id}, format="json")

        self.assertEqual(resp.status_code, 401)
        self.assertEqual(len(self._shared_to()), 2)
