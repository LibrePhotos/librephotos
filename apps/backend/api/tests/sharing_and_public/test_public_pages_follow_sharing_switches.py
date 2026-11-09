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
    create_test_album_user,
    create_test_face,
    create_test_person,
    create_test_photo,
    create_test_user,
    day_photo_ids,
    list_days,
)
from api.timeline.days import UNDATED_DAY_ID, day_id

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

    def public(self, **params):
        return {"public": "true", "username": self.owner.username, **params}

    def day_items(self, client, day=UNDATED_DAY_ID, **params):
        response = client.get(f"/api/days/{day}/photos/", self.public(**params))
        self.assertEqual(response.status_code, 200)
        return response.json()["items"]


class DayAlbumTest(PublicPhotoFixture):
    def test_without_switches_a_day_shows_no_place_time_or_rating(self):
        for name, client in self.readers().items():
            with self.subTest(name):
                (day,) = list_days(client, self.public())
                item = self.day_items(client, day["id"])[0]
                self.assertIsNone(item["exif_gps_lat"])
                self.assertIsNone(item["exif_gps_lon"])
                self.assertEqual(item["location"], "")
                self.assertEqual(item["date"], "")
                self.assertEqual(item["birthTime"], "")
                self.assertEqual(item["rating"], 0)
                self.assertIsNone(item["stacks"])
                self.assertFalse(item["has_raw_variant"])
                self.assertEqual(day["id"], UNDATED_DAY_ID)
                self.assertIsNone(day["date"])
                self.assertEqual(day["location"], "")

    def test_the_switches_show_place_and_time(self):
        self.switch_on(share_location=True, share_timestamps=True)
        (day,) = list_days(self.anonymous, self.public())
        item = self.day_items(self.anonymous, day["id"])[0]
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
        item = self.day_items(owner)[0]
        self.assertIsNone(item["exif_gps_lat"])

    def test_the_day_list_names_no_date_or_place_without_switches(self):
        days = list_days(self.anonymous, self.public())
        self.assertEqual(len(days), 1)
        self.assertEqual(days[0]["id"], UNDATED_DAY_ID)
        self.assertIsNone(days[0]["date"])
        self.assertEqual(days[0]["location"], "")
        self.switch_on(share_location=True, share_timestamps=True)
        days = list_days(self.anonymous, self.public())
        self.assertEqual(days[0]["id"], day_id(TAKEN.date()))
        self.assertEqual(days[0]["date"], "2024-07-14")
        self.assertEqual(days[0]["location"], "Munich")

    def test_dates_without_the_location_switch_name_no_place(self):
        self.switch_on(share_timestamps=True)
        (day,) = list_days(self.anonymous, self.public())
        self.assertEqual(day["date"], "2024-07-14")
        self.assertEqual(day["location"], "")

    def test_the_public_view_cannot_be_filtered_by_what_it_hides(self):
        self.switch_on(share_timestamps=True)
        everything = list_days(self.anonymous, self.public())
        day = everything[0]["id"]
        photos = day_photo_ids(self.anonymous, day, self.public())
        person = self.photo.faces.get().person_id
        for extra in (
            {"person": person + 1000},
            {"folder": "/nowhere/at/all"},
            {"favorite": "false"},
            {"favorite": "true"},
            {"hidden": "true"},
            {"in_trashcan": "true"},
        ):
            with self.subTest(extra):
                params = self.public(**extra)
                self.assertEqual(list_days(self.anonymous, params), everything)
                self.assertEqual(day_photo_ids(self.anonymous, day, params), photos)

    def test_hidden_or_trashed_public_photos_stay_out(self):
        hidden = create_test_photo(owner=self.owner, public=True, hidden=True)
        trashed = create_test_photo(owner=self.owner, public=True, in_trashcan=True)
        for params in ({"hidden": "true"}, {"in_trashcan": "true"}, {}):
            with self.subTest(params):
                ids = [item["id"] for item in self.day_items(self.anonymous, **params)]
                self.assertEqual(ids, [str(self.photo.pk)])
                self.assertNotIn(str(hidden.pk), ids)
                self.assertNotIn(str(trashed.pk), ids)
        (day,) = list_days(self.anonymous, self.public())
        self.assertEqual(day["numberOfItems"], 1)


class UndatedPublicPageTest(PublicPhotoFixture):
    """Without the dates switch the public view groups no photos by day."""

    def setUp(self):
        super().setUp()
        self.later = create_test_photo(
            owner=self.owner,
            public=True,
            exif_timestamp=TAKEN + datetime.timedelta(days=30),
        )
        self.later_day = day_id((TAKEN + datetime.timedelta(days=30)).date())

    def test_the_days_are_one_undated_group(self):
        days = list_days(self.anonymous, self.public())
        self.assertEqual(len(days), 1)
        self.assertEqual(days[0]["id"], UNDATED_DAY_ID)
        self.assertIsNone(days[0]["date"])
        self.assertEqual(days[0]["numberOfItems"], 2)
        items = self.day_items(self.anonymous)
        # By id: an order that tells nothing about when they were taken.
        ids = [item["id"] for item in items]
        self.assertEqual(ids, sorted([str(self.photo.pk), str(self.later.pk)]))
        self.assertEqual({item["date"] for item in items}, {""})

    def test_the_other_days_do_not_open(self):
        for day in (day_id(TAKEN.date()), self.later_day):
            for view in ("photos", "layout"):
                with self.subTest(day=day, view=view):
                    response = self.anonymous.get(
                        f"/api/days/{day}/{view}/", self.public()
                    )
                    self.assertEqual(response.status_code, 404)

    def test_with_the_dates_switch_the_days_come_back(self):
        self.switch_on(share_timestamps=True)
        days = list_days(self.anonymous, self.public())
        self.assertEqual(
            [day["date"] for day in days],
            ["2024-08-13", "2024-07-14"],
        )
        self.assertEqual(
            day_photo_ids(self.anonymous, self.later_day, self.public()),
            [str(self.later.pk)],
        )

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


class PublicViewFilterTest(TestCase):
    """The public view filters by nothing it keeps from visitors."""

    def setUp(self):
        self.owner = create_test_user(public_sharing=True)
        early = datetime.datetime(2020, 3, 1, 12, 0, tzinfo=datetime.UTC)
        self.early = create_test_photo(
            owner=self.owner, public=True, exif_timestamp=early
        )
        self.late = create_test_photo(
            owner=self.owner, public=True, exif_timestamp=TAKEN
        )
        self.day1 = day_id(early.date())
        self.day2 = day_id(TAKEN.date())
        self.base = {"public": "true", "username": self.owner.username}
        self.client = APIClient()

    def test_archived_is_neither_sent_nor_a_filter(self):
        self.late.archived = True
        self.late.save()
        self.switch_dates_on()
        url = f"/api/days/{self.day2}/photos/"
        items = self.client.get(url, self.base).json()["items"]
        self.assertEqual([item["archived"] for item in items], [False])
        only_archived = self.client.get(url, {**self.base, "archived": "true"})
        self.assertEqual(len(only_archived.json()["items"]), 1)
        days = list_days(self.client, {**self.base, "archived": "false"})
        self.assertEqual(len(days), 2)

    def switch_dates_on(self):
        settings = get_default_public_sharing_settings()
        settings["share_timestamps"] = True
        self.owner.public_sharing_defaults = settings
        self.owner.save()

    def test_the_day_of_a_hidden_public_photo_is_not_listed(self):
        self.switch_dates_on()
        self.early.hidden = True
        self.early.save()
        days = list_days(self.client, self.base)
        self.assertEqual([day["id"] for day in days], [self.day2])
        self.assertEqual(day_photo_ids(self.client, self.day1, self.base), [])
        layout = self.client.get(f"/api/days/{self.day1}/layout/", self.base)
        self.assertEqual(layout.json()["numberOfItems"], 0)


class PublicAlbumByIdTest(TestCase):
    """An album's public link is its slug; its id, which counts up, opens
    nothing for a visitor."""

    def setUp(self):
        self.owner = create_test_user()
        self.album = create_test_album_user(self.owner, title="Private trip")
        self.album.photos.add(create_test_photo(owner=self.owner))
        self.share = AlbumUserShare.objects.create(  # raw-create: a public link
            album=self.album, enabled=True
        )

    def test_the_id_alone_is_a_404(self):
        response = APIClient().get(
            f"/api/albums/user/{self.album.pk}/", {"public": "true"}
        )
        self.assertEqual(response.status_code, 404)

    def test_another_albums_slug_is_a_404(self):
        other = create_test_album_user(self.owner)
        other_share = AlbumUserShare.objects.create(album=other, enabled=True)
        response = APIClient().get(
            f"/api/albums/user/{self.album.pk}/",
            {"public": "true", "slug": other_share.slug},
        )
        self.assertEqual(response.status_code, 404)

    def test_the_slug_opens_it(self):
        response = APIClient().get(
            f"/api/albums/user/{self.album.pk}/",
            {"public": "true", "slug": self.share.slug},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["title"], "Private trip")

    def test_the_owner_still_opens_it_by_id(self):
        client = APIClient()
        client.force_authenticate(self.owner)
        response = client.get(f"/api/albums/user/{self.album.pk}/")
        self.assertEqual(response.status_code, 200)
