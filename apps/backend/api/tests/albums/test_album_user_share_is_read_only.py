"""Sharing a user album with someone must not let them rename or delete it.

``AlbumUserViewSet`` is a full ``ModelViewSet`` whose queryset is "albums I
own or that are shared to me". Reads need the shared half, so that a
recipient can open an album shared with them. Writes went through the same
queryset, so the recipient of a read share could ``PATCH``/``PUT`` the
owner's album title or ``DELETE`` the owner's album outright.

The frontend only renames and deletes albums from the owner's own list
(``/api/albums/user/list/``), so confining writes to the owner changes
nothing for a legitimate client.
"""

from django.test import TestCase
from rest_framework.test import APIClient

from api.models import AlbumUser
from api.tests.utils import create_test_photo, create_test_user


class AlbumUserShareIsReadOnlyTest(TestCase):
    def setUp(self):
        self.owner = create_test_user()
        self.recipient = create_test_user()
        self.album = AlbumUser.objects.create(title="Family", owner=self.owner)
        self.album.photos.add(create_test_photo(owner=self.owner))
        self.album.shared_to.add(self.recipient)
        self.url = f"/api/albums/user/{self.album.id}/"

    def client_for(self, user):
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    def test_recipient_can_still_open_the_shared_album(self):
        response = self.client_for(self.recipient).get(self.url)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["title"], "Family")

    def test_recipient_cannot_rename_the_shared_album(self):
        client = self.client_for(self.recipient)
        for method in ("patch", "put"):
            with self.subTest(method=method):
                response = getattr(client, method)(
                    self.url, {"title": "pwned"}, format="json"
                )

                self.assertEqual(response.status_code, 404)
                self.album.refresh_from_db()
                self.assertEqual(self.album.title, "Family")

    def test_recipient_cannot_delete_the_shared_album(self):
        response = self.client_for(self.recipient).delete(self.url)

        self.assertEqual(response.status_code, 404)
        self.assertTrue(AlbumUser.objects.filter(id=self.album.id).exists())

    def test_owner_can_still_rename_and_delete(self):
        client = self.client_for(self.owner)

        response = client.patch(self.url, {"title": "Renamed"}, format="json")
        self.assertEqual(response.status_code, 200)
        self.album.refresh_from_db()
        self.assertEqual(self.album.title, "Renamed")

        response = client.delete(self.url)
        self.assertEqual(response.status_code, 204)
        self.assertFalse(AlbumUser.objects.filter(id=self.album.id).exists())
