"""``/api/days/``: the day list, a day's pages and its layout.

A day is the wall-clock date of a photo's ``exif_timestamp`` (stored as UTC);
its id is YYYYMMDD, or 1 for the photos without one. A day's photos page by
cursor (``after`` = the last photo of the previous page), never by offset, so
these tests walk every day page by page and check the pages against the day
list's counts and the layout's order.
"""

import datetime
import uuid

from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from api.models.photo_stack import PhotoStack
from api.tests.utils import (
    api_error,
    create_test_face,
    create_test_file,
    create_test_library_share,
    create_test_person,
    create_test_photo,
    create_test_stack,
    create_test_user,
    day_photo_ids,
    every_public_switch_on,
    list_days,
)
from api.timeline.days import UNDATED_DAY_ID

UTC = datetime.UTC
DAY = datetime.date(2024, 5, 1)
DAY_ID = 20240501


def at(hour, minute=0, second=0, day=DAY):
    return datetime.datetime(
        day.year, day.month, day.day, hour, minute, second, tzinfo=UTC
    )


def geolocation(town):
    return {"places": ["Main Street 1", town, "Land"], "features": []}


def set_path(photo, path):
    photo.main_file.path = path
    photo.main_file.save(update_fields=["path"])
    return photo


def client_for(user=None):
    client = APIClient()
    client.raise_request_exception = False
    if user is not None:
        client.force_authenticate(user=user)
    return client


class DaysTestCase(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.client = client_for(self.user)

    def photo(self, owner=None, **kwargs):
        kwargs.setdefault("exif_timestamp", at(12))
        return create_test_photo(owner=owner or self.user, **kwargs)

    def page(self, day, client=None, **params):
        response = (client or self.client).get(f"/api/days/{day}/photos/", params)
        self.assertEqual(200, response.status_code, response.content)
        return response.json()

    def layout(self, day, client=None, **params):
        response = (client or self.client).get(f"/api/days/{day}/layout/", params)
        self.assertEqual(200, response.status_code, response.content)
        return response.json()

    def ids(self, day, client=None, **params):
        return day_photo_ids(client or self.client, day, params)

    def counts(self, client=None, **params):
        return {
            day["id"]: day["numberOfItems"]
            for day in list_days(client or self.client, params)
        }

    def assert_counts_match_pages(self, client=None, **params):
        """Every day's count is the number of photos its pages hand out, and
        its layout lists the same photos in the same order."""
        client = client or self.client
        counts = self.counts(client, **params)
        for day, count in counts.items():
            with self.subTest(day=day, params=params):
                walked = day_photo_ids(client, day, params, limit=2)
                self.assertEqual(count, len(walked))
                self.assertEqual(len(walked), len(set(walked)))
                layout = self.layout(day, client, **params)
                self.assertEqual(count, layout["numberOfItems"])
                self.assertEqual(count, len(layout["aspectRatios"]))
        return counts


class DayListTest(DaysTestCase):
    """The day list (#2712): newest or oldest first, the undated group last."""

    def setUp(self):
        super().setUp()
        for day in (3, 1, 2):
            self.photo(exif_timestamp=at(12, day=datetime.date(2024, 5, day)))
        self.photo(exif_timestamp=None)

    def day_ids(self, **params):
        return [day["id"] for day in list_days(self.client, params)]

    def test_a_row_is_the_day_its_count_and_place(self):
        (first, *_) = list_days(self.client)
        self.assertEqual(
            {"id": 20240503, "date": "2024-05-03", "location": "", "numberOfItems": 1},
            first,
        )
        undated = list_days(self.client)[-1]
        self.assertEqual(
            {"id": UNDATED_DAY_ID, "date": None, "location": "", "numberOfItems": 1},
            undated,
        )

    def test_newest_first_is_the_default(self):
        expected = [20240503, 20240502, 20240501, UNDATED_DAY_ID]
        self.assertEqual(expected, self.day_ids())
        self.assertEqual(expected, self.day_ids(order="newest"))

    def test_oldest_first_keeps_the_undated_group_last(self):
        self.assertEqual(
            [20240501, 20240502, 20240503, UNDATED_DAY_ID], self.day_ids(order="oldest")
        )

    def test_an_unknown_order_is_a_400_naming_it(self):
        response = self.client.get("/api/days/", {"order": "random"})
        self.assertEqual(400, response.status_code)
        self.assertEqual("order", api_error(response)["field"])

    def test_the_order_costs_no_queries(self):
        self.client.get("/api/days/")  # warm the user's caches
        with CaptureQueriesContext(connection) as newest:
            self.client.get("/api/days/")
        with CaptureQueriesContext(connection) as oldest:
            self.client.get("/api/days/", {"order": "oldest"})
        self.assertEqual(len(newest), len(oldest))

    def test_a_photo_late_in_the_day_stays_on_its_day(self):
        """The day is the wall-clock date stored as UTC: no shift at midnight."""
        self.photo(exif_timestamp=at(23, 59, 59, day=datetime.date(2024, 6, 1)))
        self.photo(exif_timestamp=at(0, 0, 0, day=datetime.date(2024, 6, 2)))
        self.assertEqual(
            {20240601: 1, 20240602: 1},
            {day: count for day, count in self.counts().items() if day >= 20240601},
        )

    def test_writes_are_not_allowed(self):
        for method, url in (
            ("post", "/api/days/"),
            ("put", f"/api/days/{DAY_ID}/photos/"),
            ("patch", f"/api/days/{DAY_ID}/photos/"),
            ("delete", f"/api/days/{DAY_ID}/photos/"),
            ("post", f"/api/days/{DAY_ID}/layout/"),
        ):
            with self.subTest(method=method, url=url):
                response = getattr(self.client, method)(url, {}, format="json")
                self.assertEqual(405, response.status_code)


class DayOrderTest(DaysTestCase):
    """A day's photos: by date taken, then file path (#1937), then id."""

    def setUp(self):
        super().setUp()
        self.by_hour = {}
        for hour in (9, 15, 11, 13):
            photo = self.photo(exif_timestamp=at(hour))
            self.by_hour[hour] = str(photo.pk)
        # Taken in the same second: a burst, ordered by file name.
        self.burst = {}
        for name in ("d.png", "b.png", "a.png", "c.png"):
            photo = set_path(self.photo(exif_timestamp=at(10)), f"/burst/{name}")
            self.burst[name] = str(photo.pk)

    def expected(self, order):
        burst = [self.burst[name] for name in sorted(self.burst)]
        hours = sorted(self.by_hour, reverse=order == "newest")
        expected = []
        for hour in hours:
            if order == "newest" and hour == 9:
                expected += burst
            expected.append(self.by_hour[hour])
            if order == "oldest" and hour == 9:
                expected += burst
        return expected

    def test_pages_walk_the_day_once_in_order(self):
        for order in ("newest", "oldest"):
            for limit in (1, 2, 3, 8, 100):
                with self.subTest(order=order, limit=limit):
                    walked = day_photo_ids(
                        self.client, DAY_ID, {"order": order}, limit=limit
                    )
                    self.assertEqual(self.expected(order), walked)

    def test_same_second_photos_go_by_path_in_either_order(self):
        """A burst reads as the camera numbered it, newest first or not."""
        burst = [self.burst[name] for name in sorted(self.burst)]
        for order in ("newest", "oldest"):
            with self.subTest(order=order):
                walked = self.ids(DAY_ID, order=order)
                start = walked.index(burst[0])
                self.assertEqual(burst, walked[start : start + 4])

    def test_the_layout_lists_the_pages_order(self):
        for order in ("newest", "oldest"):
            with self.subTest(order=order):
                layout = self.layout(DAY_ID, order=order, limit=3)
                self.assertEqual(8, layout["numberOfItems"])
                self.assertEqual([1.0] * 8, layout["aspectRatios"])
                expected = self.expected(order)
                # One cursor per page: none for the first, then the photo
                # before each page.
                self.assertEqual([None, expected[2], expected[5]], layout["page_after"])
                for index, cursor in enumerate(layout["page_after"]):
                    params = {"order": order, "limit": 3}
                    if cursor is not None:
                        params["after"] = cursor
                    page = self.page(DAY_ID, **params)
                    self.assertEqual(
                        expected[index * 3 : index * 3 + 3],
                        [item["id"] for item in page["items"]],
                    )

    def test_the_layout_pages_by_one_hundred_by_default(self):
        layout = self.layout(DAY_ID)
        self.assertEqual(
            {"id", "numberOfItems", "aspectRatios", "page_after"}, set(layout)
        )
        self.assertEqual(DAY_ID, layout["id"])
        self.assertEqual([None], layout["page_after"])

    def test_next_names_the_last_item_and_is_null_on_the_last_page(self):
        first = self.page(DAY_ID, limit=5)
        self.assertEqual(5, len(first["items"]))
        self.assertEqual(first["items"][-1]["id"], first["next"])
        last = self.page(DAY_ID, limit=5, after=first["next"])
        self.assertEqual(3, len(last["items"]))
        self.assertIsNone(last["next"])
        # A page that ends exactly at the end of the day has no next either.
        exact = self.page(DAY_ID, limit=8)
        self.assertEqual(8, len(exact["items"]))
        self.assertIsNone(exact["next"])

    def test_a_photo_taken_on_another_day_is_not_in_this_one(self):
        other = self.photo(exif_timestamp=at(12, day=datetime.date(2024, 5, 2)))
        self.assertNotIn(str(other.pk), self.ids(DAY_ID))
        self.assertEqual([str(other.pk)], self.ids(20240502))


class UndatedGroupOrderTest(DaysTestCase):
    """The undated group goes by file path, then id."""

    def test_pages_walk_the_group_by_path(self):
        by_name = {}
        for name in ("c.jpg", "a.jpg", "e.jpg", "b.jpg", "d.jpg"):
            photo = set_path(self.photo(exif_timestamp=None), f"/undated/{name}")
            by_name[name] = str(photo.pk)
        expected = [by_name[name] for name in sorted(by_name)]
        for order in ("newest", "oldest"):
            for limit in (1, 2, 5):
                with self.subTest(order=order, limit=limit):
                    walked = day_photo_ids(
                        self.client, UNDATED_DAY_ID, {"order": order}, limit=limit
                    )
                    self.assertEqual(expected, walked)
        layout = self.layout(UNDATED_DAY_ID, limit=2)
        self.assertEqual(UNDATED_DAY_ID, layout["id"])
        self.assertEqual([None, expected[1], expected[3]], layout["page_after"])


class SameFileTieTest(DaysTestCase):
    """Two users who scanned the same folder share its file rows: their
    photos of it sort on the same path and second, and the id breaks the tie
    so a cursor still walks each photo exactly once."""

    def setUp(self):
        super().setUp()
        self.partner = create_test_user()
        create_test_library_share(
            owner=self.partner, recipient=self.user, show_in_timeline=True
        )
        self.photos = []
        for name in ("a.jpg", "b.jpg"):
            shared_file = create_test_file(
                f"/shared/{name}", hash_value=uuid.uuid4().hex
            )
            mine = self.photo(main_file=shared_file, exif_timestamp=at(10))
            theirs = self.photo(
                owner=self.partner, main_file=shared_file, exif_timestamp=at(10)
            )
            self.photos.append(sorted([str(mine.pk), str(theirs.pk)]))

    def test_the_id_breaks_a_path_tie(self):
        expected = self.photos[0] + self.photos[1]
        for order in ("newest", "oldest"):
            for limit in (1, 3):
                with self.subTest(order=order, limit=limit):
                    walked = day_photo_ids(
                        self.client,
                        DAY_ID,
                        {"libraries": "true", "order": order},
                        limit=limit,
                    )
                    self.assertEqual(expected, walked)


class CursorTest(DaysTestCase):
    """``after`` must name a photo of that day in that view: anything else is
    a 400 on ``after``, the same 400 whether the photo exists or not, so a
    cursor cannot tell where another user's (or a hidden) photo sorts."""

    def setUp(self):
        super().setUp()
        self.mine = [self.photo(exif_timestamp=at(hour)) for hour in (9, 10, 11)]
        self.other_day = self.photo(exif_timestamp=at(9, day=datetime.date(2024, 5, 2)))
        self.undated = self.photo(exif_timestamp=None)
        self.hidden = self.photo(exif_timestamp=at(10, 30), hidden=True)
        self.trashed = self.photo(exif_timestamp=at(10, 30), in_trashcan=True)
        self.screenshot = self.photo(exif_timestamp=at(10, 45), is_screenshot=True)
        self.stranger = create_test_user()
        self.foreign = self.photo(owner=self.stranger, exif_timestamp=at(10, 15))

    def assert_stale(self, day, after, **params):
        response = self.client.get(
            f"/api/days/{day}/photos/", {"after": str(after), **params}
        )
        self.assertEqual(400, response.status_code, response.content)
        error = api_error(response)
        self.assertEqual("after", error["field"])
        return error["message"]

    def test_a_cursor_of_the_day_continues_after_it(self):
        page = self.page(DAY_ID, after=str(self.mine[2].pk))
        self.assertEqual(
            [str(self.screenshot.pk), str(self.mine[1].pk), str(self.mine[0].pk)],
            [item["id"] for item in page["items"]],
        )

    def test_a_photo_of_another_day_is_no_cursor(self):
        self.assert_stale(DAY_ID, self.other_day.pk)
        self.assert_stale(DAY_ID, self.undated.pk)
        self.assert_stale(UNDATED_DAY_ID, self.mine[0].pk)
        self.assert_stale(20240502, self.mine[0].pk)

    def test_another_users_photo_is_no_cursor(self):
        unknown = self.assert_stale(DAY_ID, uuid.uuid4())
        foreign = self.assert_stale(DAY_ID, self.foreign.pk)
        # The same answer as for a photo that does not exist: nothing tells
        # whether the stranger has a photo that day, or where it sorts.
        self.assertEqual(unknown, foreign)
        # Not in their own view either: a stranger's day is not the
        # requester's to page through.
        stranger = client_for(self.stranger)
        response = stranger.get(
            f"/api/days/{DAY_ID}/photos/", {"after": str(self.mine[0].pk)}
        )
        self.assertEqual(400, response.status_code)

    def test_a_photo_the_view_hides_is_no_cursor(self):
        self.assert_stale(DAY_ID, self.hidden.pk)
        self.assert_stale(DAY_ID, self.trashed.pk)
        self.assert_stale(DAY_ID, self.screenshot.pk, hide_screenshots="true")
        self.assert_stale(DAY_ID, self.mine[0].pk, hidden="true")
        # In the views that show them they are cursors as usual.
        self.assertEqual(
            [], self.page(DAY_ID, hidden="true", after=str(self.hidden.pk))["items"]
        )
        self.assertEqual(
            [str(self.screenshot.pk)],
            [
                item["id"]
                for item in self.page(DAY_ID, after=str(self.mine[2].pk), limit=1)[
                    "items"
                ]
            ],
        )

    def test_a_cursor_whose_photo_moved_is_stale(self):
        cursor = self.mine[1].pk
        self.mine[1].exif_timestamp = at(9, day=datetime.date(2023, 1, 1))
        self.mine[1].save()
        self.assert_stale(DAY_ID, cursor)


class LimitTest(DaysTestCase):
    def setUp(self):
        super().setUp()
        for hour in range(3):
            self.photo(exif_timestamp=at(hour))

    def test_limit_is_one_to_five_hundred(self):
        for limit in ("0", "-1", "501"):
            with self.subTest(limit=limit):
                response = self.client.get(
                    f"/api/days/{DAY_ID}/photos/", {"limit": limit}
                )
                self.assertEqual(400, response.status_code)
                self.assertEqual("limit", api_error(response)["field"])
        self.assertEqual(1, len(self.page(DAY_ID, limit=1)["items"]))
        self.assertEqual(3, len(self.page(DAY_ID, limit=500)["items"]))
        self.assertEqual(3, len(self.page(DAY_ID)["items"]))

    def test_a_page_costs_the_same_queries_for_any_number_of_photos(self):
        self.page(DAY_ID)  # warm the user's caches
        with CaptureQueriesContext(connection) as small:
            self.page(DAY_ID)
        for hour in range(3, 15):
            self.photo(exif_timestamp=at(hour))
        with CaptureQueriesContext(connection) as large:
            self.assertEqual(15, len(self.page(DAY_ID)["items"]))
        self.assertEqual(len(small), len(large))


class DayIdTest(DaysTestCase):
    def test_one_is_the_undated_group(self):
        undated = self.photo(exif_timestamp=None)
        self.photo()
        self.assertEqual([str(undated.pk)], self.ids(UNDATED_DAY_ID))

    def test_an_id_that_names_no_day_is_a_404(self):
        self.photo()
        for day in ("20231399", "20230230", "0", "2", "abc", "99999999999999999999"):
            for endpoint in ("photos", "layout"):
                with self.subTest(day=day, endpoint=endpoint):
                    response = self.client.get(f"/api/days/{day}/{endpoint}/")
                    self.assertEqual(404, response.status_code)

    def test_a_day_without_photos_is_an_empty_page(self):
        self.photo()
        self.assertEqual({"items": [], "next": None}, self.page(20000101))
        self.assertEqual(0, self.layout(20000101)["numberOfItems"])


class OwnerScopeTest(DaysTestCase):
    """A day id is a date: any user may ask for it, and gets their own
    photos of that day (or none), never another user's, nor their place."""

    SECRET_PLACE = "Secret Clinic Town"

    def setUp(self):
        super().setUp()
        self.victim = create_test_user(public_sharing=True)
        self.victim_photo = self.photo(
            owner=self.victim, geolocation_json=geolocation(self.SECRET_PLACE)
        )

    def assert_reveals_nothing(self, response):
        self.assertIn(response.status_code, (200, 404))
        body = response.content.decode()
        self.assertNotIn(self.SECRET_PLACE, body)
        self.assertNotIn(str(self.victim_photo.pk), body)
        self.assertNotIn(self.victim_photo.image_hash, body)

    def test_another_users_day_is_empty(self):
        for url in (
            "/api/days/",
            f"/api/days/{DAY_ID}/photos/",
            f"/api/days/{DAY_ID}/layout/",
        ):
            with self.subTest(url=url):
                self.assert_reveals_nothing(self.client.get(url))
        self.assertEqual({}, self.counts())
        self.assertEqual(0, self.layout(DAY_ID)["numberOfItems"])

    def test_the_public_flag_does_not_open_private_photos(self):
        for user in (self.user, None):
            for params in (
                {"public": "1"},
                {"public": "1", "username": self.victim.username},
                {"public": "1", "username": self.user.username},
            ):
                for url in (
                    "/api/days/",
                    f"/api/days/{DAY_ID}/photos/",
                    f"/api/days/{UNDATED_DAY_ID}/photos/",
                ):
                    with self.subTest(user=user, params=params, url=url):
                        self.assert_reveals_nothing(client_for(user).get(url, params))

    def test_the_owner_reads_their_own_day(self):
        owner = client_for(self.victim)
        (day,) = list_days(owner)
        self.assertEqual(
            (DAY_ID, self.SECRET_PLACE, 1),
            (day["id"], day["location"], day["numberOfItems"]),
        )
        self.assertEqual([str(self.victim_photo.pk)], day_photo_ids(owner, DAY_ID))


class PublicViewTest(DaysTestCase):
    """``?public&username``: one user's public photos, by what they share."""

    def setUp(self):
        super().setUp()
        self.owner = create_test_user(
            public_sharing=True, public_sharing_defaults=every_public_switch_on()
        )
        self.public = [
            self.photo(owner=self.owner, public=True, exif_timestamp=at(hour))
            for hour in (8, 9)
        ]
        self.private = self.photo(owner=self.owner, exif_timestamp=at(10))
        self.private_day = self.photo(
            owner=self.owner, exif_timestamp=at(10, day=datetime.date(2024, 4, 1))
        )
        # The signed-in viewer's own private photo of the same day.
        self.viewer_photo = self.photo(exif_timestamp=at(11))
        self.anonymous = client_for()
        self.params = {"public": "true", "username": self.owner.username}

    def test_only_public_photos_and_their_days(self):
        for client in (self.anonymous, self.client):
            with self.subTest(signed_in=client is self.client):
                self.assertEqual(
                    {DAY_ID: 2}, self.assert_counts_match_pages(client, **self.params)
                )
                self.assertEqual(
                    [str(self.public[1].pk), str(self.public[0].pk)],
                    self.ids(DAY_ID, client, **self.params),
                )

    def test_public_without_a_username_is_no_view(self):
        """The public view is per user; everyone's public photos together are
        the public gallery (#434)."""
        for url in (
            "/api/days/",
            f"/api/days/{DAY_ID}/photos/",
            f"/api/days/{DAY_ID}/layout/",
        ):
            with self.subTest(url=url):
                self.assertEqual(
                    404, self.anonymous.get(url, {"public": "true"}).status_code
                )

    def test_a_user_without_a_public_profile_is_a_404(self):
        self.owner.public_sharing = False
        self.owner.save(update_fields=["public_sharing"])
        response = self.anonymous.get("/api/days/", self.params)
        self.assertEqual(404, response.status_code)
        # They still see their own public photos (the Public Links page).
        self.assertEqual(
            {DAY_ID: 2}, self.counts(client_for(self.owner), **self.params)
        )

    def test_anonymous_without_public_is_refused(self):
        for url in (
            "/api/days/",
            f"/api/days/{DAY_ID}/photos/",
            f"/api/days/{DAY_ID}/layout/",
        ):
            with self.subTest(url=url):
                self.assertEqual(401, self.anonymous.get(url).status_code)

    def test_a_private_photo_is_no_cursor_of_the_public_view(self):
        response = self.anonymous.get(
            f"/api/days/{DAY_ID}/photos/",
            {**self.params, "after": str(self.private.pk)},
        )
        self.assertEqual(400, response.status_code)
        self.assertEqual("after", api_error(response)["field"])


class PublicViewWithoutDatesTest(DaysTestCase):
    """An owner who keeps dates to themselves (``share_timestamps`` off): all
    their public photos are one undated group, ordered by id, so neither the
    day ids nor the order (file names carry dates too) tell when."""

    def setUp(self):
        super().setUp()
        switches = every_public_switch_on()
        switches["share_timestamps"] = False
        self.owner = create_test_user(
            public_sharing=True, public_sharing_defaults=switches
        )
        self.photos = []
        for index, day in enumerate((3, 1, 2, 1)):
            photo = self.photo(
                owner=self.owner,
                public=True,
                exif_timestamp=at(12, day=datetime.date(2024, 5, day)),
                geolocation_json=geolocation("Lisbon"),
            )
            set_path(photo, f"/photos/2024-05-0{day}-{index}.jpg")
            self.photos.append(str(photo.pk))
        self.photos.append(
            str(self.photo(owner=self.owner, public=True, exif_timestamp=None).pk)
        )
        self.anonymous = client_for()
        self.params = {"public": "true", "username": self.owner.username}

    def test_one_undated_group_without_a_place(self):
        self.assertEqual(
            [{"id": UNDATED_DAY_ID, "date": None, "location": "", "numberOfItems": 5}],
            list_days(self.anonymous, self.params),
        )

    def test_the_group_is_ordered_by_id(self):
        for order in ("newest", "oldest"):
            for limit in (1, 2, 100):
                with self.subTest(order=order, limit=limit):
                    walked = day_photo_ids(
                        self.anonymous,
                        UNDATED_DAY_ID,
                        {**self.params, "order": order},
                        limit=limit,
                    )
                    self.assertEqual(sorted(self.photos), walked)
        layout = self.layout(UNDATED_DAY_ID, self.anonymous, limit=2, **self.params)
        self.assertEqual(5, layout["numberOfItems"])
        self.assertEqual(
            [None, sorted(self.photos)[1], sorted(self.photos)[3]], layout["page_after"]
        )

    def test_only_the_undated_id_opens(self):
        for day in (20240501, 20240502, 20240503):
            for endpoint in ("photos", "layout"):
                with self.subTest(day=day, endpoint=endpoint):
                    response = self.anonymous.get(
                        f"/api/days/{day}/{endpoint}/", self.params
                    )
                    self.assertEqual(404, response.status_code)

    def test_the_owner_still_sees_their_days(self):
        owner = client_for(self.owner)
        self.assertEqual(
            {20240503: 1, 20240502: 1, 20240501: 2, UNDATED_DAY_ID: 1},
            self.counts(owner),
        )


class FilterTest(DaysTestCase):
    """The filters every day read takes, on the list and the pages alike."""

    def ids_and_count(self, **params):
        counts = self.assert_counts_match_pages(**params)
        ids = set(self.ids(DAY_ID, **params))
        self.assertEqual(counts.get(DAY_ID, 0), len(ids))
        return ids

    def test_the_default_hides_other_owners_hidden_and_trashed_photos(self):
        mine = self.photo()
        self.photo(owner=create_test_user())
        self.photo(hidden=True)
        self.photo(in_trashcan=True)
        self.assertEqual({str(mine.pk)}, self.ids_and_count())

    def test_a_photo_without_an_aspect_ratio_is_left_out(self):
        kept = self.photo()
        self.photo(aspect_ratio=None)
        self.assertEqual({str(kept.pk)}, self.ids_and_count())

    def test_favorite_uses_the_users_minimum_rating(self):
        self.user.favorite_min_rating = 4
        self.user.save()
        self.photo(rating=3)
        high = self.photo(rating=4)
        self.assertEqual({str(high.pk)}, self.ids_and_count(favorite="true"))

    def test_folder_filters_on_the_file_path(self):
        match = set_path(self.photo(), "/tmp/keepdir/a.png")
        other = set_path(self.photo(), "/tmp/otherdir/b.png")
        for photo in (match, other):
            photo.files.add(photo.main_file)
        self.assertEqual({str(match.pk)}, self.ids_and_count(folder="/tmp/keepdir"))

    def test_hidden_true_shows_only_hidden_photos(self):
        self.photo()
        hidden = self.photo(hidden=True)
        self.assertEqual({str(hidden.pk)}, self.ids_and_count(hidden="true"))

    def test_video_and_photo_flags(self):
        still = self.photo()
        video = self.photo(video=True)
        self.assertEqual({str(video.pk)}, self.ids_and_count(video="true"))
        self.assertEqual({str(still.pk)}, self.ids_and_count(photo="true"))
        self.assertEqual(set(), self.ids_and_count(video="true", photo="true"))

    def test_screenshot_and_document_flags(self):
        plain = self.photo()
        screenshot = self.photo(is_screenshot=True)
        document = self.photo(is_document=True)
        self.assertEqual({str(screenshot.pk)}, self.ids_and_count(is_screenshot="true"))
        self.assertEqual({str(document.pk)}, self.ids_and_count(is_document="true"))
        self.assertEqual(
            {str(plain.pk), str(document.pk)},
            self.ids_and_count(hide_screenshots="true"),
        )

    def test_a_day_of_screenshots_only_leaves_the_list_when_they_are_hidden(self):
        self.photo()
        self.photo(
            is_screenshot=True, exif_timestamp=at(12, day=datetime.date(2024, 4, 1))
        )
        self.assertEqual({DAY_ID: 1, 20240401: 1}, self.counts())
        self.assertEqual(
            {DAY_ID: 1}, self.assert_counts_match_pages(hide_screenshots="true")
        )

    def test_the_trash_leaves_out_removed_photos(self):
        self.photo()
        trashed = self.photo(in_trashcan=True)
        self.photo(in_trashcan=True, removed=True)
        self.assertEqual({str(trashed.pk)}, self.ids_and_count(in_trashcan="true"))

    def test_stack_members_other_than_the_primary_need_show_all_stack_photos(self):
        primary = self.photo()
        secondary = self.photo()
        unstacked = self.photo()
        stack = create_test_stack(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
            primary_photo=primary,
        )
        primary.stacks.add(stack)
        secondary.stacks.add(stack)
        self.assertEqual({str(primary.pk), str(unstacked.pk)}, self.ids_and_count())
        self.assertEqual(
            {str(primary.pk), str(secondary.pk), str(unstacked.pk)},
            self.ids_and_count(show_all_stack_photos="true"),
        )

    def test_person_counts_a_photo_once_however_many_faces_show_them(self):
        tagged = self.photo()
        self.photo()
        person = create_test_person(cluster_owner=self.user)
        create_test_face(photo=tagged, person=person)
        create_test_face(photo=tagged, person=person)
        self.assertEqual({str(tagged.pk)}, self.ids_and_count(person=str(person.id)))

    def test_a_deleted_face_does_not_count(self):
        tagged = self.photo()
        person = create_test_person(cluster_owner=self.user)
        create_test_face(photo=tagged, person=person, deleted=True)
        self.assertEqual(set(), self.ids_and_count(person=str(person.id)))


class LibraryCountsTest(DaysTestCase):
    """Counts equal pages in the views that take a shared library."""

    def setUp(self):
        super().setUp()
        self.partner = create_test_user()
        create_test_library_share(
            owner=self.partner, recipient=self.user, show_in_timeline=True
        )
        self.mine = self.photo(exif_timestamp=at(9))
        self.theirs = self.photo(owner=self.partner, exif_timestamp=at(10))
        self.their_other_day = self.photo(
            owner=self.partner, exif_timestamp=at(10, day=datetime.date(2024, 4, 1))
        )
        self.photo(owner=self.partner, exif_timestamp=at(11), hidden=True)
        self.photo(owner=self.partner, exif_timestamp=at(11), in_trashcan=True)

    def test_own_view_leaves_the_library_out(self):
        self.assertEqual({DAY_ID: 1}, self.assert_counts_match_pages())

    def test_a_date_both_have_is_one_row(self):
        days = list_days(self.client, {"libraries": "true"})
        self.assertEqual([DAY_ID, 20240401], [day["id"] for day in days])
        self.assertEqual(
            {DAY_ID: 2, 20240401: 1}, self.assert_counts_match_pages(libraries="true")
        )
        self.assertEqual(
            [str(self.theirs.pk), str(self.mine.pk)],
            self.ids(DAY_ID, libraries="true"),
        )

    def test_one_library(self):
        params = {"library": str(self.partner.pk)}
        self.assertEqual(
            {DAY_ID: 1, 20240401: 1}, self.assert_counts_match_pages(**params)
        )
        self.assertEqual([str(self.theirs.pk)], self.ids(DAY_ID, **params))

    def test_a_library_without_a_share_is_a_404(self):
        stranger = create_test_user()
        self.photo(owner=stranger)
        for url in (
            "/api/days/",
            f"/api/days/{DAY_ID}/photos/",
            f"/api/days/{DAY_ID}/layout/",
        ):
            with self.subTest(url=url):
                response = self.client.get(url, {"library": str(stranger.pk)})
                self.assertEqual(404, response.status_code)

    def test_a_partners_hidden_photo_is_no_cursor(self):
        hidden = self.photo(owner=self.partner, exif_timestamp=at(12), hidden=True)
        for params in ({"libraries": "true"}, {"library": str(self.partner.pk)}):
            with self.subTest(params=params):
                response = self.client.get(
                    f"/api/days/{DAY_ID}/photos/", {**params, "after": str(hidden.pk)}
                )
                self.assertEqual(400, response.status_code)


class PlaceTest(DaysTestCase):
    """A day's place is the town of its earliest located photo, among the
    owners whose location the requester may see."""

    def location(self, day=DAY_ID, client=None, **params):
        rows = {row["id"]: row for row in list_days(client or self.client, params)}
        return rows[day]["location"]

    def test_the_earliest_located_photo_names_the_day(self):
        self.photo(exif_timestamp=at(7))
        self.photo(exif_timestamp=at(18), geolocation_json=geolocation("Milan"))
        self.photo(exif_timestamp=at(9), geolocation_json=geolocation("Rome"))
        self.assertEqual("Rome", self.location())
        # Oldest first or not, the place stays the same.
        self.assertEqual("Rome", self.location(order="oldest"))

    def test_a_day_without_a_located_photo_has_no_place(self):
        self.photo()
        self.photo(exif_timestamp=None, geolocation_json=geolocation("Rome"))
        self.assertEqual("", self.location())
        self.assertEqual("", self.location(UNDATED_DAY_ID))

    def test_a_hidden_or_trashed_photo_does_not_name_the_day(self):
        self.photo(
            exif_timestamp=at(7),
            hidden=True,
            geolocation_json=geolocation("Secretville"),
        )
        self.photo(
            exif_timestamp=at(8),
            in_trashcan=True,
            geolocation_json=geolocation("Binville"),
        )
        self.photo(exif_timestamp=at(9), geolocation_json=geolocation("Rome"))
        self.assertEqual("Rome", self.location())

    def test_a_sharer_without_share_location_names_no_place(self):
        partner = create_test_user()
        share = create_test_library_share(
            owner=partner, recipient=self.user, show_in_timeline=True
        )
        self.photo(
            owner=partner,
            exif_timestamp=at(7),
            geolocation_json=geolocation("Secretville"),
        )
        for params in ({"libraries": "true"}, {"library": str(partner.pk)}):
            with self.subTest(params=params):
                self.assertEqual("", self.location(**params))
        # With the recipient's own located photo later that day, theirs names it.
        self.photo(exif_timestamp=at(9), geolocation_json=geolocation("Rome"))
        self.assertEqual("Rome", self.location(libraries="true"))
        share.share_location = True
        share.save(update_fields=["share_location"])
        self.assertEqual("Secretville", self.location(libraries="true"))
        self.assertEqual("Secretville", self.location(library=str(partner.pk)))

    def test_the_public_view_names_no_place_without_share_location(self):
        switches = every_public_switch_on()
        switches["share_location"] = False
        owner = create_test_user(public_sharing=True, public_sharing_defaults=switches)
        self.photo(
            owner=owner, public=True, geolocation_json=geolocation("Secretville")
        )
        params = {"public": "true", "username": owner.username}
        self.assertEqual("", self.location(client=client_for(), **params))
        owner.public_sharing_defaults = every_public_switch_on()
        owner.save(update_fields=["public_sharing_defaults"])
        self.assertEqual("Secretville", self.location(client=client_for(), **params))

    def test_the_public_view_names_no_place_from_a_private_photo(self):
        """The place comes from the public photos only: a private photo of
        the day must not tell an anonymous visitor where its owner was."""
        owner = create_test_user(
            public_sharing=True, public_sharing_defaults=every_public_switch_on()
        )
        self.photo(
            owner=owner,
            exif_timestamp=at(7),
            geolocation_json=geolocation("Secretville"),
        )
        public = self.photo(owner=owner, exif_timestamp=at(9), public=True)
        params = {"public": "true", "username": owner.username}
        anonymous = client_for()
        self.assertEqual("", self.location(client=anonymous, **params))
        public.geolocation_json = geolocation("Lisbon")
        public.save()
        self.assertEqual("Lisbon", self.location(client=anonymous, **params))
        # The owner's own timeline names the day by its first located photo.
        self.assertEqual("Secretville", self.location(client=client_for(owner)))


class SummaryDayIdTest(DaysTestCase):
    """``/api/photos/<id>/summary/`` names the day the photo is listed under
    (``day_id``), so a client opens the timeline there. It must not tell a
    date the reader's view of the photo keeps back."""

    def summary(self, photo, client=None):
        response = (client or self.client).get(f"/api/photos/{photo.pk}/summary/")
        self.assertEqual(200, response.status_code, response.content)
        return response.json()

    def test_the_day_of_a_dated_and_an_undated_photo(self):
        self.assertEqual(DAY_ID, self.summary(self.photo())["day_id"])
        undated = self.photo(exif_timestamp=None)
        self.assertEqual(UNDATED_DAY_ID, self.summary(undated)["day_id"])
        # The same id under the name released clients read (UhuruPhotos).
        self.assertEqual(UNDATED_DAY_ID, self.summary(undated)["album_date_id"])

    def test_the_public_view_of_an_owner_hiding_dates_names_the_undated_group(self):
        switches = every_public_switch_on()
        switches["share_timestamps"] = False
        owner = create_test_user(public_sharing=True, public_sharing_defaults=switches)
        photo = self.photo(owner=owner, public=True)
        anonymous = client_for()
        summary = self.summary(photo, anonymous)
        self.assertEqual("", summary["photo_summary"]["date"])
        # The day the public page lists it under, and no date.
        self.assertEqual(UNDATED_DAY_ID, summary["day_id"])
        self.assertEqual(
            [str(photo.pk)],
            day_photo_ids(
                anonymous,
                summary["day_id"],
                {"public": "true", "username": owner.username},
            ),
        )
        owner.public_sharing_defaults = every_public_switch_on()
        owner.save(update_fields=["public_sharing_defaults"])
        self.assertEqual(DAY_ID, self.summary(photo, client_for())["day_id"])
