"""The cover an owner picks for an event (#429).

``PATCH /api/albums/auto/{id}/`` takes ``cover_photo``: one of the event's own
visible photos, or null for the automatic cover (the first visible photo). The
Events list, the event page and the mobile sync feed show it while it stays
visible, and event generation keeps it.
"""

from datetime import timedelta

import pytz
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from api.albums.auto_albums import generate_event_albums
from api.models import AlbumAuto
from api.tests.utils import (
    api_error,
    create_test_album_auto,
    create_test_photo,
    create_test_user,
)

BASE = timezone.datetime(2020, 1, 1, 12, 0, 0, tzinfo=pytz.utc)


class EventCoverTestBase(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.first = create_test_photo(owner=self.user, exif_timestamp=BASE)
        self.second = create_test_photo(
            owner=self.user, exif_timestamp=BASE + timedelta(hours=1)
        )
        self.event = create_test_album_auto(owner=self.user, timestamp=BASE)
        self.event.photos.add(self.first, self.second)

    def _patch(self, event, cover):
        return self.client.patch(
            f"/api/albums/auto/{event.id}/", {"cover_photo": cover}, format="json"
        )

    def _card(self):
        results = self.client.get("/api/albums/auto/list/").json()["results"]
        return next(row for row in results if row["id"] == self.event.id)

    def _detail(self):
        return self.client.get(f"/api/albums/auto/{self.event.id}/").json()

    def _automatic_hash(self):
        # The list's automatic cover: the first visible photo, as before #429.
        return self._card()["photos"]["image_hash"]


class SetEventCoverTest(EventCoverTestBase):
    def test_the_picked_cover_is_shown_on_the_list_and_the_page(self):
        automatic = self._automatic_hash()
        picked = self.second if automatic == self.first.image_hash else self.first

        response = self._patch(self.event, str(picked.id))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(), {"id": self.event.id, "cover_photo": str(picked.id)}
        )
        self.assertEqual(self._card()["photos"]["image_hash"], picked.image_hash)
        self.assertEqual(self._detail()["cover_photo"], str(picked.id))

    def test_null_goes_back_to_the_automatic_cover(self):
        automatic = self._automatic_hash()
        picked = self.second if automatic == self.first.image_hash else self.first
        self._patch(self.event, str(picked.id))

        response = self._patch(self.event, None)

        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json()["cover_photo"])
        self.assertEqual(self._card()["photos"]["image_hash"], automatic)
        self.assertIsNone(self._detail()["cover_photo"])

    def test_a_new_event_has_no_picked_cover(self):
        self.assertIsNone(self._detail()["cover_photo"])

    def test_setting_the_cover_bumps_last_modified_for_synced_clients(self):
        before = AlbumAuto.objects.get(pk=self.event.pk).last_modified
        self._patch(self.event, str(self.second.id))
        self.assertGreater(
            AlbumAuto.objects.get(pk=self.event.pk).last_modified, before
        )

    def test_a_photo_outside_the_event_is_refused(self):
        outside = create_test_photo(owner=self.user)

        response = self._patch(self.event, str(outside.id))

        self.assertEqual(response.status_code, 400)
        self.assertEqual(api_error(response)["field"], "cover_photo")
        self.assertEqual(api_error(response)["code"], "not_in_event")
        self.assertIsNone(AlbumAuto.objects.get(pk=self.event.pk).cover_photo_id)

    def test_a_hidden_photo_of_the_event_is_refused(self):
        self.second.hidden = True
        self.second.save(update_fields=["hidden"])

        response = self._patch(self.event, str(self.second.id))

        self.assertEqual(response.status_code, 400)
        self.assertEqual(api_error(response)["code"], "not_in_event")

    def test_another_users_photo_is_refused_like_an_unknown_one(self):
        stranger = create_test_user()
        theirs = create_test_photo(owner=stranger)
        # Even inside the event (a stale membership cannot be made through the
        # API, but the field must not trust the event's photos alone).
        self.event.photos.add(theirs)

        response = self._patch(self.event, str(theirs.id))

        self.assertEqual(response.status_code, 400)
        self.assertEqual(api_error(response)["code"], "does_not_exist")
        self.assertIsNone(AlbumAuto.objects.get(pk=self.event.pk).cover_photo_id)

    def test_another_users_event_is_not_found(self):
        stranger = create_test_user()
        theirs = create_test_album_auto(owner=stranger)
        their_photo = create_test_photo(owner=stranger)
        theirs.photos.add(their_photo)

        response = self._patch(theirs, str(self.first.id))

        self.assertEqual(response.status_code, 404)
        self.assertIsNone(AlbumAuto.objects.get(pk=theirs.pk).cover_photo_id)

    def test_put_is_not_allowed(self):
        response = self.client.put(
            f"/api/albums/auto/{self.event.id}/",
            {"cover_photo": str(self.first.id)},
            format="json",
        )
        self.assertEqual(response.status_code, 405)


class PickedCoverFallbackTest(EventCoverTestBase):
    def setUp(self):
        super().setUp()
        self.event.cover_photo = self.second
        self.event.save()

    def _assert_automatic(self):
        self.assertEqual(self._card()["photos"]["image_hash"], self.first.image_hash)
        self.assertIsNone(self._detail()["cover_photo"])

    def test_a_cover_hidden_later_falls_back_to_the_automatic_one(self):
        self.second.hidden = True
        self.second.save(update_fields=["hidden"])
        self._assert_automatic()

    def test_a_cover_trashed_later_falls_back_to_the_automatic_one(self):
        self.second.in_trashcan = True
        self.second.save(update_fields=["in_trashcan"])
        self._assert_automatic()

    def test_a_deleted_cover_clears_the_pick(self):
        self.second.delete()
        self.assertIsNone(AlbumAuto.objects.get(pk=self.event.pk).cover_photo_id)
        self.assertEqual(self._card()["photos"]["image_hash"], self.first.image_hash)

    def test_the_sync_feed_sends_the_picked_cover(self):
        items = self.client.get("/api/sync/albums/auto/").json()["items"]
        row = next(item for item in items if item["id"] == self.event.id)
        self.assertEqual(row["cover_hash"], self.second.image_hash)


class EventCoverQueryCountTest(TestCase):
    """Picked covers load in one query for the whole list."""

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _add_events(self, count):
        for _ in range(count):
            photos = [create_test_photo(owner=self.user) for _ in range(2)]
            event = create_test_album_auto(owner=self.user)
            event.photos.add(*photos)
            event.cover_photo = photos[1]
            event.save()

    def _count(self):
        with CaptureQueriesContext(connection) as ctx:
            response = self.client.get("/api/albums/auto/list/")
            self.assertEqual(response.status_code, 200)
            results = response.json()["results"]
        return len(ctx.captured_queries), len(results)

    def test_the_list_costs_the_same_for_two_and_six_picked_covers(self):
        self._add_events(2)
        self._count()
        small, small_rows = self._count()
        self._add_events(4)
        large, large_rows = self._count()
        self.assertEqual((small_rows, large_rows), (2, 6))
        self.assertEqual(small, large)


def _make_photo(user, offset_hours):
    return create_test_photo(
        owner=user, exif_timestamp=BASE + timedelta(hours=offset_hours)
    )


class EventCoverRegenerationTest(TestCase):
    """Generating events again keeps a picked cover (the decision for #429).

    Generation updates events in place and only adds photos to them, so the
    picked photo stays in its event. Only "Delete all events" (Admin) loses
    the picks, with the events themselves.
    """

    def test_a_rerun_keeps_the_picked_cover(self):
        user = create_test_user()
        photos = [_make_photo(user, h) for h in (0, 1, 2)]
        generate_event_albums(user, "job-429-first")
        event = AlbumAuto.objects.get(owner=user)
        event.cover_photo = photos[2]
        event.save()

        _make_photo(user, 3)
        generate_event_albums(user, "job-429-second")

        event = AlbumAuto.objects.get(owner=user)
        self.assertEqual(event.photos.count(), 4)
        self.assertEqual(event.cover_photo_id, photos[2].pk)

    def test_a_merge_carries_the_merged_events_cover(self):
        user = create_test_user()
        for hour in (0, 1, 2):
            _make_photo(user, hour)
        later = [_make_photo(user, h) for h in (96, 97, 98)]
        generate_event_albums(user, "job-429-merge-setup")
        merged = AlbumAuto.objects.get(owner=user, photos=later[0])
        merged.cover_photo = later[1]
        merged.save()

        # Photos bridging the two events make them one.
        for hour in (32, 64):
            _make_photo(user, hour)
        generate_event_albums(user, "job-429-merge")

        survivor = AlbumAuto.objects.get(owner=user)
        self.assertEqual(survivor.cover_photo_id, later[1].pk)

    def test_a_merge_keeps_the_surviving_events_own_cover(self):
        user = create_test_user()
        earlier = [_make_photo(user, h) for h in (0, 1, 2)]
        later = [_make_photo(user, h) for h in (96, 97, 98)]
        generate_event_albums(user, "job-429-own-setup")
        for photo, cover in ((earlier[0], earlier[2]), (later[0], later[1])):
            event = AlbumAuto.objects.get(owner=user, photos=photo)
            event.cover_photo = cover
            event.save()
        # The oldest event survives a merge (_event_album).
        oldest = AlbumAuto.objects.filter(owner=user).order_by("created_on", "id")[0]

        for hour in (32, 64):
            _make_photo(user, hour)
        generate_event_albums(user, "job-429-own-merge")

        survivor = AlbumAuto.objects.get(owner=user)
        self.assertEqual(survivor.pk, oldest.pk)
        self.assertEqual(survivor.cover_photo_id, oldest.cover_photo_id)
