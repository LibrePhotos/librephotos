"""Rewind: a user's year in photos (``GET /api/rewind/``).

Every test asks for an explicit ``?year=`` so the suite does not depend on the
clock, except the one about the default year, which patches "today".
"""

import datetime
from unittest.mock import patch

from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIClient

from api.dataviz.rewind import rewind_year
from api.models import Person
from api.tests.utils import (
    create_test_face,
    create_test_person,
    create_test_photo,
    create_test_user,
)

UTC = datetime.UTC
BERLIN = {"places": ["Mitte", "Berlin", "Germany"]}
LISBON = {"places": ["Alfama", "Lisbon", "Portugal"]}
PORTO = {"places": ["Ribeira", "Porto", "Portugal"]}


def add_photo_on(user, day, **kwargs):
    """A photo taken at noon on ``day`` (its wall clock, stored as UTC)."""
    kwargs.setdefault(
        "exif_timestamp",
        datetime.datetime(day.year, day.month, day.day, 12, tzinfo=UTC),
    )
    return create_test_photo(owner=user, **kwargs)


class RewindYearTest(SimpleTestCase):
    def test_january_looks_back_on_the_last_year(self):
        self.assertEqual(rewind_year(datetime.date(2027, 1, 3)), 2026)

    def test_december_looks_back_on_this_year(self):
        self.assertEqual(rewind_year(datetime.date(2026, 12, 24)), 2026)


class RewindViewTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.other = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def get(self, year=2026):
        response = self.client.get(f"/api/rewind/?year={year}")
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def test_needs_a_login(self):
        self.client.force_authenticate(user=None)
        self.assertIn(self.client.get("/api/rewind/?year=2026").status_code, (401, 403))

    def test_an_empty_year(self):
        data = self.get()
        self.assertEqual(data["year"], 2026)
        self.assertEqual(data["photo_count"], 0)
        self.assertEqual(data["months"], [0] * 12)
        self.assertIsNone(data["busiest_day"])
        self.assertEqual(data["cover_photos"], [])
        self.assertEqual(data["people"], [])
        self.assertEqual(data["top_places"], [])

    def test_counts_only_the_users_own_photos_of_that_year(self):
        add_photo_on(self.user, datetime.date(2026, 3, 1))
        add_photo_on(self.user, datetime.date(2026, 3, 2), video=True)
        # A New Year's Eve photo a minute before midnight, wall clock: no
        # timezone moves it into the next year.
        new_years_eve = datetime.datetime(2025, 12, 31, 23, 59, tzinfo=UTC)
        add_photo_on(self.user, new_years_eve.date(), exif_timestamp=new_years_eve)
        add_photo_on(self.user, datetime.date(2026, 3, 3), is_screenshot=True)
        add_photo_on(self.user, datetime.date(2026, 3, 4), hidden=True)
        add_photo_on(self.user, datetime.date(2026, 3, 5), in_trashcan=True)
        add_photo_on(self.other, datetime.date(2026, 3, 1))
        shared = add_photo_on(self.other, datetime.date(2026, 3, 1))
        shared.shared_to.add(self.user)

        data = self.get()
        self.assertEqual(data["photo_count"], 1)
        self.assertEqual(data["video_count"], 1)
        self.assertEqual(data["months"][2], 2)
        self.assertEqual(sum(data["months"]), 2)

    def test_the_busiest_day_and_its_photos(self):
        for _ in range(3):
            add_photo_on(self.user, datetime.date(2026, 8, 14))
        favourite = add_photo_on(self.user, datetime.date(2026, 8, 14), rating=5)
        add_photo_on(self.user, datetime.date(2026, 2, 1))

        data = self.get()
        self.assertEqual(data["busiest_day"], {"date": "2026-08-14", "count": 4})
        self.assertEqual(len(data["busiest_day_photos"]), 4)
        self.assertEqual(
            data["busiest_day_photos"][0]["image_hash"], favourite.image_hash
        )
        self.assertEqual(data["months"][7], 4)
        # One cover per day, busiest day first.
        self.assertEqual(len(data["cover_photos"]), 2)
        self.assertEqual(data["cover_photos"][0]["image_hash"], favourite.image_hash)

    def test_the_named_people_on_the_most_photos(self):
        mia = create_test_person(name="Mia", cluster_owner=self.user)
        jonas = create_test_person(name="Jonas", cluster_owner=self.user)
        cluster = create_test_person(
            name="Cluster 1", kind=Person.KIND_CLUSTER, cluster_owner=self.user
        )
        for day in (1, 2, 3):
            photo = add_photo_on(self.user, datetime.date(2026, 5, day))
            create_test_face(photo=photo, person=mia)
            create_test_face(photo=photo, person=cluster)
        create_test_face(photo=photo, person=jonas)
        # Two faces of Mia on one photo still count it once.
        create_test_face(photo=photo, person=mia)

        people = self.get()["people"]
        self.assertEqual(
            [(person["name"], person["photo_count"]) for person in people],
            [("Mia", 3), ("Jonas", 1)],
        )

    def test_towns_and_countries(self):
        for _ in range(2):
            add_photo_on(self.user, datetime.date(2026, 6, 1), geolocation_json=LISBON)
        add_photo_on(self.user, datetime.date(2026, 6, 2), geolocation_json=PORTO)
        add_photo_on(self.user, datetime.date(2026, 6, 3), geolocation_json=BERLIN)
        add_photo_on(self.user, datetime.date(2026, 6, 4))

        data = self.get()
        self.assertEqual(data["place_count"], 3)
        self.assertEqual(data["country_count"], 2)
        self.assertEqual(
            data["top_places"],
            [
                {"name": "Lisbon", "photo_count": 2},
                {"name": "Berlin", "photo_count": 1},
                {"name": "Porto", "photo_count": 1},
            ],
        )

    @patch("api.views.rewind.today_for_user", return_value=datetime.date(2027, 1, 2))
    def test_the_default_year_in_january_is_the_last_one(self, _today):
        add_photo_on(self.user, datetime.date(2026, 7, 1))
        response = self.client.get("/api/rewind/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["year"], 2026)
        self.assertEqual(response.json()["photo_count"], 1)

    def test_a_year_out_of_range_is_refused(self):
        self.assertEqual(self.client.get("/api/rewind/?year=12").status_code, 400)


class CountStatsSupportFieldsTest(TestCase):
    """The thank-you dialog reads the library's size and its towns from /api/stats/."""

    def test_library_bytes_and_places(self):
        user = create_test_user()
        create_test_photo(owner=user, size=1000, geolocation_json=BERLIN)
        create_test_photo(owner=user, size=500, geolocation_json=BERLIN)
        create_test_photo(owner=user, size=250, geolocation_json=LISBON)
        create_test_photo(owner=create_test_user(), size=10_000)
        client = APIClient()
        client.force_authenticate(user=user)

        data = client.get("/api/stats/").json()
        self.assertEqual(data["library_bytes"], 1750)
        self.assertEqual(data["num_places"], 2)
