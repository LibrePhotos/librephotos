"""The public gallery (#434): one timeline, places, people and photographers of
every taking-part user's public photos.

The privacy side (what a visitor never gets) is
``test_public_gallery_adversarial.py``; this module pins what the gallery shows.
"""

from __future__ import annotations

from api.models import User
from api.tests.sharing_and_public.gallery_fixtures import (
    DAY_ID,
    UNDATED_DAY_ID,
    GalleryFixture,
    gallery,
)
from api.tests.utils import create_test_face, create_test_person, create_test_user


class GalleryTimelineTest(GalleryFixture):
    @gallery()
    def test_days_merge_owners_who_share_dates_and_the_rest_is_undated(self):
        days = self.get(self.anonymous, "/api/gallery/days/")["results"]
        self.assertEqual(
            days,
            [
                {
                    "id": DAY_ID,
                    "date": "2025-08-16",
                    "location": "Munich",
                    "photo_count": 3,
                },
                {"id": UNDATED_DAY_ID, "date": None, "location": "", "photo_count": 1},
            ],
        )

    @gallery()
    def test_a_day_photos_newest_first_without_coordinates_or_address(self):
        payload = self.get(self.anonymous, "/api/gallery/photos/", day=DAY_ID)
        self.assertEqual(payload["count"], 3)
        self.assertEqual(
            [photo["id"] for photo in payload["results"]][0], str(self.anna_2.pk)
        )
        for photo in payload["results"]:
            self.assertIsNone(photo["exif_gps_lat"])
            self.assertIsNone(photo["exif_gps_lon"])
            self.assertEqual(photo["location"], "")
            # Anna shares dates.
            self.assertTrue(photo["date"].startswith("2025-08-16"))
            self.assertEqual(photo["owner"]["id"], self.anna.pk)

    @gallery()
    def test_the_undated_group_holds_the_photos_of_owners_who_keep_dates(self):
        payload = self.get(self.anonymous, "/api/gallery/photos/", day=UNDATED_DAY_ID)
        self.assertEqual(self.ids(payload), {str(self.ben_1.pk)})
        self.assertEqual(payload["results"][0]["date"], "")
        self.assertEqual(payload["results"][0]["birthTime"], "")

    @gallery()
    def test_a_photo_without_a_date_of_an_owner_who_shares_dates_is_undated(self):
        undated = self.public_photo(self.anna, {}, exif_timestamp=None)
        self.assertIn(
            str(undated.pk), self.day_photo_ids(self.anonymous, UNDATED_DAY_ID)
        )

    @gallery()
    def test_a_day_mixing_an_owner_who_keeps_places_names_no_town(self):
        eve = create_test_user(in_public_gallery=True)
        self.switches(eve, timestamps=True)
        self.public_photo(eve, {"places": ["Somewhere", "Starnberg", "Germany"]})
        days = self.get(self.anonymous, "/api/gallery/days/")["results"]
        self.assertEqual(days[0]["photo_count"], 4)
        self.assertEqual(days[0]["location"], "")

    @gallery()
    def test_filter_by_owner(self):
        days = self.get(self.anonymous, "/api/gallery/days/", owner=self.ben.pk)
        self.assertEqual([day["id"] for day in days["results"]], [UNDATED_DAY_ID])
        self.assertEqual(
            self.day_photo_ids(self.anonymous, DAY_ID, owner=self.anna.pk),
            {str(self.anna_1.pk), str(self.anna_2.pk), str(self.anna_primary.pk)},
        )

    @gallery()
    def test_filter_by_town_and_person(self):
        self.assertEqual(
            self.day_photo_ids(self.anonymous, DAY_ID, place="Munich"),
            {str(self.anna_1.pk), str(self.anna_2.pk), str(self.anna_primary.pk)},
        )
        self.assertEqual(
            self.day_photo_ids(self.anonymous, DAY_ID, person=self.anna_mia.pk),
            {str(self.anna_1.pk)},
        )

    @gallery()
    def test_an_unknown_day_is_an_empty_page_and_a_day_that_cannot_be_is_a_404(self):
        self.assertEqual(self.day_photo_ids(self.anonymous, 20240101), set())
        self.assertEqual(
            self.anonymous.get("/api/gallery/photos/", {"day": 20251399}).status_code,
            404,
        )
        self.assertEqual(self.anonymous.get("/api/gallery/photos/").status_code, 400)


class GalleryListsTest(GalleryFixture):
    @gallery()
    def test_places_are_towns_of_owners_who_share_places(self):
        places = self.get(self.anonymous, "/api/gallery/places/")["results"]
        self.assertEqual([place["name"] for place in places], ["Munich"])
        self.assertEqual(places[0]["photo_count"], 3)
        self.assertEqual(places[0]["owner_ids"], [self.anna.pk])
        self.assertEqual(len(places[0]["cover_photos"]), 3)

    @gallery()
    def test_people_are_named_people_of_owners_who_share_people(self):
        people = self.get(self.anonymous, "/api/gallery/people/")["results"]
        self.assertEqual(
            [(person["name"], person["owner"]["id"]) for person in people],
            [("Mia", self.anna.pk)],
        )
        self.assertEqual(people[0]["photo_count"], 1)
        self.assertTrue(people[0]["face_url"])

    @gallery()
    def test_two_owners_people_of_the_same_name_stay_two(self):
        self.switches(self.ben, faces=True)
        people = self.get(self.anonymous, "/api/gallery/people/")["results"]
        self.assertEqual(
            sorted((person["name"], person["owner"]["id"]) for person in people),
            sorted([("Mia", self.anna.pk), ("Mia", self.ben.pk)]),
        )
        self.assertNotEqual(people[0]["id"], people[1]["id"])

    @gallery()
    def test_photographers_are_the_owners_who_take_part(self):
        photographers = self.get(self.anonymous, "/api/gallery/photographers/")
        self.assertEqual(
            [(row["id"], row["photo_count"]) for row in photographers["results"]],
            [(self.anna.pk, 3), (self.ben.pk, 1)],
        )
        self.assertEqual(
            set(photographers["results"][0]),
            {
                "id",
                "username",
                "first_name",
                "last_name",
                "photo_count",
                "cover_photos",
            },
        )

    @gallery()
    def test_summary(self):
        self.assertEqual(
            self.get(self.anonymous, "/api/gallery/"),
            {
                "stage": "everyone",
                "indexable": False,
                "photo_count": 4,
                "photographer_count": 2,
            },
        )


class GallerySwitchesTest(GalleryFixture):
    def test_off_by_default_and_every_route_is_a_404(self):
        for url in ROUTES:
            for name, client in {**self.readers(), "admin": self.admin_client}.items():
                with self.subTest(url=url, reader=name):
                    self.assertEqual(client.get(url, {"day": DAY_ID}).status_code, 404)

    @gallery("members")
    def test_members_only_opens_it_to_signed_in_users(self):
        for url in ROUTES:
            with self.subTest(url=url):
                self.assertEqual(
                    self.anonymous.get(url, {"day": DAY_ID}).status_code, 404
                )
                self.assertEqual(
                    self.signed_in.get(url, {"day": DAY_ID}).status_code, 200
                )

    @gallery()
    def test_noindex_unless_the_admin_lets_search_engines_in(self):
        response = self.anonymous.get("/api/gallery/days/")
        self.assertEqual(response["X-Robots-Tag"], "noindex, nofollow")
        with gallery(indexable=True):
            response = self.anonymous.get("/api/gallery/days/")
        self.assertNotIn("X-Robots-Tag", response)

    def test_the_admin_preview_counts_what_turning_it_on_publishes(self):
        payload = self.get(self.admin_client, "/api/gallery/preview/")
        self.assertEqual(payload["photo_count"], 4)
        self.assertEqual(payload["photographer_count"], 2)
        self.assertEqual(
            [row["id"] for row in payload["photographers"]], [self.anna.pk, self.ben.pk]
        )
        self.assertIn(self.signed_in.get("/api/gallery/preview/").status_code, (403,))
        self.assertIn(
            self.anonymous.get("/api/gallery/preview/").status_code, (401, 403)
        )

    def test_the_site_settings_carry_the_stage_to_everyone_and_admins_set_it(self):
        settings = self.get(self.anonymous, "/api/sitesettings/")
        self.assertEqual(settings["public_gallery"], "off")
        self.assertFalse(settings["public_gallery_indexable"])
        response = self.admin_client.post(
            "/api/sitesettings/",
            {"public_gallery": "members", "public_gallery_indexable": True},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["public_gallery"], "members")
        self.assertEqual(
            self.signed_in.post(
                "/api/sitesettings/", {"public_gallery": "everyone"}, format="json"
            ).status_code,
            403,
        )
        bad = self.admin_client.post(
            "/api/sitesettings/", {"public_gallery": "all"}, format="json"
        )
        self.assertEqual(bad.status_code, 400)

    def test_a_user_opts_in_and_out_on_their_own_account(self):
        client = self.signed_in
        response = client.patch(
            f"/api/user/{self.stranger.pk}/", {"in_public_gallery": True}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.stranger.refresh_from_db()
        self.assertTrue(self.stranger.in_public_gallery)
        other = client.patch(
            f"/api/user/{self.anna.pk}/", {"in_public_gallery": False}, format="json"
        )
        self.assertEqual(other.status_code, 403)
        self.assertTrue(User.objects.get(pk=self.anna.pk).in_public_gallery)

    @gallery()
    def test_opting_out_takes_the_photos_out_and_keeps_them_public(self):
        self.anna.in_public_gallery = False
        self.anna.save()
        self.assertEqual(self.day_photo_ids(self.anonymous, DAY_ID), set())
        # The photo's own link still works.
        self.assertEqual(
            self.anonymous.get(f"/api/photos/{self.anna_1.pk}/").status_code, 200
        )

    @gallery()
    def test_a_deactivated_user_is_out(self):
        self.anna.is_active = False
        self.anna.save()
        photographers = self.get(self.anonymous, "/api/gallery/photographers/")
        self.assertEqual([row["id"] for row in photographers["results"]], [self.ben.pk])

    @gallery()
    def test_a_face_without_a_crop_gives_no_url(self):
        eve = create_test_user(in_public_gallery=True)
        self.switches(eve, faces=True)
        photo = self.public_photo(eve, {})
        person = create_test_person(name="Zoe", cluster_owner=eve)
        create_test_face(photo=photo, person=person, image=None)
        people = self.get(self.anonymous, "/api/gallery/people/", owner=eve.pk)
        self.assertEqual(people["results"][0]["face_url"], None)


ROUTES = (
    "/api/gallery/",
    "/api/gallery/days/",
    "/api/gallery/photos/",
    "/api/gallery/places/",
    "/api/gallery/people/",
    "/api/gallery/photographers/",
)
