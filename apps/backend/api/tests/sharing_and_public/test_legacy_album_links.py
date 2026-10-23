"""Security review (#2845 verdict f): pre-#2008 album links on current dev.

GHSA-phvg-g65q-rhq3 (#2008) made media serving trust an album only for its
owner's photos, and made it impossible to *create* a link to someone else's
photo. Links created before that fix stay in upgraded databases. These tests
model one: Anna's album holds Vera's photo (a raw link, as the pre-fix album
edit endpoint wrote it). Every assertion states the secure behaviour; a
failure on origin/dev is the proof that the old link still leaks.

Portable: uses ``album.photos.add`` so it runs on dev (implicit through
table) and on the #2845 stack (explicit through model, ``added_by`` null).
"""

from django.test import TestCase
from rest_framework.test import APIClient

from api.models.album_user_share import AlbumUserShare
from api.tests.utils import (
    create_test_album_place,
    create_test_album_user,
    create_test_photo,
    create_test_user,
)


def _client(user):
    client = APIClient()
    if user is not None:
        client.force_authenticate(user=user)
    return client


class LegacyForeignLinkTest(TestCase):
    def setUp(self):
        self.anna = create_test_user()
        self.clara = create_test_user()
        self.vera = create_test_user()
        self.anna_photo = create_test_photo(owner=self.anna)
        self.vera_photo = create_test_photo(
            owner=self.vera,
            search_location="Vera Secret Street",
            gps_lat=52.5163,
            gps_lon=13.3777,
        )
        self.album = create_test_album_user(owner=self.anna, title="Legacy")
        self.album.photos.add(self.anna_photo)
        # The pre-#2008 link: Vera never shared this photo with anyone.
        self.album.photos.add(self.vera_photo)
        self.album.shared_to.add(self.clara)
        self.share = AlbumUserShare.objects.create(
            album=self.album, enabled=True, share_location=True
        )
        place = create_test_album_place(title="VeraPlaceTitle", owner=self.vera)
        place.photos.add(self.vera_photo)

    def test_member_album_detail_does_not_list_vera_photo(self):
        body = _client(self.clara).get(f"/api/albums/user/{self.album.pk}/").content
        self.assertNotIn(str(self.vera_photo.pk).encode(), body)
        self.assertNotIn(b"52.5163", body)

    def test_public_album_json_does_not_list_vera_photo(self):
        for url in (
            f"/api/albums/user/{self.album.pk}/?public=true&slug={self.share.slug}",
            f"/api/public/albums/s/{self.share.slug}/",
        ):
            with self.subTest(url=url):
                body = _client(None).get(url).content
                self.assertNotIn(str(self.vera_photo.pk).encode(), body)
                self.assertNotIn(b"52.5163", body)

    def test_public_photo_detail_by_slug_refuses_vera_photo(self):
        response = _client(None).get(
            f"/api/public/albums/s/{self.share.slug}/photos/{self.vera_photo.pk}/"
        )
        self.assertEqual(response.status_code, 404, response.content[:300])

    def test_shared_with_you_places_leave_vera_photo_out(self):
        body = _client(self.clara).get("/api/photos/shared/tome/places/").content
        self.assertNotIn(b"VeraPlaceTitle", body)
        response = _client(self.clara).get(
            "/api/photos/shared/tome/places/photos/?title=VeraPlaceTitle"
        )
        self.assertEqual(response.status_code, 404, response.content[:300])

    def test_photo_albums_action_is_a_404(self):
        response = _client(self.clara).get(f"/api/photos/{self.vera_photo.pk}/albums/")
        self.assertEqual(response.status_code, 404, response.content[:300])

    def test_media_already_refused_on_dev(self):
        for user in (self.clara, None):
            response = _client(user).get(
                f"/media/thumbnails_big/{self.vera_photo.image_hash}"
            )
            self.assertIn(response.status_code, (403, 404))

    def test_album_owner_who_planted_the_link_cannot_read_vera_metadata(self):
        """The pre-fix attacker is the album owner: no share needed."""
        body = _client(self.anna).get(f"/api/albums/user/{self.album.pk}/").content
        self.assertNotIn(b"52.5163", body)
        self.assertNotIn(b"Vera Secret Street", body)
