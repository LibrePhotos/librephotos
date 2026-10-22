"""The sharing views answer what openapi.json declares.

Album and photo links (``api/views/public_albums.py``,
``api/views/public_photos.py``) and sharing an album with a user
(``api/views/sharing.py``) build their answers as dicts, and the serializers in
``api/serializers/public_share.py`` only describe them. The public answers are
what an anonymous visitor gets, so each is called with every sharing setting
off and on, over photos that fill every field the settings gate: the schema
must match both, and declare no key the visitor does not get. Issue #485.
"""

import datetime
from typing import Any

from rest_framework.test import APIClient

from api.serializers.public_share import HASH_DERIVED_FIELDS
from api.tests.infra.test_declared_responses import DeclaredResponseTestCase
from api.tests.openapi_responses import declared_schema
from api.tests.utils import (
    create_test_album_user,
    create_test_face,
    create_test_person,
    create_test_photo,
    create_test_user,
)

TAKEN = datetime.datetime(2021, 6, 5, 14, 30, tzinfo=datetime.UTC)
SETTINGS = (
    "share_location",
    "share_camera_info",
    "share_timestamps",
    "share_captions",
    "share_faces",
)


def every_setting(value: bool) -> dict[str, bool]:
    return dict.fromkeys(SETTINGS, value)


def filled_photo(owner: Any, **fields: Any) -> Any:
    """A photo with every field a sharing setting gates, and a named face."""
    photo = create_test_photo(
        owner=owner,
        exif_timestamp=TAKEN,
        exif_gps_lat=52.52,
        exif_gps_lon=13.40,
        geolocation_json={"features": [{"text": "Berlin"}]},
        search_location="Berlin",
        search_captions="a dog on a beach",
        captions_json={"im2txt": "a dog on a beach"},
        camera="X100V",
        lens="23mm",
        focal_length=23.0,
        fstop=2.0,
        iso=200,
        shutter_speed="1/250",
        width=4000,
        height=3000,
        **fields,
    )
    create_test_face(photo=photo, person=create_test_person(name="Alice"))
    create_test_face(photo=photo, person=create_test_person(name="Bob"), image=None)
    return photo


class SharingResponseTestCase(DeclaredResponseTestCase):
    def assert_public(self, path: str, url: str) -> Any:
        """``assert_declared`` as an anonymous visitor holding the link."""
        own_client = self.client
        self.client = APIClient()
        try:
            return self.assert_declared(path, url)
        finally:
            self.client = own_client


class AlbumLinkResponsesTest(SharingResponseTestCase):
    """Album links: making one, the album page and a photo of it."""

    def setUp(self) -> None:
        self.owner = create_test_user()
        self.album = create_test_album_user(owner=self.owner)
        self.dated = filled_photo(self.owner)
        # Undated, without GPS, metadata, captions or faces.
        self.bare = create_test_photo(owner=self.owner)
        self.album.photos.add(self.dated, self.bare)
        self.client = APIClient()
        self.client.force_authenticate(user=self.owner)

    def publish(self, **options: bool) -> str:
        path = "/api/useralbum/makepublic/"
        body = self.assert_declared(
            path,
            path,
            method="post",
            data={
                "album_id": self.album.id,
                "val_public": True,
                "sharing_options": options,
            },
        )
        return str(body["album"]["public_slug"])

    def test_make_public_and_revoke(self) -> None:
        path = "/api/useralbum/makepublic/"
        self.publish(share_location=True, share_faces=None)
        body = self.assert_declared(
            path,
            path,
            method="post",
            data={"album_id": self.album.id, "val_public": False},
        )
        self.assertFalse(body["album"]["public"])

    def test_the_album_page_with_every_setting(self) -> None:
        for shared in (False, True):
            with self.subTest(shared=shared):
                slug = self.publish(**every_setting(shared))
                body = self.assert_public(
                    "/api/public/albums/s/{slug}/", f"/api/public/albums/s/{slug}/"
                )
                self.assertEqual(every_setting(shared), body["sharing_settings"])
                items = [
                    item
                    for group in body["results"]["grouped_photos"]
                    for item in group["items"]
                ]
                self.assertEqual(2, len(items))

    def test_a_photo_of_the_album_with_every_setting(self) -> None:
        path = "/api/public/albums/s/{slug}/photos/{photo_id}/"
        for shared in (False, True):
            slug = self.publish(**every_setting(shared))
            for photo in (self.dated, self.bare):
                for key in (str(photo.id), photo.image_hash):
                    with self.subTest(shared=shared, photo=photo.pk, key=key):
                        body = self.assert_public(
                            path, f"/api/public/albums/s/{slug}/photos/{key}/"
                        )
                        people = body["results"]["people"]
                        expected = 2 if shared and photo == self.dated else 0
                        self.assertEqual(expected, len(people))

    def test_owner_defaults_reach_the_settings(self) -> None:
        self.owner.public_sharing_defaults = every_setting(True)
        self.owner.save()
        slug = self.publish()
        body = self.assert_public(
            "/api/public/albums/s/{slug}/", f"/api/public/albums/s/{slug}/"
        )
        self.assertEqual(every_setting(True), body["sharing_settings"])

    def test_sharing_with_a_user(self) -> None:
        path = "/api/useralbum/share/"
        friend = create_test_user()
        for shared in (True, False):
            with self.subTest(shared=shared):
                body = self.assert_declared(
                    path,
                    path,
                    method="post",
                    data={
                        "shared": shared,
                        "target_user_id": friend.id,
                        "album_id": self.album.id,
                    },
                )
                self.assertEqual(1 if shared else 0, len(body["shared_to"]))


class PhotoLinkResponsesTest(SharingResponseTestCase):
    """Photo links: making, rotating and revoking one, the list, the page."""

    def setUp(self) -> None:
        self.owner = create_test_user()
        self.photo = filled_photo(self.owner)
        self.video = create_test_photo(
            owner=self.owner,
            video=True,
            video_codec="h264",
            video_pixel_format="yuv420p",
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.owner)

    def act(self, photo: Any, action: str) -> dict[str, Any]:
        path = "/api/photo/share/"
        body: dict[str, Any] = self.assert_declared(
            path,
            path,
            method="post",
            data={"photo_id": str(photo.pk), "action": action},
        )
        return body

    def test_enable_rotate_disable(self) -> None:
        enabled = self.act(self.photo, "enable")["share"]
        rotated = self.act(self.photo, "rotate")["share"]
        disabled = self.act(self.photo, "disable")["share"]
        self.assertNotEqual(enabled["slug"], rotated["slug"])
        self.assertEqual({"enabled": False, "slug": None, "url": None}, disabled)

    def test_the_list_of_links(self) -> None:
        path = "/api/photo/share/list/"
        empty = self.assert_declared(path, path)
        self.act(self.photo, "enable")
        self.act(self.video, "enable")
        listed = self.assert_declared(path, path)
        self.assertEqual([], empty["results"])
        self.assertEqual(2, len(listed["results"]))

    def test_the_page_with_every_setting(self) -> None:
        path = "/api/public/photo/{slug}/"
        for shared in (False, True):
            self.owner.public_sharing_defaults = every_setting(shared)
            self.owner.save()
            for photo in (self.photo, self.video):
                slug = self.act(photo, "enable")["share"]["slug"]
                with self.subTest(shared=shared, video=photo.video):
                    body = self.assert_public(path, f"/api/public/photo/{slug}/")
                    results = body["results"]
                    self.assertEqual(every_setting(shared), body["sharing_settings"])
                    for field in HASH_DERIVED_FIELDS:
                        self.assertNotIn(field, results)
                    self.assertEqual(photo.video, results["video_url"] is not None)

    def test_the_media_route_is_a_file(self) -> None:
        slug = self.act(self.photo, "enable")["share"]["slug"]
        response = APIClient().get(f"/api/public/photo/{slug}/media/thumbnail/")
        self.assertEqual(200, response.status_code)
        self.assertEqual(
            {"type": "string", "format": "binary"},
            declared_schema(
                "/api/public/photo/{slug}/media/{kind}/", "get", 200, "*/*"
            ),
        )
