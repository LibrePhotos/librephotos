"""Regression tests for GHSA-phvg-g65q-rhq3: a user album may only ever hold
the album owner's own photos.

``AlbumUserEditSerializer`` used to accept any Photo primary key in the
database (``queryset=Photo.objects.all()``), and its select_all branch fed
``build_photo_queryset`` straight into ``album.photos.add`` -- the same helper
that intentionally drops the owner filter for ``{"public": true}``. Either
path let an authenticated user pull another user's photos (private ones, via
the explicit id list) into an album they own. Because the media views trust
album membership, enabling a share on that album then served the victim's
originals to the attacker and to anyone with the link.

The same select_all leak existed in ``ZipListPhotosView_V2``; that one is
pinned in ``test_photo_download_zip``.
"""

from django.test import TestCase
from rest_framework.test import APIClient, APIRequestFactory
from rest_framework_simplejwt.tokens import RefreshToken

from api.models import AlbumUser
from api.models.album_user_share import AlbumUserShare
from api.tests.utils import create_test_photo, create_test_photos, create_test_user
from api.views.views import UnifiedMediaAccessView

EDIT_URL = "/api/albums/user/edit/"


class AlbumUserEditPhotoOwnerScopeTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.attacker = create_test_user()
        self.victim = create_test_user()
        self.client.force_authenticate(user=self.attacker)

    def _attacker_album_photo_ids(self):
        return {
            pk
            for album in AlbumUser.objects.filter(owner=self.attacker)
            for pk in album.photos.values_list("id", flat=True)
        }

    def test_create_rejects_other_users_private_photo_ids(self):
        victim_photos = create_test_photos(
            number_of_photos=2, owner=self.victim, public=False
        )

        response = self.client.post(
            EDIT_URL,
            format="json",
            data={"title": "Loot", "photos": [str(p.id) for p in victim_photos]},
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual([e["field"] for e in response.json()["errors"]], ["photos"])
        self.assertFalse(AlbumUser.objects.filter(owner=self.attacker).exists())

    def test_create_rejects_other_users_public_photo_ids(self):
        victim_photo = create_test_photo(owner=self.victim, public=True)

        response = self.client.post(
            EDIT_URL,
            format="json",
            data={"title": "Loot", "photos": [str(victim_photo.id)]},
        )

        self.assertEqual(response.status_code, 400)
        self.assertFalse(AlbumUser.objects.filter(owner=self.attacker).exists())

    def test_create_with_mixed_ids_fails_closed(self):
        own_photo = create_test_photo(owner=self.attacker)
        victim_photo = create_test_photo(owner=self.victim)

        response = self.client.post(
            EDIT_URL,
            format="json",
            data={
                "title": "Mixed",
                "photos": [str(own_photo.id), str(victim_photo.id)],
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertFalse(AlbumUser.objects.filter(owner=self.attacker).exists())

    def test_create_still_accepts_own_photo_ids(self):
        own_photos = create_test_photos(number_of_photos=2, owner=self.attacker)

        response = self.client.post(
            EDIT_URL,
            format="json",
            data={"title": "Mine", "photos": [str(p.id) for p in own_photos]},
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(self._attacker_album_photo_ids(), {p.id for p in own_photos})

    def test_update_rejects_other_users_photo_ids(self):
        album = AlbumUser.objects.create(title="Existing", owner=self.attacker)
        victim_photo = create_test_photo(owner=self.victim, public=False)

        response = self.client.patch(
            f"{EDIT_URL}{album.id}/",
            format="json",
            data={"photos": [str(victim_photo.id)]},
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(album.photos.count(), 0)

    def test_update_still_accepts_own_photo_ids(self):
        album = AlbumUser.objects.create(title="Existing", owner=self.attacker)
        own_photo = create_test_photo(owner=self.attacker)

        response = self.client.patch(
            f"{EDIT_URL}{album.id}/",
            format="json",
            data={"photos": [str(own_photo.id)]},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(set(album.photos.values_list("id", flat=True)), {own_photo.id})

    def test_select_all_public_query_only_adds_own_photos(self):
        create_test_photos(number_of_photos=3, owner=self.victim, public=True)
        own_photos = create_test_photos(
            number_of_photos=2, owner=self.attacker, public=True
        )

        response = self.client.post(
            EDIT_URL,
            format="json",
            data={
                "title": "Public",
                "photos": [],
                "select_all": True,
                "query": {"public": True},
            },
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(self._attacker_album_photo_ids(), {p.id for p in own_photos})

    def test_select_all_on_update_public_query_only_adds_own_photos(self):
        album = AlbumUser.objects.create(title="Existing", owner=self.attacker)
        create_test_photos(number_of_photos=3, owner=self.victim, public=True)
        own_photos = create_test_photos(
            number_of_photos=2, owner=self.attacker, public=True
        )

        response = self.client.patch(
            f"{EDIT_URL}{album.id}/",
            format="json",
            data={"select_all": True, "query": {"public": True}},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            set(album.photos.values_list("id", flat=True)),
            {p.id for p in own_photos},
        )

    def test_select_all_still_honours_excluded_hashes(self):
        own_photos = create_test_photos(
            number_of_photos=3, owner=self.attacker, public=True
        )

        response = self.client.post(
            EDIT_URL,
            format="json",
            data={
                "title": "Some",
                "photos": [],
                "select_all": True,
                "query": {"public": True},
                "excluded_hashes": [own_photos[0].image_hash],
            },
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(
            self._attacker_album_photo_ids(), {p.id for p in own_photos[1:]}
        )

    def test_cover_photo_rejects_other_users_photo(self):
        album = AlbumUser.objects.create(title="Existing", owner=self.attacker)
        victim_photo = create_test_photo(owner=self.victim, public=False)

        response = self.client.patch(
            f"{EDIT_URL}{album.id}/",
            format="json",
            data={"cover_photo": str(victim_photo.id)},
        )

        self.assertEqual(response.status_code, 400)
        album.refresh_from_db()
        self.assertIsNone(album.cover_photo)

    def test_cover_photo_still_accepts_own_photo(self):
        album = AlbumUser.objects.create(title="Existing", owner=self.attacker)
        own_photo = create_test_photo(owner=self.attacker)

        response = self.client.patch(
            f"{EDIT_URL}{album.id}/",
            format="json",
            data={"cover_photo": str(own_photo.id)},
        )

        self.assertEqual(response.status_code, 200)
        album.refresh_from_db()
        self.assertEqual(album.cover_photo_id, own_photo.id)


def _media_client_for(user):
    """The media view reads the raw ``jwt`` cookie, not DRF authentication."""
    client = APIClient()
    if user is not None:
        client.cookies["jwt"] = str(RefreshToken.for_user(user).access_token)
    return client


class ForeignPhotoInSharedAlbumMediaAccessTest(TestCase):
    """Defence in depth for the media views.

    Even if a photo has somehow landed in an album its owner does not own
    (rows written before this fix, or a future regression), that album's
    share must not vouch for it: the album owner, a share recipient, and an
    anonymous link holder all get the same answer a stranger would.
    """

    def setUp(self):
        self.victim = create_test_user()
        self.attacker = create_test_user()
        self.bystander = create_test_user()
        self.victim_photo = create_test_photo(owner=self.victim, public=False)
        self.album = AlbumUser.objects.create(title="Loot", owner=self.attacker)
        self.album.photos.add(self.victim_photo)

    def _paths(self):
        return ("thumbnails_big", "photos")

    def test_public_share_does_not_serve_foreign_photo_anonymously(self):
        AlbumUserShare.objects.create(album=self.album, enabled=True)
        for path in self._paths():
            with self.subTest(path=path):
                resp = _media_client_for(None).get(
                    f"/media/{path}/{self.victim_photo.image_hash}"
                )
                self.assertNotEqual(resp.status_code, 200)

    def test_public_share_does_not_serve_foreign_photo_to_album_owner(self):
        AlbumUserShare.objects.create(album=self.album, enabled=True)
        for path in self._paths():
            with self.subTest(path=path):
                resp = _media_client_for(self.attacker).get(
                    f"/media/{path}/{self.victim_photo.image_hash}"
                )
                self.assertEqual(resp.status_code, 404)

    def test_public_share_does_not_serve_foreign_photo_to_bystander(self):
        AlbumUserShare.objects.create(album=self.album, enabled=True)
        for path in self._paths():
            with self.subTest(path=path):
                resp = _media_client_for(self.bystander).get(
                    f"/media/{path}/{self.victim_photo.image_hash}"
                )
                self.assertEqual(resp.status_code, 404)

    def test_user_share_does_not_serve_foreign_photo_to_recipient(self):
        self.album.shared_to.add(self.bystander)
        for path in self._paths():
            with self.subTest(path=path):
                resp = _media_client_for(self.bystander).get(
                    f"/media/{path}/{self.victim_photo.image_hash}"
                )
                self.assertEqual(resp.status_code, 404)

    def test_public_share_album_id_branch_does_not_serve_foreign_photo(self):
        # The album_id branch has no URL route; call the view directly.
        AlbumUserShare.objects.create(album=self.album, enabled=True)
        for path in self._paths():
            with self.subTest(path=path):
                request = APIRequestFactory().get(
                    f"/media/{path}/{self.victim_photo.image_hash}"
                )
                resp = UnifiedMediaAccessView.as_view()(
                    request,
                    path=path,
                    fname=self.victim_photo.image_hash,
                    album_id=self.album.id,
                )
                self.assertEqual(resp.status_code, 404)

    def test_owner_still_sees_their_photo(self):
        AlbumUserShare.objects.create(album=self.album, enabled=True)
        resp = _media_client_for(self.victim).get(
            f"/media/thumbnails_big/{self.victim_photo.image_hash}"
        )
        self.assertEqual(resp.status_code, 200)

    def test_share_still_serves_the_album_owners_own_photos(self):
        own_photo = create_test_photo(owner=self.attacker)
        self.album.photos.add(own_photo)
        AlbumUserShare.objects.create(album=self.album, enabled=True)
        resp = _media_client_for(None).get(
            f"/media/thumbnails_big/{own_photo.image_hash}"
        )
        self.assertEqual(resp.status_code, 200)
