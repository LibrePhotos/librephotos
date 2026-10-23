"""A user's place never reaches another user or a public view (#1365).

A place called Home with its circle is where its owner lives. Its photos are
shared in every way there is (directly, in a shared album, in a public album,
publicly, in a shared event), and every read a recipient, a stranger or an
anonymous visitor can make is checked for the place's name and its centre.
"""

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from api.models.album_date import AlbumDate
from api.models.album_user_share import AlbumUserShare
from api.places.membership import refresh_user_places
from api.tests.utils import (
    create_test_album_auto,
    create_test_album_date,
    create_test_album_user,
    create_test_library_share,
    create_test_photo,
    create_test_user,
    create_test_user_place,
)

PLACE_NAME = "SecretHomeBase"
CENTRE = (52.123456, 13.654321)
# A few metres from the centre: inside the place
INSIDE = (52.1235, 13.6543)
MARKERS = (PLACE_NAME, "52.123456", "13.654321")


class UserPlacePrivacyTest(TestCase):
    def setUp(self):
        self.owner = create_test_user(public_sharing=True, share_people_names=True)
        self.recipient = create_test_user()
        self.stranger = create_test_user()
        now = timezone.now()
        self.place = create_test_user_place(
            self.owner, PLACE_NAME, center=CENTRE, radius_m=200, icon="home"
        )
        self.shared = create_test_photo(
            owner=self.owner,
            exif_gps_lat=INSIDE[0],
            exif_gps_lon=INSIDE[1],
            exif_timestamp=now,
            search_location="Somewhere, Berlin",
        )
        self.shared.shared_to.add(self.recipient)
        self.public = create_test_photo(
            owner=self.owner,
            exif_gps_lat=INSIDE[0],
            exif_gps_lon=INSIDE[1],
            exif_timestamp=now,
            public=True,
        )
        self.album = create_test_album_user(title="Trip", owner=self.owner)
        self.album.photos.add(self.shared, self.public)
        self.album.shared_to.add(self.recipient)
        AlbumUserShare.objects.create(  # raw-create: a public link with every detail shared
            album=self.album, enabled=True, slug="trip-link", share_location=True
        )
        self.event = create_test_album_auto(self.owner, timestamp=now)
        self.event.photos.add(self.shared, self.public)
        self.event.shared_to.add(self.recipient)
        refresh_user_places(self.owner)
        self.event._generate_title()
        self.assertEqual(self.place.photos.count(), 2)

    def reads(self):
        return [
            "/api/user-places/",
            f"/api/user-places/{self.place.pk}/",
            f"/api/user-places/{self.place.pk}/photos/",
            f"/api/user-places/preview/?lat={CENTRE[0]}&lon={CENTRE[1]}&radius_m=200",
            f"/api/photos/{self.shared.pk}/",
            f"/api/photos/{self.public.pk}/",
            f"/api/photos/{self.shared.pk}/albums/",
            "/api/photos/shared/tome/",
            "/api/photos/shared/tome/places/",
            f"/api/photos/shared/tome/places/photos/?title={PLACE_NAME}",
            f"/api/albums/user/{self.album.pk}/",
            f"/api/albums/user/{self.album.pk}/?public=true&username={self.owner.username}",
            "/api/albums/user/shared/tome/",
            f"/api/albums/auto/{self.event.pk}/",
            "/api/albums/auto/list/",
            "/api/albums/place/list/",
            f"/api/albums/date/list/?public=true&username={self.owner.username}",
            "/api/photos/public/",
            f"/api/photos/searchlist/?search={PLACE_NAME}",
            "/api/searchtermexamples/",
            "/api/public/albums/s/trip-link/",
            f"/api/public/albums/s/trip-link/photos/{self.public.pk}/",
            "/api/sync/photos/",
            "/api/sync/albums/auto/",
            "/api/sync/albums/place/",
            "/api/sync/sharing/",
            "/api/photos/map-points/",
            "/api/locclust/",
            "/api/memories/?fallback=true&window=30",
        ]

    def library_reads(self):
        """The reads of a library share's recipient (#2731)."""
        owner = self.owner.pk
        return [
            *self.reads(),
            "/api/library-shares/",
            f"/api/albums/date/list/?library={owner}",
            "/api/albums/date/list/?libraries=true",
            *(f"/api/albums/date/{day}/?library={owner}" for day in self.owner_days()),
            f"/api/photos/{self.shared.pk}/summary/",
            f"/api/photos/?search={PLACE_NAME}",
        ]

    def owner_days(self):
        return list(AlbumDate.objects.owned_by(self.owner).values_list("pk", flat=True))

    def assert_never_shown(self, user, urls=None):
        client = APIClient()
        if user is not None:
            client.force_authenticate(user=user)
        for url in urls or self.reads():
            with self.subTest(url=url, user=user):
                response = client.get(url)
                self.assertLess(response.status_code, 500, url)
                body = response.content.decode("utf-8", "replace")
                leaked = [m for m in MARKERS if m in body and m not in url]
                self.assertEqual(leaked, [], f"{response.status_code}: {body[:300]}")

    def test_a_recipient_of_every_kind_of_share_never_sees_the_place(self):
        self.assert_never_shown(self.recipient)

    def test_a_library_share_recipient_never_sees_the_place(self):
        """Even with every switch on and the library in their timeline (#2731):
        a share shows positions and place names, never the owner's places."""
        recipient = create_test_user()
        create_test_library_share(
            owner=self.owner,
            recipient=recipient,
            show_in_timeline=True,
            share_location=True,
            share_faces=True,
            share_camera_info=True,
            share_captions=True,
            share_originals=True,
        )
        day = create_test_album_date(owner=self.owner, date=timezone.now().date())
        day.photos.add(self.shared, self.public)
        self.assert_never_shown(recipient, self.library_reads())
        client = APIClient()
        client.force_authenticate(recipient)
        body = client.get("/api/photos/searchlist/", {"search": PLACE_NAME}).json()
        self.assertEqual(body["results"], [])

    def test_a_stranger_never_sees_the_place(self):
        self.assert_never_shown(self.stranger)

    def test_an_anonymous_visitor_never_sees_the_place(self):
        self.assert_never_shown(None)

    def test_the_recipients_search_for_the_name_finds_nothing(self):
        client = APIClient()
        client.force_authenticate(self.recipient)
        body = client.get("/api/photos/searchlist/", {"search": PLACE_NAME}).json()
        self.assertEqual(body["results"], [])

    def test_the_shared_event_title_keeps_the_town(self):
        self.assertNotIn(PLACE_NAME, self.event.title)

    def test_the_owner_sees_their_place(self):
        client = APIClient()
        client.force_authenticate(self.owner)
        for url in (
            "/api/user-places/",
            f"/api/user-places/{self.place.pk}/",
            f"/api/user-places/{self.place.pk}/photos/",
        ):
            with self.subTest(url=url):
                response = client.get(url)
                self.assertEqual(response.status_code, 200)
                self.assertIn(PLACE_NAME, response.content.decode())
        body = client.get("/api/photos/searchlist/", {"search": PLACE_NAME}).json()
        self.assertEqual(sum(len(group["items"]) for group in body["results"]), 2)
