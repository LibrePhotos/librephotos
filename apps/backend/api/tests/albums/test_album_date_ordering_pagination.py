import datetime

from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from api.tests.utils import create_test_album_date, create_test_photo, create_test_user


class AlbumDatePhotoOrderingTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        timestamp = timezone.now()
        self.photos_by_filename = {}

        for filename in ("d.png", "b.png", "a.png", "c.png"):
            photo = create_test_photo(owner=self.user, exif_timestamp=timestamp)
            photo.main_file.path = f"/tmp/{filename}"
            photo.main_file.save(update_fields=["path"])
            self.photos_by_filename[filename] = photo

        self.album = create_test_album_date(
            date=timestamp.date(),
            owner=self.user,
        )
        self.album.photos.add(*self.photos_by_filename.values())

    def _page_hashes(self, page):
        response = self.client.get(
            f"/api/albums/date/{self.album.id}/",
            {"page": page, "page_size": 2},
        )
        self.assertEqual(response.status_code, 200)
        return [item["image_hash"] for item in response.json()["results"]["items"]]

    def test_equal_timestamps_are_ordered_before_pagination(self):
        hashes = self._page_hashes(1) + self._page_hashes(2)

        self.assertEqual(
            hashes,
            [
                self.photos_by_filename[filename].image_hash
                for filename in ("a.png", "b.png", "c.png", "d.png")
            ],
        )


class AlbumDatePageQueryTest(AlbumDatePhotoOrderingTest):
    """?page_size and ?page on a day album (#2326): ?size=x was int() and a 500."""

    def get(self, query: dict[str, str]):
        return self.client.get(f"/api/albums/date/{self.album.id}/", query)

    def items(self, query: dict[str, str]) -> int:
        response = self.get(query)
        self.assertEqual(response.status_code, 200)
        return len(response.json()["results"]["items"])

    def test_page_size_defaults_to_one_hundred_and_is_at_least_one(self):
        self.assertEqual(self.items({}), 4)
        self.assertEqual(self.items({"page_size": ""}), 4)
        self.assertEqual(self.items({"page_size": "0"}), 1)
        self.assertEqual(self.items({"page_size": "-3"}), 1)

    def test_a_non_numeric_page_is_still_the_first(self):
        self.assertEqual(self.items({"page_size": "3", "page": "x"}), 3)
        self.assertEqual(self.items({"page_size": "3", "page": "9"}), 1)

    def test_a_non_numeric_page_size_is_a_400(self):
        response = self.get({"page_size": "x"})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["errors"][0]["field"], "page_size")

    def test_the_old_size_alias_is_ignored(self):
        """``size`` was a deprecated alias of ``page_size`` up to 1.4.0 (#2500)."""
        self.assertEqual(self.items({"size": "3"}), 4)
        self.assertEqual(self.get({"size": "x"}).status_code, 200)

    def test_page_size_has_the_shared_bound(self):
        self.assertEqual(self.get({"page_size": "50000"}).json()["page_size"], 1000)

    def test_the_page_fields_sit_next_to_the_day(self):
        data = self.get({"page_size": "3", "page": "2"}).json()
        self.assertEqual(
            (data["count"], data["page"], data["page_size"], data["num_pages"]),
            (4, 2, 3, 2),
        )
        self.assertIsNone(data["next"])
        self.assertIn("page_size=3", data["previous"])
        self.assertEqual(data["results"]["numberOfItems"], 4)
        self.assertEqual(len(data["results"]["items"]), 1)


class PhotoOrderTest(TestCase):
    """``?order=oldest`` (#2712): the day list and a day's pages oldest first,
    the undated day last in either order."""

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.days = []
        for day in (3, 1, 2):
            taken = timezone.make_aware(datetime.datetime(2024, 5, day, 12))
            album = create_test_album_date(owner=self.user, date=taken.date())
            album.photos.add(create_test_photo(owner=self.user, exif_timestamp=taken))
            self.days.append(album)
        self.undated = create_test_album_date(owner=self.user)
        self.undated.photos.add(create_test_photo(owner=self.user, exif_timestamp=None))
        self.by_day = {album.date.day: album.pk for album in self.days}

    def day_ids(self, **params):
        response = self.client.get("/api/albums/date/list/", params)
        self.assertEqual(response.status_code, 200)
        return [day["id"] for day in response.json()["results"]]

    def test_newest_first_is_the_default(self):
        expected = [self.by_day[3], self.by_day[2], self.by_day[1], self.undated.pk]
        self.assertEqual(self.day_ids(), expected)
        self.assertEqual(self.day_ids(order="newest"), expected)

    def test_oldest_first_keeps_the_undated_day_last(self):
        self.assertEqual(
            self.day_ids(order="oldest"),
            [self.by_day[1], self.by_day[2], self.by_day[3], self.undated.pk],
        )

    def test_an_unknown_order_is_a_400_naming_it(self):
        response = self.client.get("/api/albums/date/list/", {"order": "random"})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["errors"][0]["field"], "order")

    def test_the_order_costs_no_queries(self):
        self.client.get("/api/albums/date/list/")  # warm the user's caches
        with CaptureQueriesContext(connection) as newest:
            self.client.get("/api/albums/date/list/")
        with CaptureQueriesContext(connection) as oldest:
            self.client.get("/api/albums/date/list/", {"order": "oldest"})
        self.assertEqual(len(newest), len(oldest))


class DayPageOrderTest(TestCase):
    """A day's photos page in the order the day list was asked for."""

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.album = create_test_album_date(
            owner=self.user, date=datetime.date(2024, 5, 1)
        )
        self.photos = []
        for hour in (9, 15, 11, 13):
            taken = timezone.make_aware(datetime.datetime(2024, 5, 1, hour))
            photo = create_test_photo(owner=self.user, exif_timestamp=taken)
            self.album.photos.add(photo)
            self.photos.append((hour, photo.image_hash))

    def pages(self, **params):
        hashes = []
        for page in (1, 2):
            response = self.client.get(
                f"/api/albums/date/{self.album.id}/",
                {"page": page, "page_size": 2, **params},
            )
            self.assertEqual(response.status_code, 200)
            hashes += [
                item["image_hash"] for item in response.json()["results"]["items"]
            ]
        return hashes

    def test_pages_follow_the_order(self):
        by_time = [image_hash for _, image_hash in sorted(self.photos)]
        self.assertEqual(self.pages(order="oldest"), by_time)
        self.assertEqual(self.pages(), list(reversed(by_time)))
