"""``last_modified`` on the public timeline stays scoped to public photos.

``/api/albums/date/list/`` and ``/api/albums/date/<id>/`` are open to anonymous
callers with ``?public``. Their ``last_modified`` branch threw every other
filter away and kept only "owned by the requesting user". Anonymously that
filtered on ``owner=AnonymousUser`` and crashed with a 500; signed in, the
public view of another user's photos turned into the caller's own (private)
timeline. With ``public`` set, ``last_modified`` now only narrows the public
scope; the owner shortcut stays for signed-in, non-public requests.
"""

import datetime

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from api.models import Photo
from api.tests.utils import create_test_album_date, create_test_photo, create_test_user


class AlbumDatePublicLastModifiedTest(TestCase):
    def setUp(self):
        self.owner = create_test_user(public_sharing=True)
        self.viewer = create_test_user()
        self.taken = timezone.now()
        self.day = create_test_album_date(owner=self.owner, date=self.taken.date())
        self.public_photo = self._photo(self.day, public=True)
        self.private_photo = self._photo(self.day, public=False)
        # A day of the owner's holding nothing public.
        self.private_day = create_test_album_date(
            owner=self.owner, date=(self.taken - datetime.timedelta(days=3)).date()
        )
        self._photo(self.private_day, public=False)
        # The signed-in viewer's own private day.
        self.viewer_day = create_test_album_date(
            owner=self.viewer, date=self.taken.date()
        )
        self._photo(self.viewer_day, owner=self.viewer, public=False)

        self.past = (self.taken - datetime.timedelta(days=1)).isoformat()
        self.future = (self.taken + datetime.timedelta(days=1)).isoformat()
        self.anonymous = APIClient()
        self.signed_in = APIClient()
        self.signed_in.force_authenticate(user=self.viewer)

    def _photo(self, day, owner=None, **kwargs):
        photo = create_test_photo(
            owner=owner or day.owner, exif_timestamp=self.taken, **kwargs
        )
        day.photos.add(photo)
        return photo

    def _list(self, client, **params):
        response = client.get("/api/albums/date/list/", {"public": "1", **params})
        self.assertEqual(200, response.status_code, response.content)
        return {day["id"]: day["numberOfItems"] for day in response.json()["results"]}

    def _detail_items(self, client, **params):
        response = client.get(
            f"/api/albums/date/{self.day.id}/", {"public": "1", **params}
        )
        self.assertEqual(200, response.status_code, response.content)
        return [item["id"] for item in response.json()["results"]["items"]]

    def test_anonymous_list_returns_only_public_days(self):
        for params in ({"username": self.owner.username}, {}):
            with self.subTest(params=params):
                listed = self._list(self.anonymous, last_modified=self.past, **params)
                self.assertEqual({str(self.day.id): 1}, listed)

    def test_anonymous_list_honors_last_modified(self):
        Photo.objects.filter(pk=self.public_photo.pk).update(
            last_modified=self.taken - datetime.timedelta(days=2)
        )
        listed = self._list(
            self.anonymous, username=self.owner.username, last_modified=self.past
        )
        self.assertEqual({}, listed)

    def test_anonymous_detail_returns_only_public_photos(self):
        for params in ({"username": self.owner.username}, {}):
            with self.subTest(params=params):
                items = self._detail_items(
                    self.anonymous, last_modified=self.past, **params
                )
                self.assertEqual([str(self.public_photo.id)], items)

    def test_anonymous_detail_honors_last_modified(self):
        items = self._detail_items(
            self.anonymous, username=self.owner.username, last_modified=self.future
        )
        self.assertEqual([], items)

    def test_signed_in_public_view_shows_the_owners_public_photos_only(self):
        listed = self._list(
            self.signed_in, username=self.owner.username, last_modified=self.past
        )
        self.assertEqual({str(self.day.id): 1}, listed)
        items = self._detail_items(
            self.signed_in, username=self.owner.username, last_modified=self.past
        )
        self.assertEqual([str(self.public_photo.id)], items)

    def test_owner_without_public_still_gets_every_own_photo(self):
        client = APIClient()
        client.force_authenticate(user=self.owner)

        response = client.get(
            "/api/albums/date/list/", {"last_modified": self.past}
        ).json()["results"]
        self.assertEqual(
            {str(self.day.id): 2, str(self.private_day.id): 1},
            {day["id"]: day["numberOfItems"] for day in response},
        )
        items = client.get(
            f"/api/albums/date/{self.day.id}/", {"last_modified": self.past}
        ).json()["results"]["items"]
        self.assertEqual(
            {str(self.public_photo.id), str(self.private_photo.id)},
            {item["id"] for item in items},
        )

    def test_anonymous_without_public_is_refused(self):
        response = self.anonymous.get(
            "/api/albums/date/list/", {"last_modified": self.past}
        )
        self.assertEqual(401, response.status_code)
