"""Album ids go out as numbers, like every other integer key (issue #389).

The date, user, thing and place album serializers overrode ``id`` with a
method returning ``str(obj.id)``, so the same album came back as ``12`` from
one endpoint (the album lists) and as ``"12"`` from another (the day list,
the album details). A typed client then
compared ``12`` with ``"12"`` and missed. The clients read both forms
(``IntegerId`` in packages/api-client), so older servers keep working.
``api/tests/infra/test_integer_primary_keys.py`` keeps a new serializer from
doing it again.
"""

import datetime

from django.test import TestCase
from rest_framework.test import APIClient

from api.tests.utils import (
    create_test_album_place,
    create_test_album_thing,
    create_test_album_user,
    create_test_photo,
    create_test_user,
)


class AlbumIdsAreNumbersTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.photo = create_test_photo(owner=self.user)

    def assertIsNumberId(self, value, expected):
        self.assertIs(type(value), int, repr(value))
        self.assertEqual(value, expected)

    def test_day_list_and_layout(self):
        self.photo.exif_timestamp = datetime.datetime(
            2021, 3, 4, 12, tzinfo=datetime.UTC
        )
        self.photo.save()

        days = self.client.get("/api/days/").json()["results"]
        self.assertEqual(len(days), 1)
        self.assertIsNumberId(days[0]["id"], 20210304)

        layout = self.client.get("/api/days/20210304/layout/").json()
        self.assertIsNumberId(layout["id"], 20210304)

    def test_user_album_detail_private_and_public(self):
        album = create_test_album_user(owner=self.user, title="holiday")
        album.photos.add(self.photo)
        made_public = self.client.post(
            "/api/useralbum/makepublic/",
            {"album_id": album.id, "val_public": True},
            format="json",
        ).json()["album"]
        self.assertIsNumberId(made_public["id"], album.id)

        detail = self.client.get(f"/api/albums/user/{album.id}/").json()
        self.assertIsNumberId(detail["id"], album.id)

        anonymous = APIClient()
        slug = made_public["public_slug"]
        public = anonymous.get(
            f"/api/albums/user/{album.id}/?public=true&slug={slug}"
        ).json()
        self.assertIsNumberId(public["id"], album.id)
        by_slug = anonymous.get(f"/api/public/albums/s/{slug}/").json()
        self.assertIsNumberId(by_slug["results"]["id"], album.id)

    def test_thing_and_place_album_details(self):
        thing = create_test_album_thing(owner=self.user, thing_type="hashtag_attribute")
        thing.photos.add(self.photo)
        place = create_test_album_place(owner=self.user)
        place.photos.add(self.photo)

        thing_detail = self.client.get(f"/api/albums/thing/{thing.id}/").json()
        self.assertIsNumberId(thing_detail["results"]["id"], thing.id)
        place_detail = self.client.get(f"/api/albums/place/{place.id}/").json()
        self.assertIsNumberId(place_detail["results"]["id"], place.id)
