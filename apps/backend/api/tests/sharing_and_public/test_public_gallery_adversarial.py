"""What a visitor of the public gallery (#434) never gets, however they ask.

Readers: anonymous, and a signed-in user nothing is shared with. Owners: one
who shares everything (Anna), one with every switch off (Ben), one who does
not take part (Cleo). Every route, every filter, every stage of the admin's
switch.
"""

from __future__ import annotations

import datetime
import json
from unittest.mock import patch

from django.core.cache import cache
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.throttling import SimpleRateThrottle

from api.tests.sharing_and_public.gallery_fixtures import (
    ALL_OFF,
    DAY_ID,
    LISBON,
    SECRET_PATH,
    STREET,
    TAKEN,
    UNDATED_DAY_ID,
    GalleryFixture,
    gallery,
)
from api.tests.utils import create_test_face, create_test_person, create_test_user

LIST_ROUTES = (
    "/api/gallery/",
    "/api/gallery/days/",
    "/api/gallery/places/",
    "/api/gallery/people/",
    "/api/gallery/photographers/",
)


class GalleryAdversarialFixture(GalleryFixture):
    def everything(self, client, **params: object) -> str:
        """Every gallery answer to ``params``, as one string."""
        answers = [self.get(client, url, **params) for url in LIST_ROUTES]
        for day in (DAY_ID, UNDATED_DAY_ID):
            answers.append(self.get(client, "/api/gallery/photos/", day=day, **params))
        return json.dumps(answers)

    def assert_never_in(self, text: str, *needles: object) -> None:
        for needle in needles:
            self.assertNotIn(str(needle), text)


class NeverShownTest(GalleryAdversarialFixture):
    @gallery()
    def test_no_path_address_coordinates_user_place_or_cluster_anywhere(self):
        for name, client in self.readers().items():
            with self.subTest(reader=name):
                text = self.everything(client)
                self.assert_never_in(
                    text,
                    SECRET_PATH,
                    "secret-folder",
                    STREET,
                    "48.137",
                    "11.575",
                    "Anna's Home",
                    "Unknown 012",
                    "X-T5",
                )

    @gallery()
    def test_private_hidden_archived_trashed_and_stacked_photos_never(self):
        for name, client in self.readers().items():
            with self.subTest(reader=name):
                text = self.everything(client, owner=self.anna.pk)
                for photo in self.hidden_away:
                    self.assert_never_in(text, photo.pk, photo.image_hash)

    @gallery()
    def test_a_user_who_does_not_take_part_is_never_shown(self):
        for name, client in self.readers().items():
            for params in ({}, {"owner": self.cleo.pk}, {"place": "Munich"}):
                with self.subTest(reader=name, params=params):
                    text = self.everything(client, **params)
                    self.assert_never_in(
                        text, self.cleo_1.pk, self.cleo_1.image_hash, self.cleo.username
                    )

    @gallery()
    def test_a_signed_in_stranger_gets_exactly_what_a_visitor_gets(self):
        for params in ({}, {"owner": self.anna.pk}, {"person": self.anna_mia.pk}):
            with self.subTest(params=params):
                self.assertEqual(
                    self.everything(self.signed_in, **params),
                    self.everything(self.anonymous, **params),
                )

    @gallery()
    def test_an_owner_sees_their_own_photos_as_visitors_do(self):
        anna = self.signed_in
        anna.force_authenticate(self.anna)
        payload = self.get(anna, "/api/gallery/photos/", day=DAY_ID)
        for photo in payload["results"]:
            self.assertIsNone(photo["exif_gps_lat"])
            self.assertEqual(photo["location"], "")


class DatesOffTest(GalleryAdversarialFixture):
    @gallery()
    def test_dates_off_photos_are_in_no_day_however_asked(self):
        for name, client in self.readers().items():
            with self.subTest(reader=name):
                days = self.get(client, "/api/gallery/days/", owner=self.ben.pk)
                self.assertEqual(
                    [day["id"] for day in days["results"]], [UNDATED_DAY_ID]
                )
                self.assertEqual(
                    self.day_photo_ids(client, DAY_ID, owner=self.ben.pk), set()
                )
                self.assertEqual(
                    self.day_photo_ids(client, DAY_ID) & {str(self.ben_1.pk)}, set()
                )

    @gallery()
    def test_the_undated_group_is_in_an_order_that_says_nothing_about_dates(self):
        later = self.public_photo(
            self.ben, LISBON, exif_timestamp=TAKEN + datetime.timedelta(days=300)
        )
        payload = self.get(self.anonymous, "/api/gallery/photos/", day=UNDATED_DAY_ID)
        self.assertEqual(
            [photo["id"] for photo in payload["results"]],
            sorted([str(self.ben_1.pk), str(later.pk)]),
        )
        for photo in payload["results"]:
            self.assertEqual(photo["date"], "")
            self.assertEqual(photo["birthTime"], "")

    @gallery()
    def test_a_dates_off_owner_who_shares_places_names_no_day(self):
        self.switches(self.ben, location=True)
        days = self.get(self.anonymous, "/api/gallery/days/", place="Lisbon")
        self.assertEqual(
            days["results"],
            [{"id": UNDATED_DAY_ID, "date": None, "location": "", "photo_count": 1}],
        )
        # The town is on the places list, as a town only.
        places = self.get(self.anonymous, "/api/gallery/places/")["results"]
        self.assertIn("Lisbon", [place["name"] for place in places])


class FiltersReachOnlySharingOwnersTest(GalleryAdversarialFixture):
    @gallery()
    def test_a_town_filter_never_reaches_an_owner_who_keeps_places(self):
        for params in ({"place": "Lisbon"}, {"place": "Lisbon", "owner": self.ben.pk}):
            with self.subTest(params=params):
                days = self.get(self.anonymous, "/api/gallery/days/", **params)
                self.assertEqual(days["results"], [])
                self.assertEqual(
                    self.day_photo_ids(self.anonymous, UNDATED_DAY_ID, **params), set()
                )

    @gallery()
    def test_a_person_filter_never_reaches_an_owner_who_keeps_people(self):
        for person in (self.ben_mia, self.cluster):
            with self.subTest(person=person.name):
                days = self.get(self.anonymous, "/api/gallery/days/", person=person.pk)
                self.assertEqual(days["results"], [])

    @gallery()
    def test_a_person_filter_never_reaches_a_user_who_does_not_take_part(self):
        self.switches(self.cleo, faces=True, timestamps=True)
        cleo_person = create_test_person(name="Cleo's Kid", cluster_owner=self.cleo)
        create_test_face(photo=self.cleo_1, person=cleo_person)
        days = self.get(self.anonymous, "/api/gallery/days/", person=cleo_person.pk)
        self.assertEqual(days["results"], [])

    @gallery()
    def test_another_owners_person_on_a_photo_is_not_a_way_in(self):
        # A face on Anna's photo filed under Ben's person: not Anna's naming.
        create_test_face(photo=self.anna_2, person=self.ben_mia)
        self.switches(self.ben, faces=True)
        days = self.get(self.anonymous, "/api/gallery/days/", person=self.ben_mia.pk)
        self.assertEqual([day["id"] for day in days["results"]], [UNDATED_DAY_ID])

    @gallery()
    def test_a_deleted_face_is_no_one(self):
        create_test_face(photo=self.anna_2, person=self.anna_mia, deleted=True)
        self.assertEqual(
            self.day_photo_ids(self.anonymous, DAY_ID, person=self.anna_mia.pk),
            {str(self.anna_1.pk)},
        )


class EverySwitchOffTest(GalleryAdversarialFixture):
    @gallery()
    def test_photos_only_without_any_detail(self):
        self.anna.public_sharing_defaults = ALL_OFF
        self.anna.save()
        days = self.get(self.anonymous, "/api/gallery/days/")["results"]
        self.assertEqual([day["id"] for day in days], [UNDATED_DAY_ID])
        self.assertEqual(
            self.get(self.anonymous, "/api/gallery/places/")["results"], []
        )
        self.assertEqual(
            self.get(self.anonymous, "/api/gallery/people/")["results"], []
        )
        payload = self.get(self.anonymous, "/api/gallery/photos/", day=UNDATED_DAY_ID)
        self.assertEqual(payload["count"], 4)
        for photo in payload["results"]:
            self.assertEqual(photo["date"], "")
            self.assertEqual(photo["location"], "")
            self.assertIsNone(photo["exif_gps_lat"])
            self.assertEqual(photo["rating"], 0)
            self.assertIsNone(photo["stacks"])


class StagesTest(GalleryAdversarialFixture):
    def assert_closed(self, client) -> None:
        for url in (*LIST_ROUTES, "/api/gallery/photos/"):
            with self.subTest(url=url):
                response = client.get(url, {"day": DAY_ID})
                self.assertEqual(response.status_code, 404)
                self.assertNotIn(b"Anna", response.content)

    @gallery("off")
    def test_off_is_closed_to_everyone(self):
        for client in (self.anonymous, self.signed_in, self.admin_client):
            self.assert_closed(client)

    @gallery("members")
    def test_members_only_is_closed_to_visitors(self):
        self.assert_closed(self.anonymous)

    @gallery("anything else")
    def test_an_unknown_stage_is_off(self):
        self.assert_closed(self.signed_in)


class ConstantQueriesTest(GalleryAdversarialFixture):
    def queries(self, url: str, **params: object) -> int:
        with CaptureQueriesContext(connection) as captured:
            self.get(self.anonymous, url, **params)
        return len(captured.captured_queries)

    def add_owners(self, count: int) -> None:
        for _ in range(count):
            owner = create_test_user(in_public_gallery=True)
            self.switches(owner, timestamps=True, location=True, faces=True)
            photo = self.public_photo(owner, {"places": ["X", "Munich", "Y"]})
            person = create_test_person(name="Mia", cluster_owner=owner)
            create_test_face(photo=photo, person=person)

    @gallery()
    def test_the_same_queries_for_two_owners_as_for_twelve(self):
        urls = [(url, {}) for url in LIST_ROUTES] + [
            ("/api/gallery/photos/", {"day": DAY_ID}),
            ("/api/gallery/days/", {"place": "Munich"}),
            ("/api/gallery/days/", {"person": self.anna_mia.pk}),
        ]
        for url, params in urls:
            self.get(self.anonymous, url, **params)
        before = [self.queries(url, **params) for url, params in urls]
        self.add_owners(10)
        after = [self.queries(url, **params) for url, params in urls]
        self.assertEqual(after, before)


class ThrottleTest(GalleryAdversarialFixture):
    @gallery()
    def test_visitors_without_an_account_are_throttled_and_users_are_not(self):
        cache.clear()
        self.addCleanup(cache.clear)
        with patch.dict(
            SimpleRateThrottle.THROTTLE_RATES, {"public_gallery": "2/minute"}
        ):
            codes = [
                self.anonymous.get("/api/gallery/days/").status_code for _ in range(3)
            ]
            self.assertEqual(codes, [200, 200, 429])
            signed_in = [
                self.signed_in.get("/api/gallery/days/").status_code for _ in range(3)
            ]
            self.assertEqual(signed_in, [200, 200, 200])
