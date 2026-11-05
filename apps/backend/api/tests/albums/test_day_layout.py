"""``GET /api/days/<id>/layout/``: a day's aspect ratios in its order, and its page cursors.

The web grid lays out the photos it has not loaded yet with these, so a day of
many pages keeps still while they arrive. That only works if the n-th ratio is
the n-th photo of ``/photos/``, under the same filters, and if ``page_after[i]``
opens page i.
"""

import datetime

from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from api.tests.utils import (
    create_test_face,
    create_test_person,
    create_test_photo,
    create_test_user,
)

RATIOS = [1.5, 0.75, 1.33, 1.0, 2.4, 0.56, 1.78]
DAY = 20240501
UNDATED = 1


class DayLayoutTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        taken = timezone.make_aware(datetime.datetime(2024, 5, 1, 12), datetime.UTC)
        # Pairs share a time: the file path, then the pk, orders them.
        self.photos = [
            create_test_photo(
                owner=self.user,
                aspect_ratio=ratio,
                exif_timestamp=taken - datetime.timedelta(minutes=i // 2),
            )
            for i, ratio in enumerate(RATIOS)
        ]

    def layout(self, day=DAY, **params):
        response = self.client.get(f"/api/days/{day}/layout/", params)
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def pages(self, day=DAY, limit=2, **params):
        """The day's photos read page by page through the ``next`` cursors."""
        pages, after = [], None
        while True:
            query = {"limit": limit, **params, **({"after": after} if after else {})}
            response = self.client.get(f"/api/days/{day}/photos/", query)
            self.assertEqual(response.status_code, 200, response.content)
            data = response.json()
            pages.append(data["items"])
            after = data["next"]
            if after is None:
                return pages

    def paged_ratios(self, **params):
        return [item["aspectRatio"] for page in self.pages(**params) for item in page]

    def test_the_ratios_follow_the_pages(self):
        data = self.layout()
        self.assertEqual(data["id"], DAY)
        self.assertEqual(data["numberOfItems"], len(RATIOS))
        self.assertEqual(sorted(data["aspectRatios"]), sorted(RATIOS))
        self.assertEqual(data["aspectRatios"], self.paged_ratios())

    def test_page_after_opens_each_page(self):
        data = self.layout(limit=2)
        pages = self.pages(limit=2)
        self.assertEqual(len(data["page_after"]), len(pages))
        self.assertIsNone(data["page_after"][0])
        for after, page in zip(data["page_after"], pages):
            query = {"limit": 2, **({"after": after} if after else {})}
            items = self.client.get(f"/api/days/{DAY}/photos/", query).json()["items"]
            self.assertEqual([i["id"] for i in items], [i["id"] for i in page])

    def test_oldest_first_follows_the_pages_too(self):
        data = self.layout(order="oldest")
        self.assertEqual(data["aspectRatios"], self.paged_ratios(order="oldest"))
        # Oldest first by time; photos taken together stay in path order.
        self.assertNotEqual(data["aspectRatios"], self.layout()["aspectRatios"])

    def test_the_day_count_matches_the_day_list(self):
        days = self.client.get("/api/days/").json()["results"]
        listed = next(day for day in days if day["id"] == DAY)
        self.assertEqual(self.layout()["numberOfItems"], listed["numberOfItems"])

    def test_filters_apply_as_on_the_pages(self):
        hidden = self.photos[0]
        hidden.hidden = True
        hidden.save(update_fields=["hidden"])
        self.assertEqual(self.layout()["numberOfItems"], len(RATIOS) - 1)
        self.assertEqual(self.layout()["aspectRatios"], self.paged_ratios())
        self.assertEqual(self.layout(hidden="true")["aspectRatios"], [RATIOS[0]])

    def test_a_person_with_two_faces_on_a_photo_counts_it_once(self):
        person = create_test_person(cluster_owner=self.user)
        create_test_face(photo=self.photos[1], person=person)
        create_test_face(photo=self.photos[1], person=person)
        create_test_face(photo=self.photos[4], person=person)
        data = self.layout(person=person.id)
        self.assertEqual(data["aspectRatios"], self.paged_ratios(person=person.id))
        self.assertEqual(sorted(data["aspectRatios"]), sorted([RATIOS[1], RATIOS[4]]))

    def test_another_user_sees_none_of_these_photos(self):
        other = APIClient()
        other.force_authenticate(user=create_test_user())
        response = other.get(f"/api/days/{DAY}/layout/")
        self.assertIn(response.status_code, (200, 404))
        if response.status_code == 200:
            self.assertEqual(response.json()["aspectRatios"], [])

    def test_signed_out_is_refused(self):
        response = APIClient().get(f"/api/days/{DAY}/layout/")
        self.assertIn(response.status_code, (401, 403))

    def test_the_query_count_does_not_grow_with_the_day(self):
        self.layout()  # warm the user's caches
        with CaptureQueriesContext(connection) as before:
            self.layout()
        taken = self.photos[0].exif_timestamp
        for _ in range(20):
            create_test_photo(owner=self.user, aspect_ratio=1.5, exif_timestamp=taken)
        with CaptureQueriesContext(connection) as after:
            data = self.layout()
        self.assertEqual(data["numberOfItems"], len(RATIOS) + 20)
        self.assertEqual(len(before), len(after))


class UndatedDayLayoutTest(TestCase):
    def test_the_undated_day_has_a_layout(self):
        user = create_test_user()
        client = APIClient()
        client.force_authenticate(user=user)
        for ratio in RATIOS:
            create_test_photo(owner=user, exif_timestamp=None, aspect_ratio=ratio)
        data = client.get(f"/api/days/{UNDATED}/layout/").json()
        first = client.get(f"/api/days/{UNDATED}/photos/", {"limit": 4}).json()
        rest = client.get(
            f"/api/days/{UNDATED}/photos/", {"limit": 4, "after": first["next"]}
        ).json()
        paged = [item["aspectRatio"] for item in first["items"] + rest["items"]]
        self.assertEqual(data["aspectRatios"], paged)
