"""What released clients still read, served by the current API.

UhuruPhotos (Android, last released 2025) builds its timeline, trash,
favourites, hidden and person pages on ``/api/albums/date/``, which #2920
removed, names photos by the ``id`` of their summary (a UUID since 1.0.0) in
the bulk edits and ``/media/photos/``, waits for ``album_date_id`` after an
upload, requires ``results`` in a bulk edit's answer and deletes albums on
``/api/albums/user/edit/<id>/``. Each of those is pinned here.
"""

import datetime

from django.test import TestCase
from rest_framework.test import APIClient

from api.models import AlbumUser, Photo, Thumbnail
from api.tests.utils import (
    create_test_album_user,
    create_test_face,
    create_test_person,
    create_test_photo,
    create_test_user,
)
from api.timeline.days import UNDATED_DAY_ID

UTC = datetime.UTC
DAY_ID = 20240501


def at(hour: int, day: int = 1) -> datetime.datetime:
    return datetime.datetime(2024, 5, day, hour, tzinfo=UTC)


class LegacyClientTestCase(TestCase):
    def setUp(self) -> None:
        self.user = create_test_user()
        self.other = create_test_user()
        self.client = APIClient()
        self.client.raise_request_exception = False
        self.client.force_authenticate(user=self.user)

    def photo(self, owner=None, **kwargs) -> Photo:
        kwargs.setdefault("exif_timestamp", at(12))
        return create_test_photo(owner=owner or self.user, **kwargs)


class LegacyDateAlbumListTest(LegacyClientTestCase):
    def test_the_list_has_every_day_in_the_date_album_shape(self) -> None:
        self.photo(exif_timestamp=at(9))
        self.photo(exif_timestamp=at(10))
        self.photo(exif_timestamp=at(10, day=2))
        self.photo(exif_timestamp=None)

        response = self.client.get("/api/albums/date/list/")

        self.assertEqual(response.status_code, 200, response.content)
        rows = response.json()["results"]
        self.assertEqual(
            [(row["id"], row["numberOfItems"]) for row in rows],
            [(20240502, 1), (DAY_ID, 2), (UNDATED_DAY_ID, 1)],
        )
        for row in rows:
            self.assertEqual(
                set(row),
                {"id", "date", "location", "incomplete", "numberOfItems", "items"},
            )
            self.assertIs(row["incomplete"], True)
            self.assertEqual(row["items"], [])
            self.assertIsInstance(row["location"], str)
        self.assertEqual(rows[1]["date"], "2024-05-01")
        self.assertIsNone(rows[2]["date"])

    def test_the_filters_of_the_old_routes_still_apply(self) -> None:
        self.photo(rating=5)
        self.photo(in_trashcan=True)
        self.photo(hidden=True)
        self.photo()

        def count(**params: str) -> int:
            response = self.client.get("/api/albums/date/list/", params)
            self.assertEqual(response.status_code, 200, response.content)
            return sum(row["numberOfItems"] for row in response.json()["results"])

        self.assertEqual(count(), 2)
        self.assertEqual(count(favorite="true"), 1)
        self.assertEqual(count(in_trashcan="true"), 1)
        self.assertEqual(count(hidden="true"), 1)

    def test_a_persons_days(self) -> None:
        person = create_test_person(cluster_owner=self.user)
        shown = self.photo()
        create_test_face(photo=shown, person=person)
        self.photo()

        response = self.client.get("/api/albums/date/list/", {"person": person.id})

        rows = response.json()["results"]
        self.assertEqual([(r["id"], r["numberOfItems"]) for r in rows], [(DAY_ID, 1)])

    def test_last_modified_lists_the_owners_changes_trash_included(self) -> None:
        old = self.photo()
        Photo.objects.filter(pk=old.pk).update(last_modified=at(1, day=3))
        trashed = self.photo(in_trashcan=True)
        Photo.objects.filter(pk=trashed.pk).update(last_modified=at(1, day=20))

        response = self.client.get(
            "/api/albums/date/list/", {"last_modified": "2024-05-10T00:00:00Z"}
        )

        rows = response.json()["results"]
        self.assertEqual([(r["id"], r["numberOfItems"]) for r in rows], [(DAY_ID, 1)])

    def test_only_the_callers_photos(self) -> None:
        self.photo(owner=self.other)
        response = self.client.get("/api/albums/date/list/")
        self.assertEqual(response.json()["results"], [])

    def test_needs_a_sign_in(self) -> None:
        response = APIClient().get("/api/albums/date/list/")
        self.assertEqual(response.status_code, 401)


class LegacyDateAlbumPageTest(LegacyClientTestCase):
    def test_a_day_pages_by_page_number_with_its_total(self) -> None:
        photos = [self.photo(exif_timestamp=at(hour % 24)) for hour in range(101)]

        first = self.client.get(f"/api/albums/date/{DAY_ID}/", {"page": 1})
        second = self.client.get(f"/api/albums/date/{DAY_ID}/", {"page": 2})

        self.assertEqual(first.status_code, 200, first.content)
        day = first.json()["results"]
        self.assertEqual(day["id"], DAY_ID)
        self.assertEqual(day["date"], "2024-05-01")
        self.assertIs(day["incomplete"], False)
        self.assertEqual(day["numberOfItems"], 101)
        self.assertEqual(len(day["items"]), 100)
        rest = second.json()["results"]["items"]
        self.assertEqual(len(rest), 1)
        seen = {item["id"] for item in day["items"] + rest}
        self.assertEqual(seen, {str(photo.pk) for photo in photos})

    def test_a_page_past_the_end_is_not_found(self) -> None:
        self.photo()
        response = self.client.get(f"/api/albums/date/{DAY_ID}/", {"page": 2})
        self.assertEqual(response.status_code, 404)

    def test_the_undated_group_and_filters(self) -> None:
        self.photo(exif_timestamp=None)
        self.photo(exif_timestamp=None, in_trashcan=True)

        undated = self.client.get(f"/api/albums/date/{UNDATED_DAY_ID}/")
        trash = self.client.get(
            f"/api/albums/date/{UNDATED_DAY_ID}/", {"in_trashcan": "true"}
        )

        self.assertEqual(undated.json()["results"]["numberOfItems"], 1)
        self.assertIsNone(undated.json()["results"]["date"])
        self.assertEqual(trash.json()["results"]["numberOfItems"], 1)

    def test_another_users_day_is_empty(self) -> None:
        self.photo(owner=self.other)
        response = self.client.get(f"/api/albums/date/{DAY_ID}/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["results"]["items"], [])

    def test_an_id_that_names_no_day_is_not_found(self) -> None:
        for day_id in ("20231399", "abc"):
            response = self.client.get(f"/api/albums/date/{day_id}/")
            self.assertEqual(response.status_code, 404, day_id)


class PhotoSummaryTest(LegacyClientTestCase):
    def test_album_date_id_names_the_day_of_the_legacy_routes(self) -> None:
        photo = self.photo()
        response = self.client.get(f"/api/photos/{photo.pk}/summary/")
        body = response.json()
        self.assertEqual(body["album_date_id"], DAY_ID)
        self.assertEqual(body["album_date_id"], body["day_id"])

    def test_a_photo_without_its_thumbnail_yet_is_processing(self) -> None:
        # An upload is a photo from its completion on; the import job makes
        # the thumbnail row later.
        photo = self.photo()
        Thumbnail.objects.filter(photo=photo).delete()

        response = self.client.get(f"/api/photos/{photo.image_hash}/summary/")

        self.assertEqual(response.status_code, 200, response.content)
        self.assertIs(response.json()["processing"], True)
        self.assertIsNone(response.json()["photo_summary"]["aspectRatio"])
        self.assertEqual(response.json()["photo_summary"]["dominantColor"], "")


class BulkEditByPhotoIdTest(LegacyClientTestCase):
    def test_favorite_by_id_changes_the_photo_and_answers_results(self) -> None:
        photo = self.photo(rating=0)

        response = self.client.post(
            "/api/photosedit/favorite/",
            {"image_hashes": [str(photo.pk)], "favorite": True},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.content)
        photo.refresh_from_db()
        self.assertGreaterEqual(photo.rating, self.user.favorite_min_rating)
        body = response.json()
        self.assertEqual(body["updated_hashes"], [str(photo.pk)])
        self.assertEqual(body["results"], [])

    def test_hashes_still_work_and_keys_are_reported_as_sent(self) -> None:
        by_hash = self.photo()
        by_id = self.photo()
        already = self.photo(in_trashcan=True)

        response = self.client.post(
            "/api/photosedit/setdeleted/",
            {
                "image_hashes": [
                    by_hash.image_hash,
                    str(by_id.pk),
                    str(already.pk),
                ],
                "deleted": True,
            },
            format="json",
        )

        body = response.json()
        self.assertEqual(body["updated_hashes"], [by_hash.image_hash, str(by_id.pk)])
        self.assertEqual(body["not_updated_hashes"], [str(already.pk)])
        self.assertEqual(
            Photo.objects.filter(
                pk__in=[by_hash.pk, by_id.pk], in_trashcan=True
            ).count(),
            2,
        )

    def test_another_users_photo_id_changes_nothing(self) -> None:
        theirs = self.photo(owner=self.other)

        response = self.client.post(
            "/api/photosedit/setdeleted/",
            {"image_hashes": [str(theirs.pk)], "deleted": True},
            format="json",
        )

        self.assertEqual(response.json()["updated_hashes"], [])
        theirs.refresh_from_db()
        self.assertFalse(theirs.in_trashcan)

    def test_delete_for_good_by_id(self) -> None:
        trashed = self.photo(in_trashcan=True)
        theirs = self.photo(owner=self.other, in_trashcan=True)

        response = self.client.delete(
            "/api/photosedit/delete/",
            {"image_hashes": [str(trashed.pk), str(theirs.pk)]},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["deleted"], [str(trashed.pk)])
        self.assertEqual(response.json()["not_deleted"], [str(theirs.pk)])
        self.assertTrue(Photo.objects.filter(pk=theirs.pk).exists())


class AlbumDeleteOnEditRouteTest(LegacyClientTestCase):
    def test_the_owner_deletes_an_album_on_the_edit_route(self) -> None:
        album = create_test_album_user(owner=self.user, title="Trip")
        response = self.client.delete(f"/api/albums/user/edit/{album.id}/")
        self.assertEqual(response.status_code, 204, response.content)
        self.assertFalse(AlbumUser.objects.filter(pk=album.pk).exists())

    def test_another_users_album_is_not_found(self) -> None:
        album = create_test_album_user(owner=self.other, title="Theirs")
        response = self.client.delete(f"/api/albums/user/edit/{album.id}/")
        self.assertEqual(response.status_code, 404)
        self.assertTrue(AlbumUser.objects.filter(pk=album.pk).exists())
