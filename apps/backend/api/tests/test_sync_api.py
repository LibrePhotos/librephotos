"""Tests for the mobile-v2 delta-sync API (doc 04 §6).

Covers cursor iteration completeness, tie-break on equal timestamps, tombstone
emission on delete / un-share / bulk delete, 410 on a pruned cursor, sharing
visibility in both directions, the convergence property, the counts endpoint,
and the upload timestamp fallback.
"""

import base64
import datetime
import uuid

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from api.autoalbum import delete_missing_photos
from api.models import (
    AlbumUser,
    DeletionLog,
    Person,
    Photo,
    Tag,
)
from api.services import prune_deletion_log
from api.tests.utils import create_test_photo, create_test_photos, create_test_user

PHOTOS_URL = "/api/sync/photos/"


def sync_pull(client, url, cursor=None, page_size=None):
    """Drive the pull loop to quiescence.

    Returns ``(items, tombstones, durable_cursor)`` where ``durable_cursor`` is
    the last non-null ``next_cursor`` (safe to resume from later).
    """
    items, tombstones = [], []
    durable = cursor
    loop_cursor = cursor
    while True:
        params = {}
        if loop_cursor:
            params["cursor"] = loop_cursor
        if page_size:
            params["page_size"] = page_size
        resp = client.get(url, params)
        assert resp.status_code == 200, resp.content
        data = resp.json()
        items.extend(data["items"])
        tombstones.extend(data["tombstones"])
        nxt = data["next_cursor"]
        if nxt is None:
            break
        loop_cursor = nxt
        durable = nxt
    return items, tombstones, durable


class SyncPhotosCursorTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user(favorite_min_rating=1)
        self.client.force_authenticate(user=self.user)

    def test_cursor_iteration_covers_every_row_exactly_once(self):
        photos = create_test_photos(number_of_photos=25, owner=self.user)
        expected = {str(p.id) for p in photos}

        items, _tomb, _cursor = sync_pull(self.client, PHOTOS_URL, page_size=4)
        got = [i["id"] for i in items]

        self.assertEqual(len(got), len(expected))
        self.assertEqual(set(got), expected)
        # exactly once
        self.assertEqual(len(got), len(set(got)))

    def test_tie_break_on_equal_last_modified(self):
        photos = create_test_photos(number_of_photos=7, owner=self.user)
        # Force a collision on the ordering key so pagination must fall back to
        # the id tie-break.
        fixed = timezone.now().replace(microsecond=0)
        Photo.objects.filter(pk__in=[p.pk for p in photos]).update(last_modified=fixed)

        items, _tomb, _cursor = sync_pull(self.client, PHOTOS_URL, page_size=2)
        got = [i["id"] for i in items]

        self.assertEqual(len(got), 7)
        self.assertEqual(set(got), {str(p.id) for p in photos})
        self.assertEqual(len(got), len(set(got)))

    def test_seed_envelope_shape_and_total(self):
        create_test_photos(number_of_photos=3, owner=self.user)
        resp = self.client.get(PHOTOS_URL)
        data = resp.json()
        self.assertEqual(data["v"], 1)
        self.assertEqual(data["total"], 3)
        self.assertIn("server_time", data)
        self.assertEqual(data["tombstones"], [])

        # A cursored (non-seed) request omits `total`.
        resp2 = self.client.get(PHOTOS_URL, {"cursor": data["next_cursor"]})
        self.assertNotIn("total", resp2.json())

    def test_page_size_capped(self):
        create_test_photos(number_of_photos=3, owner=self.user)
        resp = self.client.get(PHOTOS_URL, {"page_size": "99999"})
        self.assertEqual(resp.status_code, 200)

    def test_favorite_flag_resolved_server_side(self):
        create_test_photos(number_of_photos=1, owner=self.user, rating=3)
        create_test_photos(number_of_photos=1, owner=self.user, rating=0)
        items, _t, _c = sync_pull(self.client, PHOTOS_URL)
        favs = {i["is_favorite"] for i in items}
        self.assertEqual(favs, {True, False})


class SyncTombstoneTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user()
        self.client.force_authenticate(user=self.user)

    def test_hard_delete_emits_photo_tombstone(self):
        photos = create_test_photos(number_of_photos=3, owner=self.user)
        _items, _tomb, cursor = sync_pull(self.client, PHOTOS_URL)

        victim = photos[0]
        victim_id = str(victim.id)
        victim.delete()

        _items2, tombs2, _c = sync_pull(self.client, PHOTOS_URL, cursor=cursor)
        self.assertIn(victim_id, tombs2)

    def test_bulk_delete_missing_emits_tombstones(self):
        # create_test_photo leaves files M2M empty -> candidates for deletion.
        photos = create_test_photos(number_of_photos=3, owner=self.user)
        ids = {str(p.id) for p in photos}
        _items, _tomb, cursor = sync_pull(self.client, PHOTOS_URL)

        delete_missing_photos(self.user, str(uuid.uuid4()))

        _items2, tombs2, _c = sync_pull(self.client, PHOTOS_URL, cursor=cursor)
        self.assertTrue(ids.issubset(set(tombs2)))
        self.assertFalse(Photo.objects.filter(pk__in=[p.pk for p in photos]).exists())

    def test_person_delete_emits_tombstone(self):
        person = Person.objects.create(
            name="Alice", kind=Person.KIND_USER, cluster_owner=self.user
        )
        url = "/api/sync/persons/"
        _items, _tomb, cursor = sync_pull(self.client, url)
        pid = str(person.id)
        person.delete()
        _items2, tombs2, _c = sync_pull(self.client, url, cursor=cursor)
        self.assertIn(pid, tombs2)

    def test_tag_delete_emits_tombstone(self):
        tag = Tag.objects.create(name="beach", owner=self.user)
        url = "/api/sync/albums/tag/"
        _items, _tomb, cursor = sync_pull(self.client, url)
        tid = str(tag.id)
        tag.delete()
        _items2, tombs2, _c = sync_pull(self.client, url, cursor=cursor)
        self.assertIn(tid, tombs2)


class SyncCursorExpiryTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user()
        self.client.force_authenticate(user=self.user)

    def test_expired_cursor_returns_410(self):
        old = timezone.now() - datetime.timedelta(days=91)
        raw = f"{old.isoformat()}|{uuid.uuid4()}"
        cursor = base64.urlsafe_b64encode(raw.encode()).decode()
        resp = self.client.get(PHOTOS_URL, {"cursor": cursor})
        self.assertEqual(resp.status_code, 410)
        self.assertEqual(resp.json()["error"], "cursor_expired")

    def test_malformed_cursor_returns_400(self):
        resp = self.client.get(PHOTOS_URL, {"cursor": "!!!not-base64!!!"})
        self.assertEqual(resp.status_code, 400)

    def test_prune_deletion_log_drops_old_rows(self):
        photo = create_test_photo(owner=self.user)
        photo.delete()
        self.assertEqual(DeletionLog.objects.count(), 1)
        # Age the tombstone past the horizon.
        DeletionLog.objects.update(
            deleted_at=timezone.now() - datetime.timedelta(days=91)
        )
        pruned = prune_deletion_log()
        self.assertEqual(pruned, 1)
        self.assertEqual(DeletionLog.objects.count(), 0)


class SyncSharingVisibilityTest(TestCase):
    def setUp(self):
        self.client_a = APIClient()
        self.client_b = APIClient()
        self.user_a = create_test_user()
        self.user_b = create_test_user()
        self.client_a.force_authenticate(user=self.user_a)
        self.client_b.force_authenticate(user=self.user_b)

    def _share(self, hashes, shared):
        return self.client_a.post(
            "/api/photosedit/share/",
            format="json",
            data={
                "image_hashes": hashes,
                "val_shared": shared,
                "target_user_id": self.user_b.id,
            },
        )

    def test_shared_photo_appears_then_disappears_for_recipient(self):
        photos = create_test_photos(number_of_photos=2, owner=self.user_a)
        hashes = [p.image_hash for p in photos]
        ids = {str(p.id) for p in photos}

        # B starts empty.
        items0, _t0, cursor0 = sync_pull(self.client_b, PHOTOS_URL)
        self.assertEqual(items0, [])

        # A shares to B -> appears in B's delta.
        self.assertEqual(self._share(hashes, True).status_code, 200)
        items1, _t1, cursor1 = sync_pull(self.client_b, PHOTOS_URL, cursor=cursor0)
        self.assertEqual({i["id"] for i in items1}, ids)

        # A un-shares -> B gets tombstones and the rows leave B's scope.
        self.assertEqual(self._share(hashes, False).status_code, 200)
        items2, tombs2, _c2 = sync_pull(self.client_b, PHOTOS_URL, cursor=cursor1)
        self.assertTrue(ids.issubset(set(tombs2)))
        # And a fresh seed for B no longer contains them.
        seed_items, _t, _c = sync_pull(self.client_b, PHOTOS_URL)
        self.assertEqual(seed_items, [])

    def test_owner_unaffected_by_unshare(self):
        photos = create_test_photos(number_of_photos=1, owner=self.user_a)
        hashes = [p.image_hash for p in photos]
        self._share(hashes, True)
        self._share(hashes, False)
        # Owner A still sees the photo; no tombstone for A.
        items, tombs, _c = sync_pull(self.client_a, PHOTOS_URL)
        self.assertEqual({i["id"] for i in items}, {str(photos[0].id)})
        self.assertNotIn(str(photos[0].id), tombs)

    def test_album_unshare_emits_tombstone_for_recipient(self):
        album = AlbumUser.objects.create(title="Trip", owner=self.user_a)
        url = "/api/sync/albums/user/"

        # Share album to B.
        resp = self.client_a.post(
            "/api/useralbum/share/",
            format="json",
            data={
                "shared": True,
                "target_user_id": self.user_b.id,
                "album_id": album.id,
            },
        )
        self.assertEqual(resp.status_code, 200)

        items1, _t1, cursor1 = sync_pull(self.client_b, url)
        self.assertEqual({i["id"] for i in items1}, {album.id})

        # Un-share -> tombstone for B.
        self.client_a.post(
            "/api/useralbum/share/",
            format="json",
            data={
                "shared": False,
                "target_user_id": self.user_b.id,
                "album_id": album.id,
            },
        )
        _items2, tombs2, _c2 = sync_pull(self.client_b, url, cursor=cursor1)
        self.assertIn(str(album.id), tombs2)


class SyncAlbumMembershipTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user()
        self.client.force_authenticate(user=self.user)

    def test_user_album_embeds_photo_ids_and_bumps_on_membership_change(self):
        album = AlbumUser.objects.create(title="Album", owner=self.user)
        photos = create_test_photos(number_of_photos=2, owner=self.user)
        album.photos.add(*photos)

        url = "/api/sync/albums/user/"
        items, _t, cursor = sync_pull(self.client, url)
        self.assertEqual(len(items), 1)
        row = items[0]
        self.assertEqual(set(row["photo_ids"]), {str(p.id) for p in photos})
        self.assertEqual(row["photo_count"], 2)

        # Adding a photo bumps last_modified -> the album reappears in the delta.
        extra = create_test_photo(owner=self.user)
        album.photos.add(extra)
        items2, _t2, _c2 = sync_pull(self.client, url, cursor=cursor)
        self.assertEqual({i["id"] for i in items2}, {album.id})
        self.assertEqual(items2[0]["photo_count"], 3)


class SyncCountsTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user()
        self.client.force_authenticate(user=self.user)

    def test_counts_endpoint(self):
        create_test_photos(number_of_photos=4, owner=self.user)
        AlbumUser.objects.create(title="A", owner=self.user)
        Tag.objects.create(name="t", owner=self.user)
        Person.objects.create(
            name="P", kind=Person.KIND_USER, cluster_owner=self.user
        )

        resp = self.client.get("/api/sync/counts/")
        data = resp.json()
        self.assertEqual(data["photos"], 4)
        self.assertEqual(data["user_albums"], 1)
        self.assertEqual(data["tags"], 1)
        self.assertEqual(data["persons"], 1)


class SyncOtherFeedsTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user()
        self.client.force_authenticate(user=self.user)

    def test_all_feeds_return_versioned_envelope(self):
        from api.models import AlbumAuto, AlbumPlace, AlbumThing

        photos = create_test_photos(number_of_photos=2, owner=self.user)
        auto = AlbumAuto.objects.create(
            title="Event", timestamp=timezone.now(), created_on=timezone.now(),
            owner=self.user,
        )
        auto.photos.add(*photos)
        thing = AlbumThing.objects.create(
            title="beach", thing_type="thing", owner=self.user
        )
        thing.photos.add(*photos)
        place = AlbumPlace.objects.create(title="Paris", owner=self.user)
        place.photos.add(*photos)

        for url in (
            "/api/sync/albums/auto/",
            "/api/sync/albums/thing/",
            "/api/sync/albums/place/",
            "/api/sync/persons/",
            "/api/sync/sharing/",
        ):
            resp = self.client.get(url)
            self.assertEqual(resp.status_code, 200, url)
            data = resp.json()
            self.assertEqual(data["v"], 1, url)
            self.assertIn("items", data)
            self.assertIn("next_cursor", data)
            self.assertIn("total", data)

    def test_auto_album_embeds_photo_ids_and_place_counts(self):
        from api.models import AlbumAuto, AlbumPlace

        photos = create_test_photos(number_of_photos=3, owner=self.user)
        auto = AlbumAuto.objects.create(
            title="Event", timestamp=timezone.now(), created_on=timezone.now(),
            owner=self.user,
        )
        auto.photos.add(*photos)
        place = AlbumPlace.objects.create(title="Paris", owner=self.user)
        place.photos.add(*photos)

        auto_items, _t, _c = sync_pull(self.client, "/api/sync/albums/auto/")
        self.assertEqual(len(auto_items), 1)
        self.assertEqual(len(auto_items[0]["photo_ids"]), 3)
        self.assertEqual(auto_items[0]["photo_count"], 3)

        place_items, _t2, _c2 = sync_pull(self.client, "/api/sync/albums/place/")
        self.assertEqual(place_items[0]["photo_count"], 3)


class SyncConvergenceTest(TestCase):
    """The load-bearing property test: after an arbitrary scripted mutation
    sequence, a simulated client pull loop converges on the server's
    visible-set (doc 04 §6)."""

    def setUp(self):
        self.client = APIClient()
        self.owner = create_test_user()
        self.viewer = create_test_user()
        self.vclient = APIClient()
        self.vclient.force_authenticate(user=self.viewer)
        self.client.force_authenticate(user=self.owner)

    def _server_visible_ids_for_viewer(self):
        return set(
            str(pk)
            for pk in Photo.objects.filter(shared_to=self.viewer)
            .values_list("id", flat=True)
        )

    def _share(self, hashes, shared):
        self.client.post(
            "/api/photosedit/share/",
            format="json",
            data={
                "image_hashes": hashes,
                "val_shared": shared,
                "target_user_id": self.viewer.id,
            },
        )

    def test_client_converges_to_server_visible_set(self):
        state = {}
        cursor = None

        def apply_and_check():
            nonlocal cursor
            items, tombs, cursor = sync_pull(self.vclient, PHOTOS_URL, cursor=cursor)
            for it in items:
                state[it["id"]] = it
            for tid in tombs:
                state.pop(tid, None)
            self.assertEqual(
                set(state.keys()), self._server_visible_ids_for_viewer()
            )

        # 1. Create + share a batch.
        batch1 = create_test_photos(number_of_photos=6, owner=self.owner)
        self._share([p.image_hash for p in batch1], True)
        apply_and_check()

        # 2. Share more, un-share some.
        batch2 = create_test_photos(number_of_photos=4, owner=self.owner)
        self._share([p.image_hash for p in batch2], True)
        self._share([p.image_hash for p in batch1[:2]], False)
        apply_and_check()

        # 3. Hard-delete a couple of still-shared photos.
        for photo in batch2[:2]:
            photo.delete()
        apply_and_check()

        # 4. Re-share a previously un-shared photo.
        self._share([batch1[0].image_hash], True)
        apply_and_check()

        # Final convergence.
        self.assertEqual(
            set(state.keys()), self._server_visible_ids_for_viewer()
        )


class DeviceTimestampFallbackTest(TestCase):
    def test_parse_device_timestamp_accepts_epoch_ms_and_iso(self):
        from api.views.upload import parse_device_timestamp

        dt_ms = parse_device_timestamp(1_600_000_000_000)
        self.assertIsNotNone(dt_ms)
        self.assertEqual(dt_ms.year, 2020)

        dt_iso = parse_device_timestamp("2021-06-15T12:00:00Z")
        self.assertEqual((dt_iso.year, dt_iso.month, dt_iso.day), (2021, 6, 15))

        self.assertIsNone(parse_device_timestamp(None))
        self.assertIsNone(parse_device_timestamp(""))

    def test_fallback_fills_missing_timestamp_only(self):
        from api.directory_watcher.file_handlers import (
            apply_device_timestamp_fallback,
        )

        user = create_test_user()
        photo = create_test_photo(owner=user)
        # No EXIF date extracted.
        self.assertIsNone(photo.exif_timestamp)

        device_time = datetime.datetime(
            2019, 3, 1, 10, 30, tzinfo=datetime.timezone.utc
        )
        apply_device_timestamp_fallback(photo, device_time)

        photo.refresh_from_db()
        self.assertIsNotNone(photo.exif_timestamp)
        self.assertEqual(photo.exif_timestamp.year, 2019)

    def test_fallback_does_not_override_existing_exif(self):
        from api.directory_watcher.file_handlers import (
            apply_device_timestamp_fallback,
        )

        user = create_test_user()
        existing = datetime.datetime(
            2022, 8, 8, 8, 0, tzinfo=datetime.timezone.utc
        )
        photo = create_test_photo(owner=user)
        Photo.objects.filter(pk=photo.pk).update(exif_timestamp=existing)
        photo.refresh_from_db()

        device_time = datetime.datetime(
            2019, 3, 1, 10, 30, tzinfo=datetime.timezone.utc
        )
        apply_device_timestamp_fallback(photo, device_time)

        photo.refresh_from_db()
        self.assertEqual(photo.exif_timestamp.year, 2022)
