"""Public pages only show what the owner's public sharing switches allow.

A photo the owner made public ("Make Public"), put in an album with a public
link, or shared by a photo link is read by people who are neither its owner
nor someone it is shared with: anonymous visitors, and signed-in users of the
same server. Every read they can make of it goes through one rule
(``api.sharing.grants.public_grant``): location, time, camera, captions and
the names of people only with the owner's switch on (all off by default), the
search text, file paths, ratings, stacks and edit history never.
"""

import datetime

from django.test import TestCase
from rest_framework.test import APIClient

from api.models.album_user_share import AlbumUserShare
from api.models.photo_share import PhotoShare
from api.models.user import get_default_public_sharing_settings
from api.search.semantic import OPENCLIP
from api.tests.utils import (
    create_test_album_date,
    create_test_album_user,
    create_test_face,
    create_test_person,
    create_test_photo,
    create_test_user,
)

LAT, LON = 47.99, 11.34
STREET = "Marienplatz 1, 80331 Munich, Germany"
SEARCH_TEXT = "alice /data/photos/family/secret.jpg beach"
GENERATED = "Alice smiling at Marienplatz"
CAPTIONS = {
    "im2txt": GENERATED,
    "user_caption": "Summer holiday",
    OPENCLIP: {"tags": ["beach"]},
}
TAKEN = datetime.datetime(2024, 7, 14, 12, 30, tzinfo=datetime.UTC)
ALL_SWITCHES = dict.fromkeys(get_default_public_sharing_settings(), True)


class PublicPhotoFixture(TestCase):
    def setUp(self):
        self.owner = create_test_user(public_sharing=True)
        self.stranger = create_test_user()
        self.photo = create_test_photo(
            owner=self.owner,
            public=True,
            exif_gps_lat=LAT,
            exif_gps_lon=LON,
            exif_timestamp=TAKEN,
            exif_timestamp_offset=120,
            geolocation_json={"places": ["Altstadt", "Munich", "Germany"]},
            search_location=STREET,
            search_captions=SEARCH_TEXT,
            captions_json=CAPTIONS,
            rating=5,
            camera="SecretCam",
        )
        person = create_test_person(name="Alice", cluster_owner=self.owner)
        create_test_face(photo=self.photo, person=person)
        self.day = create_test_album_date(self.owner, date=TAKEN.date())
        self.day.location = {"places": ["Munich"]}
        self.day.save()
        self.day.photos.add(self.photo)
        self.anonymous = APIClient()
        self.signed_in = APIClient()
        self.signed_in.force_authenticate(self.stranger)

    def switch_on(self, **switches):
        settings = get_default_public_sharing_settings()
        settings.update(switches)
        self.owner.public_sharing_defaults = settings
        self.owner.save()

    def readers(self):
        return {"anonymous": self.anonymous, "signed in": self.signed_in}

    def day_url(self):
        return (
            f"/api/albums/date/{self.day.pk}/"
            f"?public=true&username={self.owner.username}"
        )


class DayAlbumTest(PublicPhotoFixture):
    def item(self, client):
        response = client.get(self.day_url())
        self.assertEqual(response.status_code, 200)
        return response.json()["results"]

    def test_without_switches_a_day_shows_no_place_time_or_rating(self):
        for name, client in self.readers().items():
            with self.subTest(name):
                day = self.item(client)
                item = day["items"][0]
                self.assertIsNone(item["exif_gps_lat"])
                self.assertIsNone(item["exif_gps_lon"])
                self.assertEqual(item["location"], "")
                self.assertEqual(item["date"], "")
                self.assertEqual(item["birthTime"], "")
                self.assertEqual(item["rating"], 0)
                self.assertIsNone(item["stacks"])
                self.assertFalse(item["has_raw_variant"])
                self.assertIsNone(day["date"])
                self.assertEqual(day["location"], "")

    def test_the_switches_show_place_and_time(self):
        self.switch_on(share_location=True, share_timestamps=True)
        day = self.item(self.anonymous)
        item = day["items"][0]
        self.assertEqual(item["exif_gps_lat"], LAT)
        self.assertEqual(item["location"], STREET)
        self.assertTrue(item["date"].startswith("2024-07-14"))
        self.assertEqual(day["date"], "2024-07-14")
        self.assertEqual(day["location"], "Munich")
        # Never a rating, whatever the switches say.
        self.assertEqual(item["rating"], 0)

    def test_the_owner_sees_the_public_view_as_visitors_do(self):
        owner = APIClient()
        owner.force_authenticate(self.owner)
        item = self.item(owner)["items"][0]
        self.assertIsNone(item["exif_gps_lat"])

    def test_the_day_list_names_no_date_or_place_without_switches(self):
        url = f"/api/albums/date/list/?public=true&username={self.owner.username}"
        days = self.anonymous.get(url).json()["results"]
        self.assertEqual(len(days), 1)
        self.assertIsNone(days[0]["date"])
        self.assertEqual(days[0]["location"], "")
        self.switch_on(share_location=True, share_timestamps=True)
        days = self.anonymous.get(url).json()["results"]
        self.assertEqual(days[0]["date"], "2024-07-14")
        self.assertEqual(days[0]["location"], "Munich")

    def test_the_public_view_cannot_be_filtered_by_what_it_hides(self):
        base = f"/api/albums/date/list/?public=true&username={self.owner.username}"
        everything = self.anonymous.get(base).json()["results"]
        person = self.photo.faces.get().person_id
        for extra in (
            "&search=nobody-is-called-this",
            f"&person={person + 1000}",
            "&folder=/nowhere/at/all",
            "&favorite=false",
        ):
            with self.subTest(extra):
                response = self.anonymous.get(base + extra)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()["results"], everything)

    def test_hidden_or_trashed_public_photos_stay_out(self):
        hidden = create_test_photo(owner=self.owner, public=True, hidden=True)
        self.day.photos.add(hidden)
        response = self.anonymous.get(self.day_url() + "&hidden=true")
        ids = [item["id"] for item in response.json()["results"]["items"]]
        self.assertNotIn(str(hidden.pk), ids)


class UndatedPublicPageTest(PublicPhotoFixture):
    """Without the dates switch the public view groups no photos by day."""

    def setUp(self):
        super().setUp()
        self.later = create_test_photo(
            owner=self.owner,
            public=True,
            exif_timestamp=TAKEN + datetime.timedelta(days=30),
        )
        self.later_day = create_test_album_date(
            self.owner, date=(TAKEN + datetime.timedelta(days=30)).date()
        )
        self.later_day.photos.add(self.later)
        self.list_url = (
            f"/api/albums/date/list/?public=true&username={self.owner.username}"
        )

    def test_the_days_are_one_undated_group(self):
        days = self.anonymous.get(self.list_url).json()["results"]
        self.assertEqual(len(days), 1)
        self.assertIsNone(days[0]["date"])
        self.assertEqual(days[0]["numberOfItems"], 2)
        group = min(self.day.pk, self.later_day.pk)
        self.assertEqual(days[0]["id"], group)
        url = f"/api/albums/date/{group}/?public=true&username={self.owner.username}"
        body = self.anonymous.get(url).json()["results"]
        ids = [item["id"] for item in body["items"]]
        self.assertEqual(ids, sorted([str(self.photo.pk), str(self.later.pk)]))
        self.assertEqual({item["date"] for item in body["items"]}, {""})
        self.assertIsNone(body["date"])

    def test_the_other_days_do_not_open(self):
        other = max(self.day.pk, self.later_day.pk)
        url = f"/api/albums/date/{other}/?public=true&username={self.owner.username}"
        self.assertEqual(self.anonymous.get(url).status_code, 404)

    def test_with_the_dates_switch_the_days_come_back(self):
        self.switch_on(share_timestamps=True)
        days = self.anonymous.get(self.list_url).json()["results"]
        self.assertEqual(
            [day["date"] for day in days],
            ["2024-08-13", "2024-07-14"],
        )
        other = max(self.day.pk, self.later_day.pk)
        url = f"/api/albums/date/{other}/?public=true&username={self.owner.username}"
        self.assertEqual(self.anonymous.get(url).status_code, 200)

    def test_a_public_album_lists_its_photos_in_no_time_order(self):
        album = create_test_album_user(owner=self.owner)
        album.photos.add(self.photo, self.later)
        share = AlbumUserShare.objects.create(album=album, enabled=True)  # raw-create
        body = self.anonymous.get(f"/api/public/albums/s/{share.slug}/").json()
        groups = body["results"]["grouped_photos"]
        self.assertEqual(len(groups), 1)
        ids = [item["id"] for item in groups[0]["items"]]
        self.assertEqual(ids, sorted([str(self.photo.pk), str(self.later.pk)]))

    def test_the_user_card_samples_show_no_date_or_rating(self):
        response = self.anonymous.get("/api/user/")
        card = next(
            user
            for user in response.json()["results"]
            if user["username"] == self.owner.username
        )
        samples = card["public_photo_samples"]
        self.assertEqual(len(samples), 2)
        self.assertEqual({sample["exif_timestamp"] for sample in samples}, {None})
        self.assertEqual({sample["rating"] for sample in samples}, {0})
        hashes = [sample["image_hash"] for sample in samples]
        self.assertEqual(hashes, sorted(hashes))


class PhotoDetailTest(PublicPhotoFixture):
    def test_the_detail_of_a_public_photo_follows_the_switches(self):
        for name, client in self.readers().items():
            with self.subTest(name):
                response = client.get(f"/api/photos/{self.photo.pk}/")
                self.assertEqual(response.status_code, 200)
                data = response.json()
                self.assertIsNone(data["exif_gps_lat"])
                self.assertIsNone(data["geolocation_json"])
                self.assertEqual(data["search_location"], "")
                self.assertIsNone(data["exif_timestamp"])
                self.assertIsNone(data["exif_timestamp_offset"])
                self.assertEqual(data["search_captions"], "")
                self.assertEqual(data["image_path"], [])
                self.assertIsNone(data["camera"])
                self.assertIsNone(data["metadata"])
                self.assertEqual(data["people"], [])
                self.assertEqual(data["rating"], 0)
                self.assertNotIn(GENERATED, str(data))
                self.assertNotIn("SecretCam", str(data))

    def test_every_switch_on_still_keeps_the_search_text_and_paths(self):
        self.switch_on(**ALL_SWITCHES)
        data = self.anonymous.get(f"/api/photos/{self.photo.pk}/").json()
        self.assertEqual(data["exif_gps_lat"], LAT)
        self.assertEqual(data["exif_timestamp_offset"], 120)
        self.assertEqual(data["camera"], "SecretCam")
        self.assertEqual(data["captions_json"]["im2txt"], GENERATED)
        self.assertEqual(data["search_captions"], "")
        self.assertEqual(data["image_path"], [])

    def test_the_time_zone_follows_the_location_switch(self):
        self.switch_on(share_timestamps=True)
        data = self.anonymous.get(f"/api/photos/{self.photo.pk}/").json()
        self.assertIsNotNone(data["exif_timestamp"])
        self.assertIsNone(data["exif_timestamp_offset"])

    def test_the_summary_of_a_public_photo_follows_the_switches(self):
        for name, client in self.readers().items():
            with self.subTest(name):
                response = client.get(f"/api/photos/{self.photo.pk}/summary/")
                self.assertEqual(response.status_code, 200)
                summary = response.json()["photo_summary"]
                self.assertIsNone(summary["exif_gps_lat"])
                self.assertEqual(summary["location"], "")
                self.assertEqual(summary["rating"], 0)

    def test_the_owner_still_sees_everything(self):
        owner = APIClient()
        owner.force_authenticate(self.owner)
        data = owner.get(f"/api/photos/{self.photo.pk}/").json()
        self.assertEqual(data["exif_gps_lat"], LAT)
        self.assertEqual(data["search_captions"], SEARCH_TEXT)


class LinkTest(PublicPhotoFixture):
    def setUp(self):
        super().setUp()
        self.link = PhotoShare.objects.create(photo=self.photo, enabled=True)
        self.album = create_test_album_user(owner=self.owner)
        self.album.photos.add(self.photo)
        self.album_share = AlbumUserShare.objects.create(  # raw-create: a public link
            album=self.album, enabled=True
        )

    def photo_link(self):
        return self.anonymous.get(f"/api/public/photo/{self.link.slug}/").json()

    def album_photo(self):
        return self.anonymous.get(
            f"/api/public/albums/s/{self.album_share.slug}/photos/{self.photo.pk}/"
        ).json()

    def album_grid(self):
        data = self.anonymous.get(f"/api/public/albums/s/{self.album_share.slug}/")
        return data.json()["results"]["grouped_photos"][0]["items"][0]

    def test_links_never_send_the_search_text(self):
        self.switch_on(**ALL_SWITCHES)
        self.assertEqual(self.photo_link()["results"]["search_captions"], "")
        self.assertEqual(self.album_photo()["results"]["search_captions"], "")

    def test_a_generated_caption_needs_the_people_and_location_switches(self):
        self.switch_on(share_captions=True)
        for name, read in (("photo", self.photo_link), ("album", self.album_photo)):
            with self.subTest(name):
                captions = read()["results"]["captions_json"]
                self.assertEqual(captions["im2txt"], "")
                self.assertEqual(captions["user_caption"], "Summer holiday")
                self.assertEqual(captions[OPENCLIP], {"tags": ["beach"]})
        self.switch_on(share_captions=True, share_faces=True, share_location=True)
        self.assertEqual(
            self.photo_link()["results"]["captions_json"]["im2txt"], GENERATED
        )

    def test_the_album_grid_sends_no_rating(self):
        item = self.album_grid()
        self.assertEqual(item["rating"], 0)
        self.assertIsNone(item["exif_gps_lat"])
        self.assertEqual(item["date"], "")

    def test_the_album_switches_decide_the_grid(self):
        self.album_share.share_location = True
        self.album_share.save()
        self.assertEqual(self.album_grid()["exif_gps_lat"], LAT)

    def test_an_unreadable_switch_counts_as_off(self):
        self.owner.public_sharing_defaults = {"share_location": "no"}
        self.owner.save()
        self.assertIsNone(self.photo_link()["results"]["exif_gps_lat"])
        self.assertIsNone(self.album_grid()["exif_gps_lat"])


class StaffMetadataTest(TestCase):
    def test_staff_cannot_edit_another_users_metadata(self):
        owner = create_test_user()
        photo = create_test_photo(owner=owner, camera="Cam")
        staff = APIClient()
        staff.force_authenticate(create_test_user(is_admin=True))
        response = staff.patch(
            f"/api/photos/{photo.pk}/metadata/",
            {"title": "Changed by staff"},
            format="json",
        )
        self.assertEqual(response.status_code, 404)
        photo.metadata.refresh_from_db()
        self.assertNotEqual(photo.metadata.title, "Changed by staff")

    def test_a_signed_in_stranger_reads_no_public_photo_metadata(self):
        owner = create_test_user()
        photo = create_test_photo(owner=owner, public=True, camera="Cam")
        stranger = APIClient()
        stranger.force_authenticate(create_test_user())
        response = stranger.get(f"/api/photos/{photo.pk}/metadata/")
        self.assertEqual(response.status_code, 404)
