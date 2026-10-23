"""A photo's rights reach everyone who sees the photo (#425).

The copyright notice, the creator and the license are the owner's statement
of who made the photo and what others may do with it, so public pages send
them whatever the public sharing switches say (all off here), and so do the
photo's details for a user its owner shares their library with.
"""

from django.test import TestCase
from rest_framework.test import APIClient

from api.models.album_user_share import AlbumUserShare
from api.models.photo_share import PhotoShare
from api.tests.utils import (
    create_test_album_user,
    create_test_library_share,
    create_test_photo,
    create_test_user,
)

RIGHTS = {
    "license": "cc-by-nc-4.0",
    "creator": "Anna Berger",
    "copyright": "© 2026 Anna Berger",
}


class PublicPhotoRightsTest(TestCase):
    def setUp(self):
        self.owner = create_test_user(public_sharing=True)
        self.photo = create_test_photo(owner=self.owner, public=True, **RIGHTS)
        self.anonymous = APIClient()

    def test_a_public_photo_sends_its_rights_with_every_switch_off(self):
        data = self.anonymous.get(f"/api/photos/{self.photo.pk}/").json()
        self.assertEqual(RIGHTS, data["rights"])
        self.assertIsNone(data["metadata"])

    def test_a_photo_link_sends_its_rights(self):
        link = PhotoShare.objects.create(  # raw-create: a public link
            photo=self.photo, enabled=True
        )
        data = self.anonymous.get(f"/api/public/photo/{link.slug}/").json()
        self.assertEqual(RIGHTS, data["results"]["rights"])

    def test_a_public_album_photo_sends_its_rights(self):
        album = create_test_album_user(owner=self.owner)
        album.photos.add(self.photo)
        share = AlbumUserShare.objects.create(  # raw-create: a public link
            album=album, enabled=True
        )
        data = self.anonymous.get(
            f"/api/public/albums/s/{share.slug}/photos/{self.photo.pk}/"
        ).json()
        self.assertEqual(RIGHTS, data["results"]["rights"])

    def test_a_library_recipient_gets_the_rights(self):
        recipient = create_test_user()
        create_test_library_share(self.owner, recipient)
        client = APIClient()
        client.force_authenticate(recipient)
        data = client.get(f"/api/photos/{self.photo.pk}/").json()
        self.assertEqual(RIGHTS, data["rights"])

    def test_a_photo_without_rights_sends_none(self):
        photo = create_test_photo(owner=self.owner, public=True, width=8)
        data = self.anonymous.get(f"/api/photos/{photo.pk}/").json()
        self.assertIsNone(data["rights"])

    def test_a_copyright_alone_is_sent(self):
        photo = create_test_photo(owner=self.owner, public=True, copyright="© Nord")
        data = self.anonymous.get(f"/api/photos/{photo.pk}/").json()
        self.assertEqual(
            {"license": None, "creator": None, "copyright": "© Nord"}, data["rights"]
        )
