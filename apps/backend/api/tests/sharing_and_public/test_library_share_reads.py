"""What the recipient of a library share reads, and what stays the owner's (#2731).

The privacy contract: photos, videos and dates always; location, the names
of named people, camera information and captions only with the owner's
switch for that recipient; hidden photos, trash, albums, tags, favourites,
ratings, edit history, file names and folders never.
"""

import datetime

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from api.models import Photo
from api.serializers.photos import PhotoSerializer, PhotoSummarySerializer
from api.sharing.grants import DETAIL_FIELDS, SUMMARY_FIELDS
from api.tests.utils import (
    create_test_album_date,
    create_test_album_place,
    create_test_face,
    create_test_library_share,
    create_test_person,
    create_test_photo,
    create_test_user,
    share_test_photos,
)

DAY = datetime.date(2025, 10, 18)
NOON = timezone.make_aware(datetime.datetime(2025, 10, 18, 12, 0))


def client_for(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


class FieldTablesTest(TestCase):
    def test_every_photo_field_is_classified(self):
        """A new serializer field is a decision: add it to a table in
        api/sharing/grants.py, or recipients get it hidden (None)."""
        self.assertEqual(set(PhotoSerializer.Meta.fields), set(DETAIL_FIELDS))
        self.assertEqual(set(PhotoSummarySerializer.Meta.fields), set(SUMMARY_FIELDS))


class LibraryShareFixture(TestCase):
    def setUp(self):
        self.owner = create_test_user()
        self.recipient = create_test_user()
        self.stranger = create_test_user()
        self.photo = create_test_photo(
            owner=self.owner,
            exif_timestamp=NOON,
            exif_gps_lat=47.99,
            exif_gps_lon=11.34,
            search_location="Starnberg Bavaria",
            camera="SecretCam 9",
            captions_json={"user_caption": "birthday cake", "im2txt": "a cake"},
            rating=5,
        )
        self.hidden = create_test_photo(
            owner=self.owner, exif_timestamp=NOON, hidden=True
        )
        self.trashed = create_test_photo(
            owner=self.owner, exif_timestamp=NOON, in_trashcan=True
        )
        self.archived = create_test_photo(
            owner=self.owner, exif_timestamp=NOON, archived=True
        )
        self.person = create_test_person(name="Clara Ruiz", cluster_owner=self.owner)
        create_test_face(photo=self.photo, person=self.person)
        self.day = create_test_album_date(
            owner=self.owner, date=DAY, location={"places": ["Starnberg"]}
        )
        self.day.photos.add(self.photo, self.hidden, self.trashed, self.archived)
        self.share = create_test_library_share(
            owner=self.owner, recipient=self.recipient
        )

    def switch(self, **switches):
        for name, value in switches.items():
            setattr(self.share, name, value)
        self.share.save()


class ScopeTest(LibraryShareFixture):
    def test_visible_to_holds_the_shared_library_without_hidden_photos(self):
        visible = set(Photo.objects.visible_to(self.recipient))
        self.assertIn(self.photo, visible)
        self.assertIn(self.archived, visible)
        self.assertNotIn(self.hidden, visible)
        self.assertNotIn(self.trashed, visible)
        self.assertEqual(set(Photo.objects.visible_to(self.stranger)), set())

    def test_the_share_is_one_way(self):
        own = create_test_photo(owner=self.recipient)
        self.assertNotIn(own, set(Photo.objects.visible_to(self.owner)))

    def test_owned_by_stays_the_owners(self):
        self.assertEqual(Photo.objects.owned_by(self.recipient).count(), 0)

    def test_revoking_ends_access_at_once(self):
        client = client_for(self.recipient)
        self.assertEqual(client.get(f"/api/photos/{self.photo.pk}/").status_code, 200)
        self.share.delete()
        self.assertEqual(client.get(f"/api/photos/{self.photo.pk}/").status_code, 404)

    def test_a_hidden_photo_stays_hidden(self):
        client = client_for(self.recipient)
        for photo in (self.hidden, self.trashed):
            with self.subTest(photo=photo.pk):
                response = client.get(f"/api/photos/{photo.pk}/")
                self.assertEqual(response.status_code, 404)


class PhotoDetailTest(LibraryShareFixture):
    def detail(self):
        response = client_for(self.recipient).get(f"/api/photos/{self.photo.pk}/")
        self.assertEqual(response.status_code, 200, response.content[:300])
        return response.json()

    def test_with_every_switch_off_only_the_photo_and_its_date_show(self):
        body = self.detail()
        self.assertIsNotNone(body["exif_timestamp"])
        self.assertIsNone(body["exif_gps_lat"])
        self.assertIsNone(body["exif_gps_lon"])
        self.assertEqual(body["search_location"], "")
        self.assertIsNone(body["geolocation_json"])
        self.assertIsNone(body["camera"])
        self.assertEqual(body["captions_json"], {"im2txt": ""})
        self.assertEqual(body["search_captions"], "")
        self.assertEqual(body["people"], [])
        self.assertEqual(body["image_path"], [])
        self.assertEqual(body["rating"], 0)
        self.assertEqual(body["shared_to"], [])
        self.assertIsNone(body["metadata"])
        self.assertIsNone(body["file_variants"])
        self.assertEqual(body["original_mime_type"], "image/jpeg")
        self.assertEqual(
            body["shared_library"],
            {
                "location": False,
                "people": False,
                "camera": False,
                "captions": False,
                "originals": False,
            },
        )
        text = str(body)
        for secret in ("Starnberg", "SecretCam", "birthday", "Clara", ".png"):
            self.assertNotIn(secret, text)

    def test_each_switch_shows_its_fields(self):
        self.switch(
            share_location=True,
            share_faces=True,
            share_camera_info=True,
            share_captions=True,
        )
        body = self.detail()
        self.assertEqual(body["exif_gps_lat"], 47.99)
        self.assertEqual(body["search_location"], "Starnberg Bavaria")
        self.assertEqual(body["camera"], "SecretCam 9")
        self.assertEqual(body["captions_json"]["user_caption"], "birthday cake")
        self.assertEqual([p["name"] for p in body["people"]], ["Clara Ruiz"])
        # Never shared, whatever the switches say.
        self.assertEqual(body["rating"], 0)
        self.assertEqual(body["image_path"], [])
        self.assertEqual(body["search_captions"], "")

    def test_unnamed_faces_never_show(self):
        self.switch(share_faces=True)
        create_test_face(photo=self.photo)
        cluster = create_test_person(
            name="Unknown 012", kind="CLUSTER", cluster_owner=self.owner
        )
        create_test_face(photo=self.photo, cluster_person=cluster)
        names = [p["name"] for p in self.detail()["people"]]
        self.assertEqual(names, ["Clara Ruiz"])

    def test_the_owner_still_sees_everything(self):
        body = client_for(self.owner).get(f"/api/photos/{self.photo.pk}/").json()
        self.assertEqual(body["exif_gps_lat"], 47.99)
        self.assertEqual(body["rating"], 5)
        self.assertIsNone(body["shared_library"])

    def test_a_photo_also_shared_one_by_one_follows_the_library_share(self):
        share_test_photos([self.photo.pk], self.recipient)
        self.assertIsNone(self.detail()["exif_gps_lat"])

    def test_the_summary_action_hides_the_location_too(self):
        response = client_for(self.recipient).get(
            f"/api/photos/{self.photo.pk}/summary/"
        )
        self.assertEqual(response.status_code, 200)
        summary = response.json()["photo_summary"]
        self.assertEqual(summary["location"], "")
        self.assertIsNone(summary["exif_gps_lat"])
        self.assertEqual(summary["rating"], 0)

    def test_the_recipient_cannot_change_the_photo(self):
        client = client_for(self.recipient)
        response = client.patch(
            f"/api/photos/{self.photo.pk}/", {"rating": 1}, format="json"
        )
        self.assertIn(response.status_code, (403, 404))
        response = client.post(
            "/api/photosedit/favorite",
            {"image_hashes": [self.photo.image_hash], "favorite": False},
            format="json",
        )
        self.photo.refresh_from_db()
        self.assertEqual(self.photo.rating, 5)


class LibraryPageTest(LibraryShareFixture):
    def days(self, user, **params):
        query = {"library": self.owner.pk, **params}
        return client_for(user).get("/api/albums/date/list/", query)

    def test_the_recipient_reads_the_owners_days_without_places(self):
        response = self.days(self.recipient)
        self.assertEqual(response.status_code, 200)
        [day] = response.json()["results"]
        self.assertEqual(day["id"], self.day.pk)
        self.assertEqual(day["location"], "")
        # The photo and the archived one; never the hidden or trashed one.
        self.assertEqual(day["numberOfItems"], 2)

        response = client_for(self.recipient).get(
            f"/api/albums/date/{self.day.pk}/", {"library": self.owner.pk}
        )
        self.assertEqual(response.status_code, 200)
        results = response.json()["results"]
        self.assertEqual(results["location"], "")
        hashes = {item["image_hash"] for item in results["items"]}
        self.assertEqual(hashes, {self.photo.image_hash, self.archived.image_hash})
        item = next(
            i for i in results["items"] if i["image_hash"] == self.photo.image_hash
        )
        self.assertEqual(item["location"], "")
        self.assertIsNone(item["exif_gps_lat"])
        self.assertEqual(item["rating"], 0)

    def test_with_location_on_the_day_names_its_place(self):
        self.switch(share_location=True)
        [day] = self.days(self.recipient).json()["results"]
        self.assertEqual(day["location"], "Starnberg")

    def test_without_a_share_the_library_is_a_404(self):
        self.assertEqual(self.days(self.stranger).status_code, 404)
        response = client_for(self.stranger).get(
            f"/api/albums/date/{self.day.pk}/", {"library": self.owner.pk}
        )
        self.assertEqual(response.status_code, 404)

    def test_owner_only_views_return_no_library_photos(self):
        for params in (
            {"hidden": "true"},
            {"in_trashcan": "true"},
            {"favorite": "true"},
            {"person": self.person.pk},
            {"folder": "/"},
        ):
            with self.subTest(params=params):
                response = self.days(self.recipient, **params)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()["results"], [])


class TimelineTest(LibraryShareFixture):
    def setUp(self):
        super().setUp()
        self.own = create_test_photo(owner=self.recipient, exif_timestamp=NOON)
        self.own_day = create_test_album_date(owner=self.recipient, date=DAY)
        self.own_day.photos.add(self.own)
        other_date = datetime.date(2025, 10, 12)
        self.only_theirs = create_test_photo(
            owner=self.owner,
            exif_timestamp=timezone.make_aware(datetime.datetime(2025, 10, 12, 9)),
        )
        self.their_day = create_test_album_date(
            owner=self.owner, date=other_date, location={"places": ["Munich"]}
        )
        self.their_day.photos.add(self.only_theirs)

    def timeline(self, **params):
        query = {"libraries": "true", "archived": "false", **params}
        response = client_for(self.recipient).get("/api/albums/date/list/", query)
        self.assertEqual(response.status_code, 200)
        return response.json()["results"]

    def day_items(self, day_id, **params):
        query = {"libraries": "true", "archived": "false", **params}
        response = client_for(self.recipient).get(f"/api/albums/date/{day_id}/", query)
        self.assertEqual(response.status_code, 200, response.content[:300])
        return response.json()["results"]

    def test_partner_photos_only_with_the_switch_on(self):
        days = self.timeline()
        self.assertEqual([d["id"] for d in days], [self.own_day.pk])
        self.assertEqual(days[0]["numberOfItems"], 1)

        self.switch(show_in_timeline=True)
        days = self.timeline()
        self.assertEqual([d["id"] for d in days], [self.own_day.pk, self.their_day.pk])
        # One day for the date both have: the recipient's, with both photos;
        # the owner's archived photo is not in a timeline.
        self.assertEqual(days[0]["numberOfItems"], 2)
        self.assertEqual(days[1]["location"], "")

        hashes = {i["image_hash"] for i in self.day_items(self.own_day.pk)["items"]}
        self.assertEqual(hashes, {self.own.image_hash, self.photo.image_hash})
        their = self.day_items(self.their_day.pk)
        self.assertEqual(their["location"], "")
        self.assertEqual(
            [i["image_hash"] for i in their["items"]], [self.only_theirs.image_hash]
        )

    def test_without_the_param_the_timeline_is_the_users_own(self):
        self.switch(show_in_timeline=True)
        response = client_for(self.recipient).get(
            "/api/albums/date/list/", {"archived": "false"}
        )
        self.assertEqual(
            [d["id"] for d in response.json()["results"]], [self.own_day.pk]
        )

    def test_a_favourites_filter_never_takes_partner_photos(self):
        self.switch(show_in_timeline=True)
        self.own.rating = 5
        self.own.save()
        days = self.timeline(favorite="true")
        self.assertEqual(
            [(d["id"], d["numberOfItems"]) for d in days], [(self.own_day.pk, 1)]
        )
        items = self.day_items(self.own_day.pk, favorite="true")["items"]
        self.assertEqual([i["image_hash"] for i in items], [self.own.image_hash])

    def test_a_partner_day_is_not_reachable_after_leaving(self):
        self.switch(show_in_timeline=True)
        self.share.delete()
        response = client_for(self.recipient).get(
            f"/api/albums/date/{self.their_day.pk}/", {"libraries": "true"}
        )
        self.assertEqual(response.status_code, 404)
        items = self.day_items(self.own_day.pk)["items"]
        self.assertEqual([i["image_hash"] for i in items], [self.own.image_hash])


class SharedWithYouTabsTest(LibraryShareFixture):
    """A photo also shared one by one follows the library share's switches in
    the Shared with you places and people (#2721, #2722)."""

    def setUp(self):
        super().setUp()
        self.owner.share_people_names = True
        self.owner.save()
        share_test_photos([self.photo.pk], self.recipient)
        create_test_album_place(title="Starnberg", owner=self.owner).photos.add(
            self.photo
        )

    def test_places_and_people_follow_the_library_switches(self):
        client = client_for(self.recipient)
        places = client.get("/api/photos/shared/tome/places/").content.decode()
        people = client.get("/api/photos/shared/tome/people/").content.decode()
        self.assertNotIn("Starnberg", places)
        self.assertNotIn("Clara", people)
        self.switch(share_location=True, share_faces=True)
        places = client.get("/api/photos/shared/tome/places/").content.decode()
        people = client.get("/api/photos/shared/tome/people/").content.decode()
        self.assertIn("Starnberg", places)
        self.assertIn("Clara", people)
