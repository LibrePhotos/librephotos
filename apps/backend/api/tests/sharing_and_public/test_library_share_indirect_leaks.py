"""What a library share must not let a recipient learn indirectly (#2731).

From an independent review: a search over fields the share hides, a day
holding only hidden or trashed photos, and a day's place taken from a hidden
photo. Each test asserts the privacy model; a failure is a leak.
"""

import datetime

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from api.tests.utils import (
    create_test_album_date,
    create_test_face,
    create_test_file,
    create_test_library_share,
    create_test_person,
    create_test_photo,
    create_test_tag,
    create_test_user,
)

DAY = datetime.date(2025, 10, 18)
NOON = timezone.make_aware(datetime.datetime(2025, 10, 18, 12, 0))
HIDDEN_DAY = datetime.date(2024, 2, 14)
HIDDEN_NOON = timezone.make_aware(datetime.datetime(2024, 2, 14, 12, 0))


def client_for(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


class PhotoListSearchOracleTest(TestCase):
    """GET /api/photos/?search= searches file paths, tags, people's names,
    captions and places: whether a term returns a photo would tell a recipient
    what the share hides. The list holds the requester's own photos only."""

    def setUp(self):
        self.owner = create_test_user()
        self.recipient = create_test_user()
        main = create_test_file("/photos/anna/clinic-oncology/IMG_0001.jpg", self.owner)
        self.photo = create_test_photo(
            owner=self.owner,
            main_file=main,
            exif_timestamp=NOON,
            search_location="Starnberg Bavaria",
            search_captions="SecretCam9 privatekeyword Clara Ruiz",
        )
        person = create_test_person(name="Clara Ruiz", cluster_owner=self.owner)
        create_test_face(photo=self.photo, person=person)
        tag = create_test_tag(self.owner, name="affair")
        self.photo.tags.add(tag)
        create_test_library_share(owner=self.owner, recipient=self.recipient)

    def test_the_photo_list_is_the_requesters_own(self):
        response = client_for(self.owner).get("/api/photos/", {"search": "Clara"})
        self.assertEqual(response.status_code, 200, response.content[:300])
        self.assertIn(str(self.photo.pk), response.content.decode())
        response = client_for(self.recipient).get("/api/photos/")
        self.assertEqual(response.status_code, 200)
        self.assertNotIn(str(self.photo.pk), response.content.decode())

    def test_list_search_finds_nothing_hidden(self):
        client = client_for(self.recipient)
        for term in (
            "clinic-oncology",  # folder (never shared)
            "IMG_0001",  # file name (never shared)
            "affair",  # tag (never shared)
            "Clara",  # person name (People off)
            "Starnberg",  # place (Location off)
            "SecretCam9",  # camera (Camera off)
            "privatekeyword",  # keyword (never shared)
        ):
            with self.subTest(term=term):
                body = client.get("/api/photos/", {"search": term}).content.decode()
                self.assertNotIn(
                    str(self.photo.pk), body, f"search={term} matched the photo"
                )


class HiddenOnlyDayTest(TestCase):
    """A day album holding only hidden/trashed photos is not the owner's
    library as it is shared, yet library_day / timeline_day resolve any of the
    owner's AlbumDate pks and return its date (and place)."""

    def setUp(self):
        self.owner = create_test_user()
        self.recipient = create_test_user()
        hidden = create_test_photo(
            owner=self.owner, exif_timestamp=HIDDEN_NOON, hidden=True
        )
        trashed = create_test_photo(
            owner=self.owner, exif_timestamp=HIDDEN_NOON, in_trashcan=True
        )
        self.day = create_test_album_date(
            owner=self.owner, date=HIDDEN_DAY, location={"places": ["SecretTown"]}
        )
        self.day.photos.add(hidden, trashed)
        create_test_library_share(
            owner=self.owner,
            recipient=self.recipient,
            show_in_timeline=True,
            share_location=True,
        )

    def test_library_day_of_hidden_photos_is_404(self):
        client = client_for(self.recipient)
        for query in (f"?library={self.owner.pk}", "?libraries=true"):
            with self.subTest(query=query):
                response = client.get(f"/api/albums/date/{self.day.pk}/{query}")
                body = response.content.decode()
                self.assertEqual(response.status_code, 404, body[:300])
                self.assertNotIn("2024-02-14", body)
                self.assertNotIn("SecretTown", body)


class DayPlaceOfHiddenPhotoTest(TestCase):
    """AlbumDate.location collects the town of every photo of the day
    (add_location_to_album_dates), hidden ones included, and is never pruned.
    With Location on, the shared day names it."""

    def setUp(self):
        self.owner = create_test_user()
        self.recipient = create_test_user()
        visible = create_test_photo(owner=self.owner, exif_timestamp=NOON)
        hidden = create_test_photo(
            owner=self.owner,
            exif_timestamp=NOON,
            hidden=True,
            geolocation_json={"features": [{"text": "HiddenTown"}]},
        )
        # As add_location_to_album_dates leaves it after geocoding the hidden
        # photo (the visible one has no place).
        self.day = create_test_album_date(
            owner=self.owner, date=DAY, location={"places": ["HiddenTown"]}
        )
        self.day.photos.add(visible, hidden)
        create_test_library_share(
            owner=self.owner,
            recipient=self.recipient,
            show_in_timeline=True,
            share_location=True,
        )

    def test_shared_day_does_not_name_a_hidden_photos_town(self):
        client = client_for(self.recipient)
        for url in (
            f"/api/albums/date/list/?library={self.owner.pk}",
            f"/api/albums/date/{self.day.pk}/?library={self.owner.pk}",
            "/api/albums/date/list/?libraries=true",
        ):
            with self.subTest(url=url):
                response = client.get(url)
                self.assertEqual(response.status_code, 200)
                self.assertNotIn("HiddenTown", response.content.decode())
