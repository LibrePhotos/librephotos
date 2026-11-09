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
    create_test_face,
    create_test_file,
    create_test_library_share,
    create_test_person,
    create_test_photo,
    create_test_tag,
    create_test_user,
    day_photo_ids,
    list_days,
)
from api.timeline.days import day_id

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
    """A day holding only hidden or trashed photos is not the owner's
    library as it is shared: it is not listed, and its pages and layout are
    empty, so neither its date nor its place reaches the recipient."""

    def setUp(self):
        self.owner = create_test_user()
        self.recipient = create_test_user()
        place = {"places": ["Street", "SecretTown", "Land"]}
        self.hidden = create_test_photo(
            owner=self.owner,
            exif_timestamp=HIDDEN_NOON,
            hidden=True,
            geolocation_json=place,
        )
        self.trashed = create_test_photo(
            owner=self.owner,
            exif_timestamp=HIDDEN_NOON,
            in_trashcan=True,
            geolocation_json=place,
        )
        self.day = day_id(HIDDEN_DAY)
        create_test_library_share(
            owner=self.owner,
            recipient=self.recipient,
            show_in_timeline=True,
            share_location=True,
        )

    def test_library_day_of_hidden_photos_is_not_listed(self):
        client = client_for(self.recipient)
        for params in ({"library": self.owner.pk}, {"libraries": "true"}):
            with self.subTest(params=params):
                for path in ("/api/days/", f"/api/days/{self.day}/layout/"):
                    body = client.get(path, params).content.decode()
                    self.assertNotIn("2024-02-14", body)
                    self.assertNotIn("SecretTown", body)
                self.assertEqual(list_days(client, params), [])
                self.assertEqual(day_photo_ids(client, self.day, params), [])
                layout = client.get(f"/api/days/{self.day}/layout/", params).json()
                self.assertEqual(layout["numberOfItems"], 0)

    def test_a_hidden_photo_is_no_cursor(self):
        client = client_for(self.recipient)
        for photo in (self.hidden, self.trashed):
            for params in ({"library": self.owner.pk}, {"libraries": "true"}):
                with self.subTest(photo=photo.pk, params=params):
                    response = client.get(
                        f"/api/days/{self.day}/photos/", {**params, "after": photo.pk}
                    )
                    self.assertEqual(response.status_code, 400)


class DayPlaceOfHiddenPhotoTest(TestCase):
    """A day's place is the town of its first located photo the view shows:
    with Location on, a hidden photo taken earlier that day must not name
    the shared day."""

    def setUp(self):
        self.owner = create_test_user()
        self.recipient = create_test_user()
        self.visible = create_test_photo(owner=self.owner, exif_timestamp=NOON)
        create_test_photo(
            owner=self.owner,
            exif_timestamp=NOON - datetime.timedelta(hours=1),
            hidden=True,
            geolocation_json={"places": ["Street", "HiddenTown", "Land"]},
        )
        create_test_library_share(
            owner=self.owner,
            recipient=self.recipient,
            show_in_timeline=True,
            share_location=True,
        )

    def test_shared_day_does_not_name_a_hidden_photos_town(self):
        client = client_for(self.recipient)
        for url in (
            f"/api/days/?library={self.owner.pk}",
            f"/api/days/{day_id(DAY)}/photos/?library={self.owner.pk}",
            "/api/days/?libraries=true",
        ):
            with self.subTest(url=url):
                response = client.get(url)
                self.assertEqual(response.status_code, 200)
                self.assertNotIn("HiddenTown", response.content.decode())

    def test_the_visible_photos_town_still_names_it(self):
        self.visible.geolocation_json = {"places": ["Street", "OpenTown", "Land"]}
        self.visible.save()
        client = client_for(self.recipient)
        for params in ({"library": self.owner.pk}, {"libraries": "true"}):
            with self.subTest(params=params):
                (day,) = list_days(client, params)
                self.assertEqual(day["location"], "OpenTown")
