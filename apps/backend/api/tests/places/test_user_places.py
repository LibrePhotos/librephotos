"""Your places (#1365): circles the user names, and the photos inside them."""

import datetime
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from api.models.photo import LocationSource
from api.models.user_place import MAX_PLACES_PER_USER, UserPlace
from api.places.geometry import circle_bounds, distance_m
from api.places.membership import refresh_photo_places, refresh_user_places
from api.tests.utils import (
    create_test_album_auto,
    create_test_photo,
    create_test_user,
    create_test_user_place,
)

HOME = (48.13743, 11.57549)
# About 50 m east of HOME
NEXT_DOOR = (48.13743, 11.57616)
# About 1 km north of HOME
PARK = (48.14642, 11.57549)
BERLIN = (52.52001, 13.40495)
URL = "/api/user-places/"


def located(owner, position, **kwargs):
    lat, lon = position
    return create_test_photo(owner=owner, exif_gps_lat=lat, exif_gps_lon=lon, **kwargs)


def place_ids(photo):
    return list(photo.user_places.values_list("pk", flat=True))


class GeometryTest(TestCase):
    def test_distance(self):
        self.assertAlmostEqual(distance_m(*HOME, *NEXT_DOOR), 50, delta=1)
        self.assertAlmostEqual(distance_m(*HOME, *BERLIN) / 1000, 504, delta=2)

    def test_a_circle_box_holds_the_circle(self):
        box = circle_bounds(*HOME, 1000)
        self.assertLess(box.south, PARK[0] - 0.008)
        self.assertGreater(box.north, PARK[0])
        self.assertLess(box.west, HOME[1] - 0.013)

    def test_a_box_across_the_antimeridian_and_at_a_pole(self):
        box = circle_bounds(0.0, 179.9999, 2000)
        self.assertGreater(box.west, box.east)
        polar = circle_bounds(89.999, 0.0, 2000)
        self.assertEqual((polar.west, polar.east, polar.north), (-180.0, 180.0, 90.0))


class MembershipTest(TestCase):
    def setUp(self):
        self.user = create_test_user()

    def test_a_place_holds_the_photos_inside_it(self):
        home = create_test_user_place(self.user, "Home", center=HOME, radius_m=100)
        inside = located(self.user, NEXT_DOOR)
        outside = located(self.user, PARK)
        located(create_test_user(), NEXT_DOOR)

        refresh_user_places(self.user)

        self.assertEqual(list(home.photos.all()), [inside])
        self.assertEqual(place_ids(outside), [])

    def test_a_photo_inside_two_places_is_in_the_smaller(self):
        home = create_test_user_place(self.user, "Home", center=HOME, radius_m=100)
        town = create_test_user_place(self.user, "Town", center=HOME, radius_m=2000)
        garden = located(self.user, NEXT_DOOR)
        park = located(self.user, PARK)

        refresh_user_places(self.user)

        self.assertEqual(place_ids(garden), [home.pk])
        self.assertEqual(place_ids(park), [town.pk])

    def test_a_moved_photo_changes_place_and_one_without_a_position_leaves(self):
        home = create_test_user_place(self.user, "Home", center=HOME, radius_m=100)
        moved = located(self.user, NEXT_DOOR)
        cleared = located(self.user, NEXT_DOOR)
        refresh_user_places(self.user)
        before = UserPlace.objects.get(pk=home.pk).last_modified

        moved.exif_gps_lat, moved.exif_gps_lon = PARK
        moved.save()
        cleared.exif_gps_lat = cleared.exif_gps_lon = None
        cleared.save()
        refresh_photo_places([moved, cleared])

        self.assertEqual(list(home.photos.all()), [])
        self.assertGreater(UserPlace.objects.get(pk=home.pk).last_modified, before)

    def test_nothing_to_do_without_places(self):
        photo = located(self.user, NEXT_DOOR)
        refresh_photo_places([photo])
        self.assertEqual(place_ids(photo), [])


class UserPlaceApiTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def create(self, **fields):
        body = {
            "name": "Home",
            "icon": "home",
            "center_lat": HOME[0],
            "center_lon": HOME[1],
            "radius_m": 100,
            **fields,
        }
        return self.client.post(URL, body, format="json")

    def test_drawing_a_place_files_its_photos_and_answers_their_count(self):
        located(self.user, NEXT_DOOR)
        located(self.user, NEXT_DOOR, hidden=True)
        located(self.user, PARK)

        response = self.create()

        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        self.assertEqual(body["name"], "Home")
        self.assertEqual(body["icon"], "home")
        self.assertEqual(body["use_in_titles"], True)
        # The hidden photo is in the place but not counted
        self.assertEqual(body["photo_count"], 1)
        self.assertEqual(len(body["cover_photos"]), 1)
        self.assertEqual(UserPlace.objects.get().photos.count(), 2)

    def test_names_are_unique_per_owner_in_any_case(self):
        self.create()
        response = self.create(name="  home ")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["errors"][0]["field"], "name")
        self.assertEqual(response.json()["errors"][0]["code"], "unique")
        # Another user may use the name
        other = APIClient()
        other.force_authenticate(create_test_user())
        response = other.post(
            URL,
            {"name": "Home", "center_lat": 1, "center_lon": 2, "radius_m": 50},
            format="json",
        )
        self.assertEqual(response.status_code, 201)

    def test_the_circle_and_the_name_are_checked(self):
        for fields, field in [
            ({"radius_m": 10}, "radius_m"),
            ({"radius_m": 5000}, "radius_m"),
            ({"center_lat": 91}, "center_lat"),
            ({"center_lon": "11"}, "center_lon"),
            ({"name": "   "}, "name"),
            ({"icon": "castle"}, "icon"),
        ]:
            with self.subTest(fields=fields):
                response = self.create(**fields)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json()["errors"][0]["field"], field)

    def test_a_user_has_at_most_so_many_places(self):
        for index in range(MAX_PLACES_PER_USER):
            create_test_user_place(self.user, f"Place {index}")
        response = self.create()
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["errors"][0]["code"], "too_many_places")

    def test_list_is_by_name_with_counts(self):
        create_test_user_place(self.user, "work", center=PARK)
        create_test_user_place(self.user, "Home", center=HOME)
        located(self.user, NEXT_DOOR)
        refresh_user_places(self.user)

        body = self.client.get(URL).json()

        self.assertEqual([row["name"] for row in body["results"]], ["Home", "work"])
        self.assertEqual([row["photo_count"] for row in body["results"]], [1, 0])

    def test_moving_a_place_refiles_the_photos(self):
        place_id = self.create().json()["id"]
        park = located(self.user, PARK)

        response = self.client.patch(
            f"{URL}{place_id}/",
            {"center_lat": PARK[0], "center_lon": PARK[1], "name": "Park"},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["photo_count"], 1)
        self.assertEqual(place_ids(park), [place_id])

    def test_deleting_a_place_moves_its_photos_to_a_larger_one(self):
        garden = located(self.user, NEXT_DOOR)
        town = create_test_user_place(self.user, "Town", center=HOME, radius_m=2000)
        place_id = self.create().json()["id"]
        self.assertEqual(place_ids(garden), [place_id])

        response = self.client.delete(f"{URL}{place_id}/")

        self.assertEqual(response.status_code, 204)
        self.assertEqual(place_ids(garden), [town.pk])

    def test_preview_counts_the_photos_inside_and_names_overlaps(self):
        located(self.user, NEXT_DOOR, exif_timestamp=timezone.now())
        located(self.user, PARK)
        town = create_test_user_place(self.user, "Town", center=HOME, radius_m=2000)

        response = self.client.get(
            f"{URL}preview/", {"lat": HOME[0], "lon": HOME[1], "radius_m": 100}
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["photo_count"], 1)
        self.assertEqual(len(body["cover_photos"]), 1)
        self.assertEqual(
            body["overlaps"],
            [{"id": town.pk, "name": "Town", "photo_count": 1, "smaller": False}],
        )
        # The place being edited is not its own overlap
        response = self.client.get(
            f"{URL}preview/",
            {"lat": HOME[0], "lon": HOME[1], "radius_m": 100, "exclude": town.pk},
        )
        self.assertEqual(response.json()["overlaps"], [])

    def test_preview_needs_a_centre(self):
        response = self.client.get(f"{URL}preview/", {"lat": 1})
        self.assertEqual(response.status_code, 400)

    def test_a_places_photos_by_day(self):
        place_id = self.create().json()["id"]
        photo = located(self.user, NEXT_DOOR, exif_timestamp=timezone.now())
        refresh_user_places(self.user)

        response = self.client.get(f"{URL}{place_id}/photos/")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["name"], "Home")
        items = [item for group in body["grouped_photos"] for item in group["items"]]
        self.assertEqual([item["id"] for item in items], [str(photo.pk)])

    def test_another_users_place_is_not_there(self):
        theirs = create_test_user_place(create_test_user(), "Their home")
        for method, url in [
            ("get", f"{URL}{theirs.pk}/"),
            ("get", f"{URL}{theirs.pk}/photos/"),
            ("patch", f"{URL}{theirs.pk}/"),
            ("delete", f"{URL}{theirs.pk}/"),
        ]:
            with self.subTest(method=method, url=url):
                response = getattr(self.client, method)(url, {}, format="json")
                self.assertEqual(response.status_code, 404)
        self.assertEqual(self.client.get(URL).json()["results"], [])
        self.assertTrue(UserPlace.objects.filter(pk=theirs.pk).exists())

    def test_anonymous_is_refused(self):
        self.assertEqual(APIClient().get(URL).status_code, 401)


class PositionChangesTest(TestCase):
    """A photo goes into the place where it now is, whoever moved it."""

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.home = create_test_user_place(self.user, "Home", center=HOME, radius_m=100)

    @patch("api.metadata.edits.reverse_geocode", return_value=None)
    def test_a_location_the_user_sets_or_removes(self, _geocoder):
        photo = located(self.user, PARK)

        response = self.client.post(
            "/api/photosedit/location/",
            {
                "image_hashes": [photo.image_hash],
                "lat": NEXT_DOOR[0],
                "lon": NEXT_DOOR[1],
                "overwrite": True,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(place_ids(photo), [self.home.pk])

        from api.metadata import edits

        photo.refresh_from_db()
        edits.set_location(photo, None, None, self.user)
        self.assertEqual(place_ids(photo), [])

    def test_a_scan_that_reads_a_new_position(self):
        from api.directory_watcher import file_handlers

        photo = located(self.user, PARK)

        def read_new_position(photo, commit):
            photo.exif_gps_lat, photo.exif_gps_lon = NEXT_DOOR
            photo.location_source = LocationSource.FILE
            photo.save()

        with (
            patch.object(
                file_handlers.photo_reader, "extract_exif_data", read_new_position
            ),
            patch.object(file_handlers, "extract_date_time"),
        ):
            file_handlers._read_metadata(photo, "x.jpg", "job", datetime.datetime.now())

        self.assertEqual(place_ids(photo), [self.home.pk])


class SearchTest(TestCase):
    def test_a_place_name_finds_its_photos_for_the_owner_only(self):
        user = create_test_user()
        place = create_test_user_place(user, "Grandma's", center=HOME, radius_m=100)
        photo = located(user, NEXT_DOOR, exif_timestamp=timezone.now())
        located(user, PARK, exif_timestamp=timezone.now())
        refresh_user_places(user)
        client = APIClient()
        client.force_authenticate(user)

        body = client.get("/api/photos/searchlist/", {"search": "grandma"}).json()

        items = [item["id"] for group in body["results"] for item in group["items"]]
        self.assertEqual(items, [str(photo.pk)])
        self.assertTrue(place.photos.filter(pk=photo.pk).exists())


class EventTitleTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.home = create_test_user_place(self.user, "Home", center=HOME, radius_m=100)
        now = timezone.now()
        self.event = create_test_album_auto(self.user, timestamp=now)
        self.photos = [
            located(self.user, NEXT_DOOR, exif_timestamp=now),
            located(self.user, NEXT_DOOR, exif_timestamp=now),
            located(self.user, PARK, exif_timestamp=now),
        ]
        self.event.photos.add(*self.photos)
        refresh_user_places(self.user)

    def test_an_event_mostly_at_a_place_names_it_by_id(self):
        self.event._generate_title()

        self.assertEqual(self.event.title_parts["user_place"], self.home.pk)
        # The stored English title keeps the town: a shared event never names it
        self.assertNotIn("Home", self.event.title)

    def test_not_when_the_place_keeps_out_of_titles_or_holds_too_few(self):
        self.home.use_in_titles = False
        self.home.save()
        self.event._generate_title()
        self.assertIsNone(self.event.title_parts["user_place"])

        self.home.use_in_titles = True
        self.home.save()
        self.event.photos.add(located(self.user, PARK), located(self.user, PARK))
        self.event._generate_title()
        self.assertIsNone(self.event.title_parts["user_place"])

    def test_the_event_answers_the_id(self):
        self.event._generate_title()
        client = APIClient()
        client.force_authenticate(self.user)
        body = client.get(f"/api/albums/auto/{self.event.pk}/").json()
        self.assertEqual(body["title_parts"]["user_place"], self.home.pk)
