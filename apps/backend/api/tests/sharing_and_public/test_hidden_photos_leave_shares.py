"""Hiding, trashing or removing a photo takes it away from everyone but its owner.

Hiding or trashing a photo leaves ``Photo.shared_to`` and ``Photo.public`` as
they were, so a check on those alone kept serving it: the original file and
its thumbnails, its summary and albums, and its row and GPS position in the
recipient's mobile sync feed. The sync feed also ignored the owner's library
share switches, which every other response follows. The photo's own owner
still gets all of it.
"""

import datetime

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from api.models import Photo
from api.models.photo_stack import PhotoStack
from api.serializers.sync import PHOTO_ROW_FIELDS
from api.tests.test_sync_api import sync_pull
from api.tests.utils import (
    create_test_album_auto,
    create_test_album_user,
    create_test_library_share,
    create_test_photo,
    create_test_stack,
    create_test_user,
)

NOON = timezone.make_aware(datetime.datetime(2025, 10, 18, 12, 0))
SYNC_PHOTOS = "/api/sync/photos/"
STATES = (
    {"hidden": True},
    {"in_trashcan": True},
    {"removed": True},
)


def api_client(user):
    client = APIClient()
    if user is not None:
        client.force_authenticate(user=user)
    return client


def media_client(user):
    """The media view reads the ``jwt`` cookie, so force_authenticate is not enough."""
    client = APIClient()
    if user is not None:
        client.cookies["jwt"] = str(RefreshToken.for_user(user).access_token)
    return client


def set_state(photo, **state):
    Photo.objects.filter(pk=photo.pk).update(last_modified=timezone.now(), **state)


class DirectShareFixture(TestCase):
    def setUp(self):
        self.owner = create_test_user(favorite_min_rating=4)
        self.recipient = create_test_user()
        self.photo = create_test_photo(
            owner=self.owner,
            exif_timestamp=NOON,
            exif_gps_lat=47.99,
            exif_gps_lon=11.34,
            search_location="Starnberg Bavaria",
            rating=5,
        )
        self.photo.shared_to.add(self.recipient)


class MediaTest(DirectShareFixture):
    PATHS = ("photos", "thumbnails_big", "square_thumbnails")

    def test_a_recipient_loses_the_files_of_a_photo_hidden_trashed_or_removed(self):
        for state in STATES:
            for path in self.PATHS:
                with self.subTest(state=state, path=path):
                    set_state(
                        self.photo, hidden=False, in_trashcan=False, removed=False
                    )
                    url = f"/media/{path}/{self.photo.image_hash}"
                    self.assertEqual(
                        media_client(self.recipient).get(url).status_code, 200
                    )
                    set_state(self.photo, **state)
                    self.assertEqual(
                        media_client(self.recipient).get(url).status_code, 404
                    )
                    self.assertEqual(media_client(self.owner).get(url).status_code, 200)

    def test_the_original_by_id_too(self):
        set_state(self.photo, hidden=True)
        url = f"/media/photos/{self.photo.pk}"
        self.assertEqual(media_client(self.recipient).get(url).status_code, 404)
        self.assertEqual(media_client(self.owner).get(url).status_code, 200)

    def test_a_library_share_does_not_bring_a_hidden_photo_back(self):
        create_test_library_share(owner=self.owner, recipient=self.recipient)
        set_state(self.photo, hidden=True)
        url = f"/media/photos/{self.photo.image_hash}"
        self.assertEqual(media_client(self.recipient).get(url).status_code, 404)

    def test_a_formerly_public_photo_is_not_served_to_visitors(self):
        Photo.objects.filter(pk=self.photo.pk).update(public=True)
        set_state(self.photo, hidden=True)
        url = f"/media/thumbnails_big/{self.photo.image_hash}"
        self.assertNotEqual(media_client(None).get(url).status_code, 200)


class PhotoApiTest(DirectShareFixture):
    def test_summary_and_albums_are_404_for_a_recipient(self):
        for state in STATES:
            for action in ("summary", "albums"):
                with self.subTest(state=state, action=action):
                    set_state(
                        self.photo, hidden=False, in_trashcan=False, removed=False
                    )
                    url = f"/api/photos/{self.photo.pk}/{action}/"
                    self.assertEqual(
                        api_client(self.recipient).get(url).status_code, 200
                    )
                    set_state(self.photo, **state)
                    self.assertEqual(
                        api_client(self.recipient).get(url).status_code, 404
                    )
                    self.assertEqual(api_client(self.owner).get(url).status_code, 200)

    def test_detail_stays_404_for_a_recipient(self):
        set_state(self.photo, in_trashcan=True)
        resp = api_client(self.recipient).get(f"/api/photos/{self.photo.pk}/")
        self.assertEqual(resp.status_code, 404)

    def test_a_formerly_public_photo_has_no_public_summary(self):
        Photo.objects.filter(pk=self.photo.pk).update(public=True)
        url = f"/api/photos/{self.photo.pk}/summary/"
        self.assertEqual(api_client(None).get(url).status_code, 200)
        set_state(self.photo, hidden=True)
        self.assertEqual(api_client(None).get(url).status_code, 404)

    def test_visible_to_leaves_out_shared_and_public_photos_that_are_hidden(self):
        public = create_test_photo(owner=self.owner, public=True)
        set_state(self.photo, hidden=True)
        set_state(public, in_trashcan=True)
        self.assertNotIn(self.photo, Photo.objects.visible_to(self.recipient))
        self.assertNotIn(public, Photo.objects.visible_to(None))
        own = set(Photo.objects.visible_to(self.owner))
        self.assertIn(self.photo, own)
        self.assertIn(public, own)

    def test_a_stack_lists_only_the_photos_the_recipient_can_see(self):
        sibling = create_test_photo(owner=self.owner, exif_timestamp=NOON)
        stack = create_test_stack(
            owner=self.owner, stack_type=PhotoStack.StackType.BURST_SEQUENCE
        )
        stack.photos.add(self.photo, sibling)
        resp = api_client(self.recipient).get(f"/api/photos/{self.photo.pk}/")
        self.assertEqual(resp.status_code, 200)
        listed = {p["id"] for s in resp.json()["stacks"] for p in s["photos"]}
        self.assertEqual(listed, {str(self.photo.pk)})
        resp = api_client(self.owner).get(f"/api/photos/{self.photo.pk}/")
        listed = {p["id"] for s in resp.json()["stacks"] for p in s["photos"]}
        self.assertEqual(listed, {str(self.photo.pk), str(sibling.pk)})


class SyncVisibilityTest(DirectShareFixture):
    def test_a_recipient_seed_leaves_out_hidden_and_trashed_photos(self):
        for state in STATES:
            with self.subTest(state=state):
                set_state(self.photo, hidden=False, in_trashcan=False, removed=False)
                set_state(self.photo, **state)
                items, _tombs, _cursor = sync_pull(
                    api_client(self.recipient), SYNC_PHOTOS
                )
                self.assertEqual(items, [])
                owner_items, _t, _c = sync_pull(api_client(self.owner), SYNC_PHOTOS)
                self.assertEqual([i["id"] for i in owner_items], [str(self.photo.pk)])

    def test_hiding_sends_the_recipient_a_tombstone_and_unhiding_the_row(self):
        client = api_client(self.recipient)
        items, _t, cursor = sync_pull(client, SYNC_PHOTOS)
        self.assertEqual([i["id"] for i in items], [str(self.photo.pk)])

        set_state(self.photo, hidden=True)
        items, tombs, cursor = sync_pull(client, SYNC_PHOTOS, cursor=cursor)
        self.assertEqual(items, [])
        self.assertIn(str(self.photo.pk), tombs)

        set_state(self.photo, hidden=False)
        items, tombs, _c = sync_pull(client, SYNC_PHOTOS, cursor=cursor)
        self.assertEqual([i["id"] for i in items], [str(self.photo.pk)])
        self.assertNotIn(str(self.photo.pk), tombs)

    def test_the_owner_gets_no_tombstone_for_their_own_hidden_photo(self):
        client = api_client(self.owner)
        _items, _t, cursor = sync_pull(client, SYNC_PHOTOS)
        set_state(self.photo, hidden=True)
        items, tombs, _c = sync_pull(client, SYNC_PHOTOS, cursor=cursor)
        self.assertEqual([i["id"] for i in items], [str(self.photo.pk)])
        self.assertTrue(items[0]["hidden"])
        self.assertNotIn(str(self.photo.pk), tombs)

    def test_counts_agree_with_the_feed(self):
        set_state(self.photo, in_trashcan=True)
        resp = api_client(self.recipient).get("/api/sync/counts/")
        self.assertEqual(resp.json()["photos"], 0)

    def test_a_shared_album_lists_no_hidden_photo_ids(self):
        visible = create_test_photo(owner=self.owner, exif_timestamp=NOON)
        album = create_test_album_user(owner=self.owner)
        album.photos.add(self.photo, visible)
        album.shared_to.add(self.recipient)
        set_state(self.photo, hidden=True)

        items, _t, _c = sync_pull(api_client(self.recipient), "/api/sync/albums/user/")
        self.assertEqual(items[0]["photo_ids"], [str(visible.pk)])
        self.assertEqual(items[0]["photo_count"], 1)
        items, _t, _c = sync_pull(api_client(self.owner), "/api/sync/albums/user/")
        self.assertEqual(
            set(items[0]["photo_ids"]), {str(self.photo.pk), str(visible.pk)}
        )

    def test_a_shared_event_album_lists_no_hidden_photo_ids(self):
        visible = create_test_photo(owner=self.owner, exif_timestamp=NOON)
        album = create_test_album_auto(owner=self.owner)
        album.photos.add(self.photo, visible)
        album.shared_to.add(self.recipient)
        set_state(self.photo, hidden=True)

        items, _t, _c = sync_pull(api_client(self.recipient), "/api/sync/albums/auto/")
        self.assertEqual(items[0]["photo_ids"], [str(visible.pk)])
        self.assertEqual(items[0]["cover_hash"], visible.image_hash)


class SyncLibraryShareTest(DirectShareFixture):
    """A photo shared one by one follows the owner's library share in sync too."""

    def row(self):
        items, _t, _c = sync_pull(api_client(self.recipient), SYNC_PHOTOS)
        self.assertEqual(len(items), 1)
        return items[0]

    def test_with_location_off_sync_hides_the_place_and_the_rating(self):
        create_test_library_share(owner=self.owner, recipient=self.recipient)
        detail = api_client(self.recipient).get(f"/api/photos/{self.photo.pk}/").json()
        self.assertIsNone(detail["exif_gps_lat"])
        row = self.row()
        self.assertIsNone(row["latitude"])
        self.assertIsNone(row["longitude"])
        self.assertEqual(row["search_location"], "")
        self.assertEqual(row["rating"], 0)
        self.assertFalse(row["is_favorite"])

    def test_with_location_on_the_place_shows_but_never_the_rating(self):
        create_test_library_share(
            owner=self.owner, recipient=self.recipient, share_location=True
        )
        row = self.row()
        self.assertEqual(row["latitude"], 47.99)
        self.assertEqual(row["search_location"], "Starnberg Bavaria")
        self.assertEqual(row["rating"], 0)
        self.assertFalse(row["is_favorite"])

    def test_every_sync_row_field_is_classified(self):
        """A new feed field is a decision: add it to PHOTO_ROW_FIELDS, or
        recipients get it hidden."""
        items, _t, _c = sync_pull(api_client(self.owner), SYNC_PHOTOS)
        self.assertEqual(set(items[0]), set(PHOTO_ROW_FIELDS))

    def test_the_owner_still_gets_everything(self):
        create_test_library_share(owner=self.owner, recipient=self.recipient)
        items, _t, _c = sync_pull(api_client(self.owner), SYNC_PHOTOS)
        self.assertEqual(items[0]["latitude"], 47.99)
        self.assertEqual(items[0]["rating"], 5)
        self.assertTrue(items[0]["is_favorite"])
