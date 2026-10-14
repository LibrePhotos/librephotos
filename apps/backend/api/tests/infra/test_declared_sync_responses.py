"""The delta-sync feeds answer what openapi.json declares.

The sync views (``api/views/sync.py``) build their rows by hand
(``serialize_*_row``) and the response serializers in
``api/serializers/sync_responses.py`` only describe them. Each test pulls a
feed over a library that fills both branches of every nullable field, as a
seed pull (with ``total``) and as a pull from a cursor (with tombstones), and
validates the body against the committed schema. Issue #485.
"""

import datetime
import uuid
from typing import Any

from django.utils import timezone
from rest_framework.test import APIClient

from api.models import DeletionLog, File, User
from api.tests.infra.test_declared_responses import DeclaredResponseTestCase
from api.tests.utils import (
    create_test_album_auto,
    create_test_album_place,
    create_test_album_thing,
    create_test_album_user,
    create_test_face,
    create_test_file,
    create_test_person,
    create_test_photo,
    create_test_tag,
    create_test_user,
)
from api.views.sync import encode_cursor

# Feed path -> the DeletionLog entity its tombstones come from (None: none).
FEEDS = {
    "/api/sync/photos/": DeletionLog.ENTITY_PHOTO,
    "/api/sync/persons/": DeletionLog.ENTITY_PERSON,
    "/api/sync/albums/user/": DeletionLog.ENTITY_ALBUM_USER,
    "/api/sync/albums/auto/": DeletionLog.ENTITY_ALBUM_AUTO,
    "/api/sync/albums/thing/": DeletionLog.ENTITY_ALBUM_THING,
    "/api/sync/albums/place/": DeletionLog.ENTITY_ALBUM_PLACE,
    "/api/sync/albums/tag/": DeletionLog.ENTITY_TAG,
    "/api/sync/sharing/": None,
}


def fill_library(user: User, friend: User) -> None:
    """Rows for every feed, with and without each optional value."""
    favorite = create_test_photo(
        owner=user,
        rating=5,
        exif_timestamp=timezone.now(),
        gps_lat=52.5,
        gps_lon=13.4,
        search_location="Berlin",
        dominant_color="[12, 34, 56]",
    )
    video = create_test_photo(owner=user, video=True, video_length="12.5")
    motion = create_test_photo(owner=user)
    motion.main_file.embedded_media.add(create_test_file(None, user))
    undated = create_test_photo(owner=user, aspect_ratio=None)
    shared_to_me = create_test_photo(owner=friend)
    shared_to_me.shared_to.add(user)

    # A cover chosen, a cover from the first face, and neither.
    create_test_person(name="Chosen", cluster_owner=user, cover_photo=favorite)
    faced = create_test_person(name="Faced", cluster_owner=user)
    create_test_face(photo=video, person=faced)
    create_test_person(name="Faceless", cluster_owner=user)

    album = create_test_album_user(user, cover_photo=favorite, favorited=True)
    album.photos.add(favorite, video)
    album.shared_to.add(friend)
    create_test_album_user(user)

    event = create_test_album_auto(user)
    event.photos.add(motion, undated)
    create_test_album_auto(user)

    thing = create_test_album_thing(user, photo_count=1)
    thing.cover_photos.add(favorite)
    create_test_album_thing(user)
    place = create_test_album_place(user, geolocation_level=2)
    place.photos.add(favorite)
    create_test_album_place(user)
    create_test_tag(user, photo_count=3)
    create_test_tag(user)

    User.objects.filter(pk=friend.pk).update(avatar="avatars/friend.png")
    stranger = create_test_user()
    stranger_photo = create_test_photo(owner=stranger)
    stranger_photo.shared_to.add(user)


class SyncFeedResponsesTest(DeclaredResponseTestCase):
    def setUp(self) -> None:
        self.client = APIClient()
        self.user = create_test_user(favorite_min_rating=4)
        self.client.force_authenticate(user=self.user)
        self.friend = create_test_user(first_name="", last_name="")
        fill_library(self.user, self.friend)

    def pull(self, path: str, **params: object) -> Any:
        query = "&".join(f"{key}={value}" for key, value in params.items())
        return self.assert_declared(path, f"{path}?{query}")

    def test_a_seed_pull_of_every_feed(self) -> None:
        for path in FEEDS:
            with self.subTest(path=path):
                body = self.pull(path)
                self.assertGreaterEqual(len(body["items"]), 2)
                self.assertEqual(body["total"], len(body["items"]))
                self.assertIsNotNone(body["next_cursor"])

    def test_a_pull_from_a_cursor_with_tombstones(self) -> None:
        for entity in FEEDS.values():
            if entity is not None:
                DeletionLog.objects.create(
                    entity=entity, entity_id="12", owner=self.user
                )
        for path, entity in FEEDS.items():
            with self.subTest(path=path):
                first = self.pull(path, page_size=1)
                self.assertEqual(1, len(first["items"]))
                nxt = self.pull(path, cursor=first["next_cursor"])
                self.assertNotIn("total", nxt)
                self.assertEqual(["12"] if entity else [], nxt["tombstones"])
        # Past the last row: no items, and the loop ends.
        tomorrow = timezone.now() + datetime.timedelta(days=1)
        last = self.pull(
            "/api/sync/photos/", cursor=encode_cursor(tomorrow, uuid.UUID(int=0))
        )
        self.assertEqual(([], None), (last["items"], last["next_cursor"]))

    def test_counts(self) -> None:
        counts = self.assert_declared("/api/sync/counts/", "/api/sync/counts/")
        self.assertEqual(6, counts["photos"])

    def test_the_photo_rows_fill_every_branch(self) -> None:
        items = self.pull("/api/sync/photos/")["items"]
        self.assertEqual(
            {"image", "video", "motion"},
            {item["type"] for item in items},
        )
        self.assertTrue(File.objects.filter(embedded_media__isnull=False).exists())
