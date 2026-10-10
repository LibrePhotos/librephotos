"""Album detail endpoints answer 404 for an album the caller cannot open.

The thing, place and person details used to pull the id out of the request's
repr and serialize ``.first()``, so a missing album came back as a 200 with
``{"title": ""}`` (which the web client fails to parse), and a non-numeric id
as a 500.
"""

from django.test import TestCase
from rest_framework.test import APIClient

from api.models import AlbumPlace, AlbumThing
from api.tests.utils import create_test_photo, create_test_user


class AlbumDetailNotFoundTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.other = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.photo = create_test_photo(owner=self.user)

    def _thing(self, owner, thing_type="hashtag_attribute"):
        album = AlbumThing.objects.create(
            title="beach", owner=owner, thing_type=thing_type
        )
        album.photos.add(create_test_photo(owner=owner))
        return album

    def _place(self, owner, **photo_kwargs):
        album = AlbumPlace.objects.create(title="Lisbon", owner=owner)
        album.photos.add(create_test_photo(owner=owner, **photo_kwargs))
        return album

    def test_an_existing_thing_album_opens(self):
        album = self._thing(self.user)
        response = self.client.get(f"/api/albums/thing/{album.id}/")
        self.assertEqual(response.status_code, 200)
        results = response.json()["results"]
        self.assertEqual(results["id"], str(album.id))
        self.assertEqual(results["title"], "beach")
        self.assertIn("grouped_photos", results)

    def test_an_existing_place_album_opens(self):
        album = self._place(self.user)
        response = self.client.get(f"/api/albums/place/{album.id}/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["results"]["title"], "Lisbon")

    def test_unknown_ids_are_not_found(self):
        for url in (
            "/api/albums/thing/999999/",
            "/api/albums/place/999999/",
            "/api/albums/date/999999/",
        ):
            with self.subTest(url=url):
                self.assertEqual(self.client.get(url).status_code, 404)

    def test_non_numeric_ids_are_not_found(self):
        for url in (
            "/api/albums/thing/abc/",
            "/api/albums/place/abc/",
            "/api/albums/date/abc/",
        ):
            with self.subTest(url=url):
                self.assertEqual(self.client.get(url).status_code, 404)

    def test_another_users_albums_are_not_found(self):
        thing = self._thing(self.other)
        place = self._place(self.other)
        self.assertEqual(
            self.client.get(f"/api/albums/thing/{thing.id}/").status_code, 404
        )
        self.assertEqual(
            self.client.get(f"/api/albums/place/{place.id}/").status_code, 404
        )

    def test_a_place_whose_photos_are_all_hidden_is_not_found(self):
        album = self._place(self.user, hidden=True)
        self.assertEqual(
            self.client.get(f"/api/albums/place/{album.id}/").status_code, 404
        )

    def test_a_thing_of_a_retired_tagging_model_is_not_found(self):
        album = self._thing(self.user, thing_type="some_old_model_tag")
        self.assertEqual(
            self.client.get(f"/api/albums/thing/{album.id}/").status_code, 404
        )
