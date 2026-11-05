"""The album and day views read their query strings through serializers (#2326).

``/api/days/``, ``/api/days/<id>/photos/`` and ``/api/albums/user/<id>/``
used to read every parameter by truthiness: ``?public=false`` opened the
public view and ``?person=abc`` crashed with a 500. Well-formed input still
behaves as before (the spellings the clients send, blank parameters ignored,
the owner and public scopes); a false word is now false, and a malformed
value is a 400 naming the parameter.
"""

from django.test import TestCase
from django.utils import timezone
from drf_spectacular.generators import SchemaGenerator
from rest_framework.test import APIClient

from api.models.album_user_share import AlbumUserShare
from api.tests.utils import (
    create_test_album_user,
    create_test_face,
    create_test_person,
    create_test_photo,
    create_test_user,
    every_public_switch_on,
)
from api.timeline.days import taken_day_id

LIST_URL = "/api/days/"


def error_fields(response) -> list[str]:
    return [error["field"] for error in response.json()["errors"]]


class DayQueryTest(TestCase):
    def setUp(self):
        # Dates shared, so the public view lists the photos under their day.
        self.owner = create_test_user(
            public_sharing=True, public_sharing_defaults=every_public_switch_on()
        )
        self.taken = timezone.now()
        self.day = taken_day_id(self.taken)
        self.public_photo = self._photo(public=True)
        self.private_photo = self._photo()
        self.hidden_photo = self._photo(hidden=True)
        self.trashed_photo = self._photo(in_trashcan=True)
        self.person = create_test_person(cluster_owner=self.owner)
        create_test_face(photo=self.private_photo, person=self.person)

        self.anonymous = APIClient()
        self.signed_in = APIClient()
        self.signed_in.force_authenticate(user=self.owner)
        self.detail_url = f"/api/days/{self.day}/photos/"
        self.layout_url = f"/api/days/{self.day}/layout/"

    def _photo(self, **kwargs):
        return create_test_photo(owner=self.owner, exif_timestamp=self.taken, **kwargs)

    def _list(self, client, params):
        response = client.get(LIST_URL, params)
        self.assertEqual(200, response.status_code, response.content)
        return {day["id"]: day["numberOfItems"] for day in response.json()["results"]}

    def _items(self, client, params):
        response = client.get(self.detail_url, params)
        self.assertEqual(200, response.status_code, response.content)
        return {item["id"] for item in response.json()["items"]}

    def _ids(self, *photos):
        return {str(photo.id) for photo in photos}

    # --- well-formed input, as before ------------------------------------

    def test_the_spellings_clients_send_open_the_public_view(self):
        for value in ("true", "True", "1", "yes", "on"):
            with self.subTest(public=value):
                params = {"public": value, "username": self.owner.username}
                self.assertEqual({self.day: 1}, self._list(self.anonymous, params))
                self.assertEqual(
                    self._ids(self.public_photo), self._items(self.anonymous, params)
                )

    def test_public_with_username_keeps_the_owner_scope(self):
        other = create_test_user(public_sharing=True)
        for username, expected in ((self.owner.username, 1), (other.username, None)):
            with self.subTest(username=username):
                params = {"public": "true", "username": username}
                listed = self._list(self.anonymous, params)
                self.assertEqual(expected, listed.get(self.day))

    def test_no_parameters_is_the_owners_view(self):
        self.assertEqual({self.day: 2}, self._list(self.signed_in, {}))
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
                "library",
                "after",
            )
        }
        self.assertEqual({self.day: 2}, self._list(self.signed_in, params))
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
                self.assertEqual({self.day: 1}, self._list(self.signed_in, params))
                self.assertEqual(self._ids(photo), self._items(self.signed_in, params))

    def test_person_filter(self):
        params = {"person": str(self.person.id)}
        self.assertEqual({self.day: 1}, self._list(self.signed_in, params))
        self.assertEqual(
            self._ids(self.private_photo), self._items(self.signed_in, params)
        )

    # --- false words are false ------------------------------------------

    def test_a_false_public_is_the_owners_view(self):
        for value in ("false", "False", "0", "no", "off"):
            with self.subTest(public=value):
                params = {"public": value}
                self.assertEqual({self.day: 2}, self._list(self.signed_in, params))
                self.assertEqual(
                    self._ids(self.public_photo, self.private_photo),
                    self._items(self.signed_in, params),
                )
                for url in (LIST_URL, self.detail_url, self.layout_url):
                    self.assertEqual(401, self.anonymous.get(url, params).status_code)

    def test_a_false_hidden_or_trash_flag_is_the_default_view(self):
        for flag in ("hidden", "in_trashcan"):
            with self.subTest(flag=flag):
                params = {flag: "false"}
                self.assertEqual({self.day: 2}, self._list(self.signed_in, params))
                self.assertEqual(
                    self._ids(self.public_photo, self.private_photo),
                    self._items(self.signed_in, params),
                )

    # --- malformed input is a 400 -----------------------------------------

    def test_malformed_values_are_a_400_naming_the_parameter(self):
        for params, field in (
            ({"person": "abc"}, "person"),
            ({"library": "abc"}, "library"),
            ({"hidden": "maybe"}, "hidden"),
            ({"in_trashcan": "maybe"}, "in_trashcan"),
            ({"show_all_stack_photos": "maybe"}, "show_all_stack_photos"),
            ({"libraries": "maybe"}, "libraries"),
            ({"public": "maybe"}, "public"),
            ({"order": "random"}, "order"),
        ):
            for url in (LIST_URL, self.detail_url, self.layout_url):
                with self.subTest(url=url, params=params):
                    response = self.signed_in.get(url, params)
                    self.assertEqual(400, response.status_code, response.content)
                    self.assertEqual([field], error_fields(response))

    def test_malformed_page_parameters_are_a_400(self):
        for params, field in (
            ({"after": "not-a-uuid"}, "after"),
            ({"limit": "x"}, "limit"),
        ):
            with self.subTest(params=params):
                response = self.signed_in.get(self.detail_url, params)
                self.assertEqual(400, response.status_code, response.content)
                self.assertEqual([field], error_fields(response))

    def test_a_malformed_public_flag_is_a_400_for_anonymous_callers_too(self):
        for url in (LIST_URL, self.detail_url, self.layout_url):
            with self.subTest(url=url):
                response = self.anonymous.get(url, {"public": "maybe"})
                self.assertEqual(400, response.status_code)
                self.assertEqual(["public"], error_fields(response))

    def test_anonymous_callers_without_public_are_refused_before_validation(self):
        for url in (LIST_URL, self.detail_url):
            with self.subTest(url=url):
                response = self.anonymous.get(url, {"person": "abc"})
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


class DayQuerySchemaTest(TestCase):
    def query_parameters(self, schema, path):
        return {
            parameter["name"]: parameter["schema"]
            for parameter in schema["paths"][path]["get"]["parameters"]
            if parameter["in"] == "query"
        }

    def test_the_day_endpoints_document_their_query_serializers(self):
        schema = SchemaGenerator().get_schema(request=None, public=True)
        for path in ("/api/days/", "/api/days/{id}/photos/", "/api/days/{id}/layout/"):
            with self.subTest(path=path):
                parameters = self.query_parameters(schema, path)
                self.assertEqual("integer", parameters["person"]["type"])
                self.assertEqual("boolean", parameters["public"]["type"])
                # Gone with the day albums: no client sent them.
                for gone in ("search", "last_modified", "page", "page_size"):
                    self.assertNotIn(gone, parameters)
        photos = self.query_parameters(schema, "/api/days/{id}/photos/")
        self.assertEqual("uuid", photos["after"]["format"])
        self.assertEqual(
            (1, 500), (photos["limit"]["minimum"], photos["limit"]["maximum"])
        )
