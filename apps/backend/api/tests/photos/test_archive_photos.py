"""The Archive state (#545).

An archived photo leaves the timeline (the date list and its day pages with
``archived=false``) and Memories, but unlike a hidden one it stays everywhere
else: albums, people, folders, search, and every date-album view that does not
ask for ``archived``. ``POST /api/photosedit/archive/`` sets it, with the same
request shape as hide (``image_hashes`` or ``select_all``), on the requester's
own photos only.
"""

from datetime import timedelta

from django.test import SimpleTestCase, TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from api.albums.timeline_filter import TimelineFilter, resolve_timeline_filter
from api.models import Photo
from api.models.photo import visible_photo_q
from api.photos.selection import build_photo_queryset
from api.tests.utils import (
    create_test_album_date,
    create_test_album_user,
    create_test_photo,
    create_test_photos,
    create_test_user,
)

ARCHIVE_URL = "/api/photosedit/archive/"


class _FakeUser:
    is_authenticated = True
    favorite_min_rating = 4
    default_timeline_filter = {"hide_screenshots": True}


class ArchivedTimelineFilterTest(SimpleTestCase):
    def test_archived_is_tristate_and_absent_by_default(self):
        for params, expected in (
            ({}, None),
            ({"archived": "false"}, False),
            ({"archived": False}, False),
            ({"archived": "true"}, True),
            ({"archived": True}, True),
        ):
            with self.subTest(params=params):
                resolved = resolve_timeline_filter(_FakeUser(), params)
                self.assertIs(resolved.archived, expected)

    def test_saved_default_never_sets_archived(self):
        resolved = resolve_timeline_filter(_FakeUser(), {"apply_default": "1"})
        self.assertIsNone(resolved.archived)
        self.assertEqual(resolved.screenshots, "hide")

    def test_q_is_a_positive_lookup_on_the_prefix(self):
        (q,) = TimelineFilter(archived=False).q(_FakeUser(), prefix="photos__")
        self.assertEqual(q.children, [("photos__archived", False)])
        self.assertFalse(q.negated)
        self.assertEqual(TimelineFilter().q(_FakeUser()), [])

    def test_archived_is_not_part_of_visible_photo_q(self):
        self.assertNotIn("archived", str(visible_photo_q()))


class SetPhotosArchivedTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user()
        self.other = create_test_user()
        self.client.force_authenticate(user=self.user)

    def _post(self, payload):
        return self.client.post(ARCHIVE_URL, payload, format="json")

    def test_archives_and_unarchives_by_hash(self):
        photos = create_test_photos(number_of_photos=3, owner=self.user)
        hashes = [p.image_hash for p in photos]
        Photo.objects.filter(pk=photos[0].pk).update(archived=True)

        data = self._post({"image_hashes": hashes, "archived": True}).json()
        self.assertEqual(data["count"], 2)
        self.assertCountEqual(data["updated_hashes"], hashes[1:])
        self.assertEqual(data["not_updated_hashes"], [hashes[0]])
        self.assertEqual(Photo.objects.filter(archived=True).count(), 3)

        data = self._post({"image_hashes": hashes, "archived": False}).json()
        self.assertEqual(data["count"], 3)
        self.assertFalse(Photo.objects.filter(archived=True).exists())

    def test_archiving_hides_nothing_and_bumps_last_modified(self):
        (photo,) = create_test_photos(number_of_photos=1, owner=self.user)
        before = timezone.now() - timedelta(days=1)
        Photo.objects.filter(pk=photo.pk).update(last_modified=before)

        self._post({"image_hashes": [photo.image_hash], "archived": True})
        photo.refresh_from_db()
        self.assertTrue(photo.archived)
        self.assertFalse(photo.hidden)
        self.assertGreater(photo.last_modified, before)
        self.assertTrue(Photo.visible.filter(pk=photo.pk).exists())

    def test_another_users_photos_are_untouched(self):
        theirs = create_test_photos(number_of_photos=2, owner=self.other)
        data = self._post(
            {"image_hashes": [p.image_hash for p in theirs], "archived": True}
        ).json()
        self.assertEqual(data["count"], 0)
        self.assertFalse(Photo.objects.filter(archived=True).exists())

    def test_select_all_acts_on_the_query_minus_exclusions(self):
        mine = create_test_photos(number_of_photos=3, owner=self.user)
        create_test_photos(number_of_photos=2, owner=self.other)
        data = self._post(
            {
                "select_all": True,
                "query": {"archived": False},
                "excluded_hashes": [mine[0].image_hash],
                "archived": True,
            }
        ).json()
        self.assertEqual(data, {"status": True, "count": 2})
        self.assertEqual(set(Photo.objects.filter(archived=True)), {mine[1], mine[2]})

    def test_select_all_on_the_archive_page_unarchives_only_archived(self):
        archived = create_test_photo(owner=self.user, archived=True)
        create_test_photo(owner=self.user)
        data = self._post(
            {"select_all": True, "query": {"archived": True}, "archived": False}
        ).json()
        self.assertEqual(data["count"], 1)
        archived.refresh_from_db()
        self.assertFalse(archived.archived)

    def test_a_string_value_is_refused(self):
        (photo,) = create_test_photos(number_of_photos=1, owner=self.user)
        response = self._post({"image_hashes": [photo.image_hash], "archived": "false"})
        self.assertEqual(response.status_code, 400)
        photo.refresh_from_db()
        self.assertFalse(photo.archived)

    def test_requires_authentication(self):
        response = APIClient().post(
            ARCHIVE_URL, {"image_hashes": [], "archived": True}, format="json"
        )
        self.assertEqual(response.status_code, 401)


class ArchivedOnTheTimelineTest(TestCase):
    """The day list and its pages agree on what ``archived`` leaves in."""

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        now = timezone.now()
        self.mixed = create_test_album_date(owner=self.user, date=now.date())
        self.kept = create_test_photo(owner=self.user, exif_timestamp=now)
        self.archived = create_test_photo(
            owner=self.user, exif_timestamp=now, archived=True
        )
        self.mixed.photos.add(self.kept, self.archived)

        earlier = now - timedelta(days=3)
        self.archived_only = create_test_album_date(
            owner=self.user, date=earlier.date()
        )
        self.old = create_test_photo(
            owner=self.user, exif_timestamp=earlier, archived=True
        )
        self.archived_only.photos.add(self.old)

    def _list(self, params):
        response = self.client.get("/api/albums/date/list/", params)
        self.assertEqual(response.status_code, 200)
        return {row["id"]: row["numberOfItems"] for row in response.json()["results"]}

    def _day(self, album, params):
        response = self.client.get(f"/api/albums/date/{album.id}/", params)
        self.assertEqual(response.status_code, 200)
        results = response.json()["results"]
        hashes = {item["image_hash"] for item in results["items"]}
        return hashes, results["numberOfItems"]

    def test_the_timeline_leaves_archived_photos_out(self):
        self.assertEqual(self._list({"archived": "false"}), {self.mixed.id: 1})
        hashes, count = self._day(self.mixed, {"archived": "false"})
        self.assertEqual(hashes, {self.kept.image_hash})
        self.assertEqual(count, 1)

    def test_the_archive_page_lists_only_archived_photos(self):
        self.assertEqual(
            self._list({"archived": "true"}),
            {self.mixed.id: 1, self.archived_only.id: 1},
        )
        hashes, _ = self._day(self.mixed, {"archived": "true"})
        self.assertEqual(hashes, {self.archived.image_hash})

    def test_without_the_param_archived_photos_stay(self):
        self.assertEqual(self._list({}), {self.mixed.id: 2, self.archived_only.id: 1})

    def test_list_and_day_agree(self):
        for params in ({}, {"archived": "false"}, {"archived": "true"}):
            with self.subTest(params=params):
                days = self._list(params)
                hashes, count = self._day(self.mixed, params)
                self.assertEqual(len(hashes), count)
                self.assertEqual(days.get(self.mixed.id, 0), count)

    def test_an_archived_photo_that_is_hidden_is_only_on_the_hidden_page(self):
        Photo.objects.filter(pk=self.old.pk).update(hidden=True)
        self.assertEqual(self._list({"archived": "true"}), {self.mixed.id: 1})
        self.assertEqual(self._list({"hidden": "true"}), {self.archived_only.id: 1})

    def test_select_all_on_the_timeline_spares_archived_photos(self):
        photos = build_photo_queryset(self.user, {"archived": False})
        self.assertEqual(set(photos), {self.kept})

    def test_summaries_carry_the_flag(self):
        response = self.client.get(f"/api/albums/date/{self.mixed.id}/")
        items = response.json()["results"]["items"]
        flags = {item["image_hash"]: item["archived"] for item in items}
        self.assertEqual(
            flags, {self.kept.image_hash: False, self.archived.image_hash: True}
        )


class ArchivedStaysElsewhereTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.photo = create_test_photo(
            owner=self.user, exif_timestamp=timezone.now(), archived=True
        )

    def test_an_archived_photo_stays_in_its_album(self):
        album = create_test_album_user(owner=self.user)
        album.photos.add(self.photo)
        results = self.client.get(f"/api/albums/user/{album.id}/").json()
        groups = results.get("grouped_photos") or results["results"]["grouped_photos"]
        hashes = {item["image_hash"] for group in groups for item in group["items"]}
        self.assertEqual(hashes, {self.photo.image_hash})

    def test_the_detail_says_archived(self):
        response = self.client.get(f"/api/photos/{self.photo.pk}/")
        self.assertEqual(response.status_code, 200)
        self.assertIs(response.json()["archived"], True)

    def test_the_sync_feed_carries_the_flag(self):
        response = self.client.get("/api/sync/photos/")
        (item,) = response.json()["items"]
        self.assertIs(item["archived"], True)
