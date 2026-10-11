"""``/api/albums/date/`` only serves ``retrieve``.

``AlbumDateViewSet`` was a ``ModelViewSet`` without a queryset, so every
other verb the router wired up (list, create, update, destroy) reached
``get_queryset`` or saved an empty serializer and failed with a 500. The
clients only ever ``GET /api/albums/date/<id>/``; the day list lives at
``/api/albums/date/list/``.
"""

import datetime

from django.test import TestCase
from rest_framework.test import APIClient

from api.models import AlbumDate
from api.tests.utils import create_test_album_date, create_test_photo, create_test_user


class AlbumDateRetrieveOnlyTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.raise_request_exception = False
        self.client.force_authenticate(user=self.user)
        self.album = create_test_album_date(
            owner=self.user, date=datetime.date(2021, 3, 4)
        )
        self.album.photos.add(create_test_photo(owner=self.user))
        self.url = f"/api/albums/date/{self.album.id}/"

    def test_retrieve_still_works(self):
        response = self.client.get(self.url)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["results"]["id"], str(self.album.id))

    def test_writes_on_a_day_album_are_not_allowed(self):
        for method in ("put", "patch", "delete"):
            with self.subTest(method=method):
                response = getattr(self.client, method)(self.url, {}, format="json")
                self.assertEqual(response.status_code, 405)
        self.assertTrue(AlbumDate.objects.filter(pk=self.album.pk).exists())

    def test_the_collection_route_is_gone(self):
        albums_before = AlbumDate.objects.count()
        for method in ("get", "post"):
            with self.subTest(method=method):
                response = getattr(self.client, method)(
                    "/api/albums/date/", {}, format="json"
                )
                self.assertIn(response.status_code, (404, 405))
        self.assertEqual(AlbumDate.objects.count(), albums_before)
