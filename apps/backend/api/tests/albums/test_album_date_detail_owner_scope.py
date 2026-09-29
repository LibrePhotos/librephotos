"""``GET /api/albums/date/<id>/`` must only resolve day albums the caller may see.

``AlbumDateViewSet`` looked the day album up by id alone. The photos in the
response were filtered to the requester, but the album itself was not, and
``AlbumDateSerializer`` renders its ``date`` and ``location`` (the first
place name the geocoder attached to that day, taken from every photo of the
day, private ones included). Walking the sequential ids therefore told any
logged-in user, or anyone at all with ``?public=1``, on which days every
other user took photos and where they were. An unknown id crashed with a
500 instead of a 404, so the endpoint was an existence oracle as well.

The timeline only ever asks for ids it got from ``/api/albums/date/list/``,
which applies the same scope: the requester's own days, or with ``public``
the days holding a public photo (of ``username``, when given).
"""

import datetime

from django.test import TestCase
from rest_framework.test import APIClient

from api.models import AlbumDate
from api.tests.utils import create_test_photo, create_test_user

SECRET_PLACE = "Secret Clinic Town"


class AlbumDateDetailOwnerScopeTest(TestCase):
    def setUp(self):
        self.victim = create_test_user()
        self.attacker = create_test_user()
        self.day = datetime.date(2021, 3, 4)
        self.victim_day = AlbumDate.objects.create(
            owner=self.victim,
            date=self.day,
            location={"places": [SECRET_PLACE]},
        )
        self.victim_day.photos.add(create_test_photo(owner=self.victim))
        self.url = f"/api/albums/date/{self.victim_day.id}/"

    def client_for(self, user=None):
        client = APIClient()
        client.raise_request_exception = False
        if user is not None:
            client.force_authenticate(user=user)
        return client

    def assert_not_found_without_leak(self, response):
        self.assertEqual(response.status_code, 404)
        body = response.content.decode()
        self.assertNotIn(SECRET_PLACE, body)
        self.assertNotIn(self.day.isoformat(), body)

    def test_other_user_cannot_read_a_foreign_day_album(self):
        response = self.client_for(self.attacker).get(self.url)

        self.assert_not_found_without_leak(response)

    def test_public_flag_does_not_open_a_day_without_public_photos(self):
        for user in (self.attacker, None):
            for params in ({"public": "1"}, {"public": "1", "username": "x"}):
                with self.subTest(user=user, params=params):
                    response = self.client_for(user).get(self.url, params)

                    self.assert_not_found_without_leak(response)

    def test_public_username_must_match_the_day_owner(self):
        public = create_test_photo(owner=self.victim, public=True)
        self.victim_day.photos.add(public)

        response = self.client_for().get(
            self.url, {"public": "1", "username": self.attacker.username}
        )

        self.assert_not_found_without_leak(response)

    def test_unknown_id_is_a_404_not_a_500(self):
        response = self.client_for(self.attacker).get("/api/albums/date/999999/")

        self.assertEqual(response.status_code, 404)

    def test_owner_still_reads_their_own_day(self):
        response = self.client_for(self.victim).get(self.url)

        self.assertEqual(response.status_code, 200)
        results = response.json()["results"]
        self.assertEqual(results["location"], SECRET_PLACE)
        self.assertEqual(results["numberOfItems"], 1)

    def test_public_day_with_a_public_photo_stays_readable(self):
        public = create_test_photo(owner=self.victim, public=True)
        self.victim_day.photos.add(public)

        for params in (
            {"public": "1"},
            {"public": "1", "username": self.victim.username},
        ):
            with self.subTest(params=params):
                response = self.client_for().get(self.url, params)

                self.assertEqual(response.status_code, 200)
                items = response.json()["results"]["items"]
                self.assertEqual([i["id"] for i in items], [str(public.pk)])
