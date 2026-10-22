"""The Places map shows photos where they were taken (#343)."""

from django.test import TestCase
from rest_framework.test import APIClient

from api.geocode.map_points import MapBounds, in_bounds_q, map_points
from api.models import Photo
from api.tests.utils import (
    create_test_album_place,
    create_test_photo,
    create_test_user,
)

MUNICH = (48.13743, 11.57549)
BERLIN = (52.52001, 13.40495)
FIJI = (-17.71337, 178.06503)
SAMOA = (-13.75903, -172.10462)
# The map around Munich: Berlin is outside.
AROUND_MUNICH = {"south": 47.0, "west": 10.0, "north": 49.0, "east": 13.0}


def located(owner, position, **kwargs):
    lat, lon = position
    return create_test_photo(owner=owner, exif_gps_lat=lat, exif_gps_lon=lon, **kwargs)


class MapPointsTest(TestCase):
    def setUp(self):
        self.user = create_test_user()

    def test_one_point_per_spot_counts_its_photos(self):
        located(self.user, MUNICH)
        # A metre away at most: the same spot
        located(self.user, (MUNICH[0] + 0.000001, MUNICH[1]))
        located(self.user, BERLIN)

        result = map_points(Photo.visible.owned_by(self.user))

        self.assertEqual(result["photo_count"], 3)
        self.assertEqual(sorted(result["points"]), [(*MUNICH, 2), (*BERLIN, 1)])

    def test_leaves_out_photos_without_a_usable_position(self):
        create_test_photo(owner=self.user)
        located(self.user, (0.0, 0.0))

        result = map_points(Photo.visible.owned_by(self.user))

        self.assertEqual(result, {"points": [], "photo_count": 0})


class InBoundsTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.fiji = located(self.user, FIJI)
        self.samoa = located(self.user, SAMOA)
        self.munich = located(self.user, MUNICH)

    def inside(self, bounds):
        return set(Photo.objects.filter(in_bounds_q(bounds)))

    def test_a_view_takes_the_photos_inside_it(self):
        self.assertEqual(self.inside(MapBounds(**AROUND_MUNICH)), {self.munich})

    def test_a_view_across_the_antimeridian(self):
        pacific = MapBounds(south=-20, west=170, north=-10, east=-170)

        self.assertEqual(self.inside(pacific), {self.fiji, self.samoa})


class PhotoMapPointsViewTest(TestCase):
    URL = "/api/photos/map-points/"

    def setUp(self):
        self.user = create_test_user()
        self.other = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_only_the_requesters_visible_photos(self):
        located(self.user, MUNICH)
        located(self.user, BERLIN, hidden=True)
        located(self.user, BERLIN, in_trashcan=True)
        # Shared with the requester and public: positions stay the owner's
        shared = located(self.other, BERLIN, public=True)
        shared.shared_to.add(self.user)

        response = self.client.get(self.URL)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"points": [[*MUNICH, 1]], "photo_count": 1})

    def test_anonymous_is_refused(self):
        self.assertEqual(APIClient().get(self.URL).status_code, 401)


class PhotosInBoundsViewTest(TestCase):
    URL = "/api/photos/in-bounds/"

    def setUp(self):
        self.user = create_test_user()
        self.other = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_lists_the_requesters_photos_inside_the_view(self):
        munich = located(self.user, MUNICH)
        located(self.user, BERLIN)
        located(self.user, MUNICH, hidden=True)
        located(self.other, MUNICH, public=True)

        response = self.client.get(self.URL, AROUND_MUNICH)

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["count"], 1)
        self.assertEqual([row["id"] for row in body["results"]], [str(munich.id)])

    def test_bad_bounds_are_a_400_naming_the_field(self):
        response = self.client.get(self.URL, {**AROUND_MUNICH, "north": 46.0})

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["errors"][0]["field"], "north")

    def test_missing_bounds_are_a_400(self):
        response = self.client.get(self.URL, {"south": 1})

        self.assertEqual(response.status_code, 400)


class PlaceAlbumsInBoundsViewTest(TestCase):
    URL = "/api/albums/place/in-bounds/"

    def setUp(self):
        self.user = create_test_user()
        self.other = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def albums(self):
        """Munich and Germany hold the Munich photo, Berlin and Germany the
        Berlin one, and "Hidden" only a hidden photo; another user has a
        Munich too."""
        munich_photo = located(self.user, MUNICH)
        berlin_photo = located(self.user, BERLIN)
        hidden_photo = located(self.user, MUNICH, hidden=True)
        albums = {
            title: create_test_album_place(self.user, title)
            for title in ("Munich", "Germany", "Berlin", "Hidden")
        }
        albums["Munich"].photos.add(munich_photo)
        albums["Germany"].photos.add(munich_photo, berlin_photo)
        albums["Berlin"].photos.add(berlin_photo)
        albums["Hidden"].photos.add(hidden_photo)
        theirs = create_test_album_place(self.other, "Munich")
        theirs.photos.add(located(self.other, MUNICH))
        return albums

    def ids(self, view):
        response = self.client.get(self.URL, view)
        self.assertEqual(response.status_code, 200)
        return response.json()["ids"]

    def test_places_with_a_photo_in_a_narrow_view(self):
        albums = self.albums()

        self.assertEqual(
            self.ids(AROUND_MUNICH),
            sorted([albums["Munich"].id, albums["Germany"].id]),
        )

    def test_places_with_a_photo_in_a_wide_view(self):
        # Most photos inside: the plan that checks each album
        albums = self.albums()
        world = {"south": -90, "west": -180, "north": 90, "east": 180}

        self.assertEqual(
            self.ids(world),
            sorted(albums[title].id for title in ("Munich", "Germany", "Berlin")),
        )
