"""One store per metadata field, one write path (#2252).

The metadata API used to write its own copies of the rating, caption, date and
location in ``PhotoMetadata``, which nothing else read: an edit there answered
200 and changed nothing the user could see. Every edit now goes through
``api.metadata.edits`` into the store the app reads, and the metadata API
shows those stores.
"""

import ast
import datetime
import os
from unittest.mock import patch

from django.test import SimpleTestCase, TestCase
from django.utils.dateparse import parse_datetime
from rest_framework.test import APIClient

from api.metadata import edits
from api.metadata.jobs import queue_field_write, write_photo_fields
from api.metadata.reader import MetadataReadError
from api.models import Photo, User
from api.models.album_place import AlbumPlace
from api.models.album_thing import AlbumThing
from api.models.photo_caption import PhotoCaption
from api.models.photo_metadata import (
    IMPORTED_DESCRIPTION_KEY,
    MetadataEdit,
    PhotoMetadata,
)
from api.models.photo_search import PhotoSearch
from api.models.tag import Tag
from api.tests.utils import (
    create_test_album_date,
    create_test_photo,
    create_test_user,
)

WHEN = datetime.datetime(2021, 6, 5, 4, 3, 2, tzinfo=datetime.timezone.utc)
GEOCODED = {
    "features": [{"text": "Lisbon", "center": [38.7, -9.1]}],
    "places": ["Lisbon"],
    "address": "Lisbon, Portugal",
}


def _no_file_metadata(path, tags, **kwargs):
    """A file without any metadata (the exif service is not running here)."""
    return [None] * len(tags)


class MetadataApiTestCase(TestCase):
    def setUp(self):
        self.user = create_test_user(favorite_min_rating=4)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.photo = create_test_photo(owner=self.user)
        self.url = f"/api/photos/{self.photo.pk}/metadata/"

    def patch_metadata(self, body, url=None):
        with patch("api.metadata.jobs.enqueue_task"):
            return self.client.patch(url or self.url, body, format="json")

    def search(self, term):
        response = self.client.get("/api/photos/searchlist/", {"search": term})
        self.assertEqual(response.status_code, 200)
        return [
            item["image_hash"]
            for group in response.json()["results"]
            for item in group["items"]
        ]


class RatingTest(MetadataApiTestCase):
    def test_a_patched_rating_is_the_photos_rating(self):
        response = self.patch_metadata({"rating": 5})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["rating"], 5)
        self.photo.refresh_from_db()
        self.assertEqual(self.photo.rating, 5)
        edit = MetadataEdit.objects.get(photo=self.photo, field_name="rating")
        self.assertEqual((edit.old_value, edit.new_value), (0, 5))

    def test_a_patched_rating_puts_the_photo_in_favorites(self):
        day = create_test_album_date(self.user, WHEN.date())
        day.photos.add(self.photo)

        def favorite_days():
            response = self.client.get("/api/albums/date/list/", {"favorite": "true"})
            return [row["id"] for row in response.json()["results"]]

        self.assertEqual(favorite_days(), [])
        self.patch_metadata({"rating": 4})
        self.assertEqual(favorite_days(), [day.id])

    def test_the_rating_write_is_queued_like_a_favorite(self):
        self.user.save_metadata_to_disk = User.SaveMetadata.SIDECAR_FILE
        self.user.save()

        with patch("api.metadata.jobs.enqueue_task") as async_task:
            self.client.patch(self.url, {"rating": 3}, format="json")

        _, photo_ids, use_sidecar = async_task.call_args.args
        self.assertEqual(list(photo_ids), [self.photo.pk])
        self.assertTrue(use_sidecar)

    def test_a_favorite_is_in_the_edit_history(self):
        with patch("api.metadata.jobs.enqueue_task"):
            self.client.post(
                "/api/photosedit/favorite/",
                {"image_hashes": [self.photo.image_hash], "favorite": True},
                format="json",
            )

        edit = MetadataEdit.objects.get(photo=self.photo, field_name="rating")
        self.assertEqual((edit.old_value, edit.new_value), (0, 4))
        self.assertEqual(edit.user, self.user)

    def test_null_means_no_rating(self):
        Photo.objects.filter(pk=self.photo.pk).update(rating=3)

        response = self.patch_metadata({"rating": None})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(Photo.objects.get(pk=self.photo.pk).rating, 0)

    def test_a_rating_out_of_range_is_a_400(self):
        for rating in (6, -1, "five"):
            with self.subTest(rating=rating):
                response = self.patch_metadata({"rating": rating})
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json()["errors"][0]["field"], "rating")


class CaptionTest(MetadataApiTestCase):
    def test_a_patched_caption_is_the_lightbox_caption(self):
        response = self.patch_metadata({"caption": "Grandma's 80th #family"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["caption"], "Grandma's 80th #family")
        captions = PhotoCaption.objects.get(photo=self.photo).captions_json
        self.assertEqual(captions["user_caption"], "Grandma's 80th #family")

    def test_a_patched_caption_is_searchable(self):
        self.patch_metadata({"caption": "Grandma's eightieth"})

        self.assertEqual(self.search("eightieth"), [self.photo.image_hash])

    def test_a_patched_hashtag_makes_a_hashtag_album(self):
        self.patch_metadata({"caption": "cake #family"})

        album = AlbumThing.objects.get(
            owner=self.user, thing_type="hashtag_attribute", title="#family"
        )
        self.assertEqual(list(album.photos.all()), [self.photo])

    def test_the_lightbox_caption_is_shown_in_the_metadata(self):
        self.client.post(
            "/api/photosedit/savecaption/",
            {"image_hash": self.photo.image_hash, "caption": "typed in the lightbox"},
            format="json",
        )

        response = self.client.get(self.url)
        self.assertEqual(response.json()["caption"], "typed in the lightbox")
        edit = MetadataEdit.objects.get(photo=self.photo, field_name="caption")
        self.assertEqual(
            (edit.old_value, edit.new_value), ("", "typed in the lightbox")
        )

    def test_savecaption_without_a_caption_is_a_400(self):
        response = self.client.post(
            "/api/photosedit/savecaption/",
            {"image_hash": self.photo.image_hash},
            format="json",
        )
        self.assertEqual(response.status_code, 400)


class KeywordsTest(MetadataApiTestCase):
    def setUp(self):
        super().setUp()
        self.patch_metadata({"keywords": ["zanzibar", "beach"]})

    def test_a_removed_keyword_no_longer_matches_search(self):
        self.assertEqual(self.search("zanzibar"), [self.photo.image_hash])

        self.patch_metadata({"keywords": ["beach"]})

        self.assertEqual(self.search("zanzibar"), [])
        self.assertEqual(self.search("beach"), [self.photo.image_hash])

    def test_the_tags_follow(self):
        self.patch_metadata({"keywords": ["beach"]})

        tags = Tag.objects.filter(owner=self.user, photos=self.photo)
        self.assertEqual(sorted(tags.values_list("name", flat=True)), ["beach"])


class TextFieldsTest(MetadataApiTestCase):
    def test_title_copyright_and_creator_stay_in_photo_metadata(self):
        response = self.patch_metadata(
            {"title": "Sunset", "copyright": "CC BY", "creator": "Ann"}
        )

        self.assertEqual(response.status_code, 200)
        metadata = PhotoMetadata.objects.get(photo=self.photo)
        self.assertEqual(
            (metadata.title, metadata.copyright, metadata.creator),
            ("Sunset", "CC BY", "Ann"),
        )
        self.assertEqual(
            set(
                MetadataEdit.objects.filter(photo=self.photo).values_list(
                    "field_name", flat=True
                )
            ),
            {"title", "copyright", "creator"},
        )

    def test_an_unchanged_value_records_no_edit(self):
        self.patch_metadata({"title": "Sunset"})
        self.patch_metadata({"title": "Sunset"})

        self.assertEqual(
            MetadataEdit.objects.filter(photo=self.photo, field_name="title").count(),
            1,
        )


class MovedFieldsTest(MetadataApiTestCase):
    def test_the_date_and_the_location_are_a_400_here(self):
        for body in (
            {"date_taken": "2024-05-01T12:34:56Z"},
            {"timezone_offset": "+02:00"},
            {"gps_latitude": 1.0, "gps_longitude": 2.0},
            {"location_city": "Lisbon"},
        ):
            with self.subTest(body=body):
                response = self.patch_metadata({**body, "title": "ignored"})

                self.assertEqual(response.status_code, 400)
                fields = {error["field"] for error in response.json()["errors"]}
                self.assertEqual(fields, set(body))
        self.assertFalse(MetadataEdit.objects.filter(photo=self.photo).exists())


class DerivedFieldsTest(MetadataApiTestCase):
    """``metadata.*`` shows the stores the app reads, under the old names."""

    def setUp(self):
        super().setUp()
        Photo.objects.filter(pk=self.photo.pk).update(
            exif_timestamp=WHEN,
            exif_gps_lat=38.7,
            exif_gps_lon=-9.1,
            rating=3,
            geolocation_json=GEOCODED,
        )
        PhotoMetadata.objects.create(photo=self.photo, camera_model="X-T5")

    def test_the_photo_api_summary(self):
        response = self.client.get(f"/api/photos/{self.photo.image_hash}/")

        summary = response.json()["metadata"]
        self.assertEqual(summary["date_taken"], "2021-06-05T04:03:02Z")
        self.assertTrue(summary["has_location"])
        self.assertEqual(summary["rating"], 3)

    def test_the_full_metadata(self):
        data = self.client.get(self.url).json()

        self.assertEqual(data["date_taken"], "2021-06-05T04:03:02Z")
        self.assertEqual((data["gps_latitude"], data["gps_longitude"]), (38.7, -9.1))
        self.assertTrue(data["has_location"])
        self.assertEqual(data["location_address"], "Lisbon, Portugal")
        self.assertEqual(data["rating"], 3)
        self.assertEqual(data["sidecar_files"], [])

    def test_the_bulk_summary(self):
        response = self.client.get(
            "/api/photos/metadata/bulk/", {"photo_ids": str(self.photo.pk)}
        )

        row = response.json()[str(self.photo.pk)]
        self.assertEqual(row["camera"], "X-T5")
        self.assertTrue(row["has_location"])
        self.assertEqual(row["rating"], 3)


class BulkPatchTest(MetadataApiTestCase):
    def setUp(self):
        super().setUp()
        self.other = create_test_photo(owner=self.user)
        self.ids = [str(self.photo.pk), str(self.other.pk)]

    def bulk(self, updates, ids=None):
        return self.patch_metadata(
            {"photo_ids": ids or self.ids, "updates": updates},
            url="/api/photos/metadata/bulk/",
        )

    def test_bulk_rating_and_caption_reach_the_app(self):
        response = self.bulk({"rating": 5, "caption": "same for all"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["updated_count"], 2)
        for photo in (self.photo, self.other):
            photo.refresh_from_db()
            self.assertEqual(photo.rating, 5)
            self.assertEqual(
                PhotoCaption.objects.get(photo=photo).captions_json["user_caption"],
                "same for all",
            )

    def test_a_wrongly_typed_value_is_a_400_not_a_500(self):
        for updates in ({"rating": "five"}, {"keywords": "beach"}, {"title": ["a"]}):
            with self.subTest(updates=updates):
                response = self.bulk(updates)
                self.assertEqual(response.status_code, 400)
                self.assertIn("errors", response.json())
        self.assertEqual(Photo.objects.get(pk=self.photo.pk).rating, 0)

    def test_the_date_is_a_400_in_bulk_too(self):
        response = self.bulk({"date_taken": "2024-05-01T12:34:56Z"})
        self.assertEqual(response.status_code, 400)

    def test_another_users_photo_is_not_touched(self):
        stranger = create_test_photo(owner=create_test_user())

        response = self.bulk({"rating": 5}, ids=[str(stranger.pk)])

        self.assertEqual(response.json()["updated_count"], 0)
        self.assertEqual(Photo.objects.get(pk=stranger.pk).rating, 0)


class PhotoEditPathsTest(MetadataApiTestCase):
    """The lightbox's date and location editor goes through the same service."""

    def test_a_date_edit_is_recorded_and_revertible(self):
        with patch(
            "api.metadata.photo_datetime.get_metadata", side_effect=_no_file_metadata
        ):
            response = self.client.patch(
                f"/api/photos/edit/{self.photo.image_hash}/",
                {"exif_timestamp": "2021-06-05T04:03:02Z"},
                format="json",
            )
            self.assertEqual(response.status_code, 200)
            self.photo.refresh_from_db()
            self.assertEqual(self.photo.exif_timestamp, WHEN)
            edit = MetadataEdit.objects.get(photo=self.photo, field_name="date_taken")
            # DjangoJSONEncoder stores the datetime as an ISO string ending in
            # "Z", which datetime.fromisoformat only reads from Python 3.11 on.
            self.assertEqual(parse_datetime(edit.new_value), WHEN)

            response = self.client.post(f"{self.url}revert/{edit.id}/")

        self.assertEqual(response.status_code, 200)
        self.photo.refresh_from_db()
        self.assertIsNone(self.photo.exif_timestamp)

    def test_a_location_edit_is_recorded_and_revertible(self):
        with patch("api.metadata.edits.reverse_geocode", return_value=dict(GEOCODED)):
            response = self.client.patch(
                f"/api/photos/edit/{self.photo.image_hash}/",
                {"exif_gps_lat": 38.7, "exif_gps_lon": -9.1},
                format="json",
            )
        self.assertEqual(response.status_code, 200)
        self.photo.refresh_from_db()
        self.assertEqual(self.photo.exif_gps_lat, 38.7)
        self.assertEqual(
            PhotoSearch.objects.get(photo=self.photo).search_location,
            "Lisbon, Portugal",
        )
        place = AlbumPlace.objects.get(owner=self.user, title="Lisbon")
        self.assertEqual(list(place.photos.all()), [self.photo])
        edit = MetadataEdit.objects.get(photo=self.photo, field_name="location")
        self.assertEqual(edit.new_value, {"latitude": 38.7, "longitude": -9.1})

        # Reverting to "no location" clears it, its place and its search text.
        response = self.client.post(f"{self.url}revert/{edit.id}/")

        self.assertEqual(response.status_code, 200)
        self.photo.refresh_from_db()
        self.assertIsNone(self.photo.exif_gps_lat)
        self.assertFalse(place.photos.exists())
        self.assertEqual(PhotoSearch.objects.get(photo=self.photo).search_location, "")

    def test_reverting_a_rating_edit(self):
        self.patch_metadata({"rating": 2})
        self.patch_metadata({"rating": 5})
        latest = MetadataEdit.objects.filter(
            photo=self.photo, field_name="rating"
        ).first()
        assert latest is not None

        with patch("api.metadata.jobs.enqueue_task"):
            response = self.client.post(f"{self.url}revert/{latest.id}/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(Photo.objects.get(pk=self.photo.pk).rating, 2)

    def test_an_edit_of_a_dropped_field_cannot_be_reverted(self):
        legacy = MetadataEdit.objects.create(
            photo=self.photo,
            user=self.user,
            field_name="gps_latitude",
            old_value=None,
            new_value=1.0,
        )

        response = self.client.post(f"{self.url}revert/{legacy.id}/")

        self.assertEqual(response.status_code, 400)

    def test_a_malformed_old_value_is_a_400(self):
        edit = MetadataEdit.objects.create(
            photo=self.photo,
            user=self.user,
            field_name="rating",
            old_value="lots",
            new_value=2,
        )

        response = self.client.post(f"{self.url}revert/{edit.id}/")

        self.assertEqual(response.status_code, 400)


class RevertAllTest(MetadataApiTestCase):
    """Restore from file leaves no user value behind."""

    def test_every_user_value_goes(self):
        Photo.objects.filter(pk=self.photo.pk).update(
            timestamp=WHEN, exif_timestamp=WHEN, exif_gps_lat=1.0, exif_gps_lon=2.0
        )
        self.photo.refresh_from_db()
        self.patch_metadata(
            {
                "rating": 5,
                "caption": "mine #tag",
                "keywords": ["mine"],
                "title": "T",
                "copyright": "C",
                "creator": "A",
            }
        )

        with (
            patch(
                "api.metadata.photo_reader.get_metadata", side_effect=_no_file_metadata
            ),
            patch("api.metadata.edits.get_metadata", side_effect=_no_file_metadata),
            patch(
                "api.metadata.photo_datetime.get_metadata",
                side_effect=_no_file_metadata,
            ),
        ):
            response = self.client.post(f"{self.url}revert-all/")

        self.assertEqual(response.status_code, 200)
        data = response.json()
        for field in ("caption", "keywords", "title", "copyright", "creator"):
            self.assertIsNone(data[field], field)
        self.assertEqual(data["rating"], 0)
        self.assertIsNone(data["date_taken"])
        self.assertFalse(data["has_location"])
        self.assertEqual(data["source"], "embedded")
        photo = Photo.objects.get(pk=self.photo.pk)
        self.assertIsNone(photo.timestamp)
        self.assertFalse(Tag.objects.filter(photos=photo, name="mine").exists())
        self.assertFalse(AlbumThing.objects.filter(photos=photo, title="#tag").exists())
        self.assertEqual(self.search("mine"), [])
        self.assertTrue(
            MetadataEdit.objects.filter(photo=photo, field_name="_all").exists()
        )

    def test_the_files_own_values_come_back(self):
        self.patch_metadata({"rating": 1, "caption": "typed", "keywords": ["typed"]})
        file_values = {
            "Rating": 4,
            "XMP:Subject": ["from-file"],
            "XMP:Description": "the file's description",
        }

        def file_metadata(path, tags, **kwargs):
            return [file_values.get(tag) for tag in tags]

        with (
            patch("api.metadata.photo_reader.get_metadata", side_effect=file_metadata),
            patch("api.metadata.edits.get_metadata", side_effect=_no_file_metadata),
            patch(
                "api.metadata.photo_datetime.get_metadata",
                side_effect=_no_file_metadata,
            ),
        ):
            data = self.client.post(f"{self.url}revert-all/").json()

        self.assertEqual(data["rating"], 4)
        self.assertEqual(data["keywords"], ["from-file"])
        self.assertEqual(data["caption"], "the file's description")

    def test_the_files_text_fields_come_back(self):
        self.patch_metadata({"title": "T", "copyright": "C", "creator": "A"})
        file_values = {
            "XMP:Title": "the file's title",
            "IPTC:By-line": "the file's creator",
        }

        def file_metadata(path, tags, **kwargs):
            return [file_values.get(tag) for tag in tags]

        with (
            patch("api.metadata.photo_reader.get_metadata", side_effect=file_metadata),
            patch("api.metadata.edits.get_metadata", side_effect=_no_file_metadata),
            patch(
                "api.metadata.photo_datetime.get_metadata",
                side_effect=_no_file_metadata,
            ),
        ):
            data = self.client.post(f"{self.url}revert-all/").json()

        self.assertEqual(data["title"], "the file's title")
        self.assertEqual(data["creator"], "the file's creator")
        # The file has no copyright: the user's goes, nothing replaces it.
        self.assertIsNone(data["copyright"])

    def test_the_files_position_is_the_files_again(self):
        # #2264: after restore from file, a rescan follows the file again.
        Photo.objects.filter(pk=self.photo.pk).update(
            exif_gps_lat=1.0, exif_gps_lon=2.0, location_source="user"
        )
        self.photo.refresh_from_db()

        with (
            patch(
                "api.metadata.photo_reader.get_metadata", side_effect=_no_file_metadata
            ),
            patch("api.metadata.edits.get_metadata", side_effect=_no_file_metadata),
            patch(
                "api.metadata.photo_datetime.get_metadata",
                side_effect=_no_file_metadata,
            ),
        ):
            self.client.post(f"{self.url}revert-all/")

        photo = Photo.objects.get(pk=self.photo.pk)
        self.assertEqual((None, None), (photo.exif_gps_lat, photo.exif_gps_lon))
        self.assertEqual("file", photo.location_source)

    def test_the_files_position_gets_its_place(self):
        # The scan's read fills an empty position from the file (#2263);
        # restoring it must still look up the place, not find it unchanged.
        file_values = {"Composite:GPSLatitude": 38.7, "Composite:GPSLongitude": -9.1}

        def file_metadata(path, tags, **kwargs):
            return [file_values.get(tag) for tag in tags]

        with (
            patch("api.metadata.photo_reader.get_metadata", side_effect=file_metadata),
            patch("api.metadata.edits.get_metadata", side_effect=file_metadata),
            patch(
                "api.metadata.photo_datetime.get_metadata",
                side_effect=_no_file_metadata,
            ),
            patch(
                "api.metadata.edits.reverse_geocode", return_value=dict(GEOCODED)
            ) as geocoder,
        ):
            self.client.post(f"{self.url}revert-all/")

        geocoder.assert_called_once_with(38.7, -9.1)
        photo = Photo.objects.get(pk=self.photo.pk)
        self.assertEqual((38.7, -9.1), (photo.exif_gps_lat, photo.exif_gps_lon))
        self.assertEqual(["Lisbon"], (photo.geolocation_json or {}).get("places"))


class ServiceTest(TestCase):
    """The setters themselves, without the HTTP layer."""

    def setUp(self):
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)

    def test_every_edit_bumps_last_modified(self):
        before = Photo.objects.get(pk=self.photo.pk).last_modified

        edits.set_text_field(self.photo, "title", "new", self.user)

        self.assertGreater(Photo.objects.get(pk=self.photo.pk).last_modified, before)

    def test_set_text_field_refuses_other_fields(self):
        with self.assertRaises(ValueError):
            edits.set_text_field(self.photo, "camera_model", "X", self.user)

    def test_set_rating_returns_the_rows_set_and_records_only_changes(self):
        other = create_test_photo(owner=self.user)
        Photo.objects.filter(pk=other.pk).update(rating=3)

        with patch("api.metadata.jobs.enqueue_task"):
            count = edits.set_rating(
                Photo.objects.filter(pk__in=[self.photo.pk, other.pk]), 3, self.user
            )

        self.assertEqual(count, 2)
        self.assertEqual(
            list(
                MetadataEdit.objects.filter(field_name="rating").values_list(
                    "photo_id", flat=True
                )
            ),
            [self.photo.pk],
        )


class QueuedFieldWriteTest(TestCase):
    """``queue_field_write`` and its job; the files themselves are in
    ``test_write_back_round_trip``."""

    def setUp(self):
        self.user = create_test_user(save_metadata_to_disk=User.SaveMetadata.MEDIA_FILE)
        self.photo = create_test_photo(owner=self.user)

    def test_a_field_without_a_writer_is_refused(self):
        with self.assertRaises(ValueError):
            queue_field_write(self.user, [self.photo.id], "keywords")

    def test_the_job_is_queued_after_the_commit(self):
        with patch("api.metadata.jobs.enqueue_task") as queued:
            with self.captureOnCommitCallbacks() as callbacks:
                queue_field_write(self.user, [self.photo.id], "caption")
            queued.assert_not_called()
            for callback in callbacks:
                callback()

        queued.assert_called_once_with(
            write_photo_fields, [self.photo.id], "caption", False
        )

    def test_a_failure_to_queue_is_logged(self):
        with (
            patch("api.metadata.jobs.enqueue_task", side_effect=RuntimeError("down")),
            self.assertLogs("api.metadata.jobs", "ERROR"),
            self.captureOnCommitCallbacks(execute=True),
        ):
            queue_field_write(self.user, [self.photo.id], "location")

    def test_nothing_is_queued_when_off(self):
        User.objects.filter(pk=self.user.pk).update(
            save_metadata_to_disk=User.SaveMetadata.OFF
        )
        self.user.refresh_from_db()

        with self.captureOnCommitCallbacks() as callbacks:
            queue_field_write(self.user, [self.photo.id], "caption")

        self.assertEqual([], callbacks)

    def test_an_unexpected_error_counts_as_a_failure(self):
        def broken(photo, use_sidecar):
            raise RuntimeError("bug")

        with (
            patch.dict("api.metadata.photo_writer.FIELD_WRITERS", caption=broken),
            self.assertLogs("api.metadata.jobs", "ERROR"),
        ):
            failures = write_photo_fields([self.photo.id], "caption", False)

        self.assertEqual(1, failures)

    def test_a_caption_whose_description_cannot_be_read_back_still_counts(self):
        edits._apply_caption(self.photo, "typed", self.user)

        with (
            patch("api.metadata.photo_writer.write_metadata") as write,
            patch(
                "api.metadata.photo_writer.get_metadata",
                side_effect=MetadataReadError("exif service down"),
            ),
            self.assertLogs("api.metadata.photo_writer", "WARNING"),
        ):
            failures = write_photo_fields([self.photo.id], "caption", False)

        self.assertEqual(0, failures)
        write.assert_called_once()
        captions = PhotoCaption.objects.get(photo=self.photo).captions_json
        self.assertNotIn(IMPORTED_DESCRIPTION_KEY, captions)

    def test_a_nextcloud_copy_is_not_written(self):
        with (
            patch("api.metadata.photo_writer.is_nextcloud_copy", return_value=True),
            patch("api.metadata.photo_writer.write_metadata") as write,
        ):
            failures = write_photo_fields([self.photo.id], "location", False)

        self.assertEqual(0, failures)
        write.assert_not_called()


# The calls that apply a user's edit of a metadata field. Outside the edit
# service only the scan may make them (importing the file's description as
# the caption); any other caller is an edit path that skips the history, the
# search refresh or the write-back.
EDIT_CALLS = {
    "apply_user_caption": {
        "api.metadata.edits",
        "api.models.photo_metadata",
    },
    "sync_tags_from_keywords": {"api.metadata.edits"},
    "queue_rating_write": {"api.metadata.edits"},
    "queue_field_write": {"api.metadata.edits"},
    "queue_keyword_write": {"api.metadata.edits"},
}

BACKEND = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))


def _callers(names):
    """{name: {module}} of every call to ``names`` outside tests and migrations."""
    found = {name: set() for name in names}
    for directory, subdirectories, files in os.walk(os.path.join(BACKEND, "api")):
        subdirectories[:] = [
            d for d in subdirectories if d not in ("tests", "migrations")
        ]
        for file_name in files:
            if not file_name.endswith(".py"):
                continue
            path = os.path.join(directory, file_name)
            module = os.path.relpath(path, BACKEND)[:-3].replace(os.sep, ".")
            with open(path, encoding="utf-8") as handle:
                tree = ast.parse(handle.read(), path)
            for node in ast.walk(tree):
                if not isinstance(node, ast.Call):
                    continue
                func = node.func
                name = (
                    func.id
                    if isinstance(func, ast.Name)
                    else func.attr
                    if isinstance(func, ast.Attribute)
                    else None
                )
                if name in found:
                    found[name].add(module)
    return found


class EditPathGuardTest(SimpleTestCase):
    def test_every_metadata_edit_goes_through_the_edit_service(self):
        self.assertEqual(
            EDIT_CALLS,
            _callers(EDIT_CALLS),
            "a new caller applies a metadata edit itself: route it through "
            "api.metadata.edits (#2252)",
        )
