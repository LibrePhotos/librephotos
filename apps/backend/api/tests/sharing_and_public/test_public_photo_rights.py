"""A photo's rights on public pages and for the users it is shared with (#425).

A license is the owner's deliberate statement of what others may do with a
photo, so a public page sends the rights of a licensed photo whatever the
public sharing switches say (all off here). Without a license the copyright
and creator are only what a camera or app wrote into the file, often a full
name the owner never chose to publish: visitors get no rights at all. Users
the photo is shared with (a shared library) see them as the owner does.
"""

from django.test import TestCase
from rest_framework.test import APIClient

from api.models.album_user_share import AlbumUserShare
from api.models.photo_share import PhotoShare
from api.sharing.grants import licensed_rights
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
# What a camera wrote into the file: no license.
FROM_CAMERA = {"license": None, "creator": "Anna Maria Berger", "copyright": "© Anna"}


class PublicPhotoRightsTestCase(TestCase):
    def setUp(self):
        self.owner = create_test_user(public_sharing=True)
        self.licensed = create_test_photo(owner=self.owner, public=True, **RIGHTS)
        self.unlicensed = create_test_photo(
            owner=self.owner,
            public=True,
            creator=FROM_CAMERA["creator"],
            copyright=FROM_CAMERA["copyright"],
        )
        self.anonymous = APIClient()
        self.stranger = APIClient()
        self.stranger.force_authenticate(create_test_user())

    def detail(self, client, photo):
        return client.get(f"/api/photos/{photo.pk}/").json()


class PublicDetailTest(PublicPhotoRightsTestCase):
    def test_a_licensed_photo_sends_its_rights_with_every_switch_off(self):
        for client in (self.anonymous, self.stranger):
            with self.subTest(signed_in=client is self.stranger):
                data = self.detail(client, self.licensed)
                self.assertEqual(RIGHTS, data["rights"])
                self.assertIsNone(data["metadata"])

    def test_names_from_the_file_stay_hidden_without_a_license(self):
        for client in (self.anonymous, self.stranger):
            with self.subTest(signed_in=client is self.stranger):
                data = self.detail(client, self.unlicensed)
                self.assertIsNone(data["rights"])
                self.assertNotIn("Anna Maria Berger", str(data))

    def test_the_owner_sees_the_rights_of_an_unlicensed_photo(self):
        owner = APIClient()
        owner.force_authenticate(self.owner)
        self.assertEqual(FROM_CAMERA, self.detail(owner, self.unlicensed)["rights"])

    def test_a_library_recipient_sees_the_rights_without_a_license(self):
        recipient = create_test_user()
        create_test_library_share(self.owner, recipient)
        client = APIClient()
        client.force_authenticate(recipient)
        self.assertEqual(RIGHTS, self.detail(client, self.licensed)["rights"])
        self.assertEqual(FROM_CAMERA, self.detail(client, self.unlicensed)["rights"])

    def test_a_photo_without_rights_sends_none(self):
        photo = create_test_photo(owner=self.owner, public=True, width=8)
        self.assertIsNone(self.detail(self.anonymous, photo)["rights"])


class PublicLinkTest(PublicPhotoRightsTestCase):
    def photo_link(self, photo):
        link = PhotoShare.objects.create(  # raw-create: a public link
            photo=photo, enabled=True
        )
        return self.anonymous.get(f"/api/public/photo/{link.slug}/").json()

    def album_photo(self, photo):
        album = create_test_album_user(owner=self.owner)
        album.photos.add(photo)
        share = AlbumUserShare.objects.create(  # raw-create: a public link
            album=album, enabled=True
        )
        return self.anonymous.get(
            f"/api/public/albums/s/{share.slug}/photos/{photo.pk}/"
        ).json()

    def test_a_photo_link_sends_the_rights_of_a_licensed_photo_only(self):
        self.assertEqual(RIGHTS, self.photo_link(self.licensed)["results"]["rights"])
        self.assertIsNone(self.photo_link(self.unlicensed)["results"]["rights"])

    def test_a_public_album_sends_the_rights_of_a_licensed_photo_only(self):
        self.assertEqual(RIGHTS, self.album_photo(self.licensed)["results"]["rights"])
        self.assertIsNone(self.album_photo(self.unlicensed)["results"]["rights"])


class LicensedRightsTest(TestCase):
    def test_only_rights_with_a_license_pass(self):
        self.assertEqual(RIGHTS, licensed_rights(RIGHTS))
        self.assertIsNone(licensed_rights(FROM_CAMERA))
        self.assertIsNone(licensed_rights(None))
        self.assertIsNone(licensed_rights("cc-by-4.0"))
