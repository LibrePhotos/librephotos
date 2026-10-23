"""The album views read their query strings through serializers (#2326).

``/api/albums/date/list/``, ``/api/albums/date/<id>/`` and
``/api/albums/user/<id>/`` used to read every parameter by truthiness:
``?public=false`` opened the public view, ``?person=abc`` and a malformed
``?last_modified`` crashed with a 500. Well-formed input still behaves as
before (the spellings the clients send, blank parameters ignored, the owner
and public scopes); a false word is now false, and a malformed value is a 400
naming the parameter.
"""

import datetime

from django.test import TestCase
from django.utils import timezone
from drf_spectacular.generators import SchemaGenerator
from rest_framework.test import APIClient

from api.models.album_user_share import AlbumUserShare
from api.tests.utils import (
    create_test_album_date,
    create_test_album_user,
    create_test_face,
    create_test_person,
    create_test_photo,
    create_test_user,
)

LIST_URL = "/api/albums/date/list/"


def error_fields(response) -> list[str]:
    return [error["field"] for error in response.json()["errors"]]


class DateAlbumQueryTest(TestCase):
    def setUp(self):
        self.owner = create_test_user(public_sharing=True)
        self.taken = timezone.now()
        self.day = create_test_album_date(owner=self.owner, date=self.taken.date())
        self.public_photo = self._photo(public=True)
        self.private_photo = self._photo()
        self.hidden_photo = self._photo(hidden=True)
        self.trashed_photo = self._photo(in_trashcan=True)
        self.person = create_test_person(cluster_owner=self.owner)
        create_test_face(photo=self.private_photo, person=self.person)

        self.anonymous = APIClient()
        self.signed_in = APIClient()
        self.signed_in.force_authenticate(user=self.owner)
        self.detail_url = f"/api/albums/date/{self.day.id}/"

    def _photo(self, **kwargs):
        photo = create_test_photo(owner=self.owner, exif_timestamp=self.taken, **kwargs)
        self.day.photos.add(photo)
        return photo

    def _list(self, client, params):
        response = client.get(LIST_URL, params)
        self.assertEqual(200, response.status_code, response.content)
        return {day["id"]: day["numberOfItems"] for day in response.json()["results"]}

    def _items(self, client, params):
        response = client.get(self.detail_url, params)
        self.assertEqual(200, response.status_code, response.content)
        return {item["id"] for item in response.json()["results"]["items"]}

    def _ids(self, *photos):
        return {str(photo.id) for photo in photos}

    # --- well-formed input, as before ------------------------------------

    def test_the_spellings_clients_send_open_the_public_view(self):
        for value in ("true", "True", "1", "yes", "on"):
            with self.subTest(public=value):
                params = {"public": value}
                self.assertEqual({self.day.id: 1}, self._list(self.anonymous, params))
                self.assertEqual(
                    self._ids(self.public_photo), self._items(self.anonymous, params)
                )

    def test_public_with_username_keeps_the_owner_scope(self):
        other = create_test_user()
        for username, expected in ((self.owner.username, 1), (other.username, None)):
            with self.subTest(username=username):
                params = {"public": "true", "username": username}
                listed = self._list(self.anonymous, params)
                self.assertEqual(expected, listed.get(self.day.id))

    def test_no_parameters_is_the_owners_view(self):
        self.assertEqual({self.day.id: 2}, self._list(self.signed_in, {}))
        self.assertEqual(
            self._ids(self.public_photo, self.private_photo),
            self._items(self.signed_in, {}),
        )

    def test_blank_parameters_are_ignored(self):
        params = {
            name: ""
            for name in (
                "public",
                "username",
                "hidden",
                "in_trashcan",
                "show_all_stack_photos",
                "folder",
                "person",
                "last_modified",
            )
        }
        self.assertEqual({self.day.id: 2}, self._list(self.signed_in, params))
        self.assertEqual(
            self._ids(self.public_photo, self.private_photo),
            self._items(self.signed_in, params),
        )
        self.assertEqual(401, self.anonymous.get(LIST_URL, {"public": ""}).status_code)

    def test_hidden_and_trash_flags(self):
        for flag, photo in (
            ("hidden", self.hidden_photo),
            ("in_trashcan", self.trashed_photo),
        ):
            with self.subTest(flag=flag):
                params = {flag: "true"}
                self.assertEqual({self.day.id: 1}, self._list(self.signed_in, params))
                self.assertEqual(self._ids(photo), self._items(self.signed_in, params))

    def test_person_filter(self):
        params = {"person": str(self.person.id)}
        self.assertEqual({self.day.id: 1}, self._list(self.signed_in, params))
        self.assertEqual(
            self._ids(self.private_photo), self._items(self.signed_in, params)
        )

    def test_last_modified_takes_a_date_or_a_date_time(self):
        yesterday = self.taken - datetime.timedelta(days=1)
        tomorrow = self.taken + datetime.timedelta(days=1)
        every_photo = self._ids(
            self.public_photo, self.private_photo, self.hidden_photo, self.trashed_photo
        )
        for since in (
            yesterday.date().isoformat(),
            yesterday.strftime("%Y-%m-%dT%H:%M:%SZ"),
            yesterday.isoformat(),
        ):
            with self.subTest(last_modified=since):
                params = {"last_modified": since}
                # The owner shortcut drops the hidden and trash filters.
                self.assertEqual({self.day.id: 4}, self._list(self.signed_in, params))
                self.assertEqual(every_photo, self._items(self.signed_in, params))
        params = {"last_modified": tomorrow.date().isoformat()}
        self.assertEqual({}, self._list(self.signed_in, params))
        self.assertEqual(set(), self._items(self.signed_in, params))

    # --- false words are false ------------------------------------------

    def test_a_false_public_is_the_owners_view(self):
        for value in ("false", "False", "0", "no", "off"):
            with self.subTest(public=value):
                params = {"public": value}
                self.assertEqual({self.day.id: 2}, self._list(self.signed_in, params))
                self.assertEqual(
                    self._ids(self.public_photo, self.private_photo),
                    self._items(self.signed_in, params),
                )
                self.assertEqual(401, self.anonymous.get(LIST_URL, params).status_code)
                self.assertEqual(
                    401, self.anonymous.get(self.detail_url, params).status_code
                )

    def test_a_false_hidden_or_trash_flag_is_the_default_view(self):
        for flag in ("hidden", "in_trashcan"):
            with self.subTest(flag=flag):
                params = {flag: "false"}
                self.assertEqual({self.day.id: 2}, self._list(self.signed_in, params))
                self.assertEqual(
                    self._ids(self.public_photo, self.private_photo),
                    self._items(self.signed_in, params),
                )

    # --- malformed input is a 400 -----------------------------------------

    def test_malformed_values_are_a_400_naming_the_parameter(self):
        for params, field in (
            ({"person": "abc"}, "person"),
            ({"last_modified": "yesterday"}, "last_modified"),
            ({"last_modified": "2024-13-45"}, "last_modified"),
            ({"hidden": "maybe"}, "hidden"),
            ({"in_trashcan": "maybe"}, "in_trashcan"),
            ({"show_all_stack_photos": "maybe"}, "show_all_stack_photos"),
            ({"public": "maybe"}, "public"),
        ):
            for url in (LIST_URL, self.detail_url):
                with self.subTest(url=url, params=params):
                    response = self.signed_in.get(url, params)
                    self.assertEqual(400, response.status_code, response.content)
                    self.assertEqual([field], error_fields(response))

    def test_a_malformed_public_flag_is_a_400_for_anonymous_callers_too(self):
        for url in (LIST_URL, self.detail_url):
            with self.subTest(url=url):
                response = self.anonymous.get(url, {"public": "maybe"})
                self.assertEqual(400, response.status_code)
                self.assertEqual(["public"], error_fields(response))

    def test_anonymous_callers_without_public_are_refused_before_validation(self):
        response = self.anonymous.get(LIST_URL, {"person": "abc"})
        self.assertEqual(401, response.status_code)


class UserAlbumPublicQueryTest(TestCase):
    def setUp(self):
        self.owner = create_test_user(public_sharing=True)
        self.album = create_test_album_user(owner=self.owner)
        self.slug = AlbumUserShare.objects.create(album=self.album, enabled=True).slug
        self.url = f"/api/albums/user/{self.album.id}/"
        self.anonymous = APIClient()
        self.signed_in = APIClient()
        self.signed_in.force_authenticate(user=self.owner)

    def test_public_spellings_open_the_public_link(self):
        for value in ("true", "1"):
            with self.subTest(public=value):
                response = self.anonymous.get(
                    self.url, {"public": value, "slug": self.slug}
                )
                self.assertEqual(200, response.status_code)

    def test_public_with_another_username_finds_nothing(self):
        other = create_test_user()
        response = self.anonymous.get(
            self.url, {"public": "true", "username": other.username, "slug": self.slug}
        )
        self.assertEqual(404, response.status_code)

    def test_a_false_public_is_the_signed_in_view(self):
        self.assertEqual(
            401, self.anonymous.get(self.url, {"public": "false"}).status_code
        )
        response = self.signed_in.get(self.url, {"public": "false"})
        self.assertEqual(200, response.status_code)
        self.assertEqual(self.album.id, response.json()["id"])

    def test_a_malformed_public_flag_is_a_400(self):
        response = self.anonymous.get(self.url, {"public": "maybe"})
        self.assertEqual(400, response.status_code)
        self.assertEqual(["public"], error_fields(response))

    def test_writes_ignore_the_public_flag(self):
        # ?public only ever opened the read; a write is the owner's, whatever
        # the flag says, and is not parsed for it.
        response = self.anonymous.patch(
            f"{self.url}?public=maybe", {"title": "x"}, format="json"
        )
        self.assertEqual(401, response.status_code)


class DateAlbumQuerySchemaTest(TestCase):
    def test_the_date_endpoints_document_their_query_serializers(self):
        schema = SchemaGenerator().get_schema(request=None, public=True)
        for path in ("/api/albums/date/list/", "/api/albums/date/{id}/"):
            with self.subTest(path=path):
                parameters = {
                    parameter["name"]: parameter["schema"]
                    for parameter in schema["paths"][path]["get"]["parameters"]
                    if parameter["in"] == "query"
                }
                self.assertEqual("integer", parameters["person"]["type"])
                self.assertEqual("date-time", parameters["last_modified"]["format"])
                self.assertEqual("boolean", parameters["public"]["type"])
