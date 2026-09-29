"""Unit tests for the functions moved out of ``Photo`` whose coverage was only
indirect: day-album bookkeeping (``api.metadata.photo_datetime``), place-album
lookup (``api.geocode.photo_location``), face persistence
(``api.photo_faces``) and file detachment (``api.photo_files``).

The datetime rules and exiftool are mocked; no network, no ML models.
"""

import datetime
import os
from unittest.mock import patch

import numpy as np
import PIL
from django.test import TestCase

from api.geocode.photo_location import find_album_places
from api.metadata.photo_datetime import extract_date_time, find_album_date
from api.models import Face, Photo
from api.models.album_date import AlbumDate, get_or_create_album_date
from api.models.album_place import get_album_place
from api.photo_faces import save_detected_face
from api.photo_files import detach_missing_files
from api.tests.utils import create_test_file, create_test_photo, create_test_user

JUNE_1 = datetime.datetime(2020, 6, 1, 12, 0, tzinfo=datetime.timezone.utc)
JULY_4 = datetime.datetime(2021, 7, 4, 9, 30, tzinfo=datetime.timezone.utc)


def _extracted(value):
    return patch(
        "api.metadata.photo_datetime.date_time_extractor.extract_local_date_time",
        return_value=value,
    )


class FindAlbumDateTest(TestCase):
    def setUp(self):
        self.user = create_test_user()

    def test_dated_photo_in_its_day_album(self):
        photo = create_test_photo(owner=self.user, exif_timestamp=JUNE_1)
        album = get_or_create_album_date(JUNE_1.date(), self.user)
        album.photos.add(photo)

        self.assertEqual(find_album_date(photo), album)

    def test_dated_photo_not_in_its_day_album(self):
        photo = create_test_photo(owner=self.user, exif_timestamp=JUNE_1)
        get_or_create_album_date(JUNE_1.date(), self.user)

        self.assertIsNone(find_album_date(photo))

    def test_dated_photo_without_a_day_album(self):
        photo = create_test_photo(owner=self.user, exif_timestamp=JUNE_1)

        self.assertIsNone(find_album_date(photo))

    def test_undated_photo_in_the_no_date_album(self):
        photo = create_test_photo(owner=self.user, exif_timestamp=None)
        album = get_or_create_album_date(None, self.user)
        album.photos.add(photo)

        self.assertEqual(find_album_date(photo), album)

    def test_other_owners_album_is_not_found(self):
        other = create_test_user()
        photo = create_test_photo(owner=self.user, exif_timestamp=JUNE_1)
        get_or_create_album_date(JUNE_1.date(), other).photos.add(photo)

        self.assertIsNone(find_album_date(photo))


class ExtractDateTimeTest(TestCase):
    def setUp(self):
        self.user = create_test_user()

    def test_sets_timestamp_and_files_photo_under_its_day(self):
        photo = create_test_photo(owner=self.user, exif_timestamp=None)

        with _extracted(JULY_4):
            extract_date_time(photo)

        photo.refresh_from_db()
        self.assertEqual(photo.exif_timestamp, JULY_4)
        album = AlbumDate.objects.get(owner=self.user, date=JULY_4.date())
        self.assertTrue(album.photos.filter(pk=photo.pk).exists())

    def test_moves_photo_out_of_its_old_day_album(self):
        photo = create_test_photo(owner=self.user, exif_timestamp=JUNE_1)
        old = get_or_create_album_date(JUNE_1.date(), self.user)
        old.photos.add(photo)

        with _extracted(JULY_4):
            extract_date_time(photo)

        self.assertFalse(old.photos.filter(pk=photo.pk).exists())
        new = AlbumDate.objects.get(owner=self.user, date=JULY_4.date())
        self.assertTrue(new.photos.filter(pk=photo.pk).exists())

    def test_undated_result_goes_to_the_no_date_album(self):
        photo = create_test_photo(owner=self.user, exif_timestamp=None)

        with _extracted(None):
            extract_date_time(photo)

        album = AlbumDate.objects.get(owner=self.user, date=None)
        self.assertTrue(album.photos.filter(pk=photo.pk).exists())

    def test_commit_false_does_not_save_the_photo(self):
        photo = create_test_photo(owner=self.user, exif_timestamp=None)

        with _extracted(JULY_4):
            extract_date_time(photo, commit=False)

        self.assertEqual(photo.exif_timestamp, JULY_4)
        self.assertIsNone(Photo.objects.get(pk=photo.pk).exif_timestamp)
        # The day album is still updated.
        album = AlbumDate.objects.get(owner=self.user, date=JULY_4.date())
        self.assertTrue(album.photos.filter(pk=photo.pk).exists())

    def test_passes_the_owners_rules_and_photo_state_to_the_extractor(self):
        photo = create_test_photo(
            owner=self.user, exif_gps_lat=52.5, exif_gps_lon=13.4, timestamp=JUNE_1
        )

        with _extracted(JULY_4) as extract:
            extract_date_time(photo)

        args = extract.call_args.args
        self.assertEqual(args[0], photo.main_file.path)
        self.assertEqual(args[3:], (52.5, 13.4, self.user.default_timezone, JUNE_1))

    def test_exif_getter_reads_the_main_file_with_sidecars(self):
        photo = create_test_photo(owner=self.user)

        def call_getter(path, rules, exif_getter, *rest):
            exif_getter(["EXIF:DateTimeOriginal"])
            return None

        with (
            patch(
                "api.metadata.photo_datetime.date_time_extractor.extract_local_date_time",
                side_effect=call_getter,
            ),
            patch(
                "api.metadata.photo_datetime.get_metadata", return_value=[None]
            ) as get_metadata,
        ):
            extract_date_time(photo)

        get_metadata.assert_called_once_with(
            photo.main_file.path, tags=["EXIF:DateTimeOriginal"], try_sidecar=True
        )


class FindAlbumPlacesTest(TestCase):
    def test_returns_only_the_places_holding_the_photo(self):
        user = create_test_user()
        photo = create_test_photo(owner=user)
        berlin = get_album_place("Berlin", owner=user)
        berlin.photos.add(photo)
        get_album_place("Paris", owner=user)

        self.assertEqual(list(find_album_places(photo)), [berlin])

    def test_photo_without_places(self):
        photo = create_test_photo(owner=create_test_user())

        self.assertFalse(find_album_places(photo).exists())


class SaveDetectedFaceTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)

    def test_saves_crop_and_location(self):
        crop = PIL.Image.new("RGB", (40, 40), (10, 20, 30))

        face = save_detected_face(
            self.photo, crop, "crop_0.jpg", None, None, (10, 60, 50, 20)
        )

        face = Face.objects.get(pk=face.pk)
        self.assertEqual(face.photo_id, self.photo.pk)
        self.assertEqual(
            (
                face.location_top,
                face.location_right,
                face.location_bottom,
                face.location_left,
            ),
            (10, 60, 50, 20),
        )
        self.assertEqual(face.encoding, "")
        self.assertIsNone(face.person)
        self.assertIsNone(face.cluster)
        with PIL.Image.open(face.image.path) as saved:
            self.assertEqual(saved.format, "JPEG")

    def test_stores_the_encoding_as_hex(self):
        encoding = np.array([0.25, -1.5])

        face = save_detected_face(
            self.photo,
            PIL.Image.new("RGB", (8, 8)),
            "enc.jpg",
            None,
            None,
            (0, 8, 8, 0),
            encoding,
        )

        self.assertEqual(face.encoding, encoding.tobytes().hex())

    def test_palette_and_alpha_crops_are_converted_for_jpeg(self):
        for mode in ("RGBA", "P"):
            with self.subTest(mode=mode):
                face = save_detected_face(
                    self.photo,
                    PIL.Image.new(mode, (8, 8)),
                    f"{mode}.jpg",
                    None,
                    None,
                    (0, 8, 8, 0),
                )
                with PIL.Image.open(face.image.path) as saved:
                    self.assertEqual(saved.mode, "RGB")


class DetachMissingFilesTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)

    def test_missing_file_is_detached_and_flagged_present_one_kept(self):
        present = self.photo.main_file
        gone = create_test_file(
            f"/tmp/{self.photo.image_hash}_gone.png", self.user, b"gone"
        )
        os.remove(gone.path)
        self.photo.files.add(present, gone)

        detach_missing_files(self.photo)

        self.assertEqual(list(self.photo.files.all()), [present])
        gone.refresh_from_db()
        present.refresh_from_db()
        self.assertTrue(gone.missing)
        self.assertFalse(present.missing)

    def test_an_edit_made_while_the_scan_held_the_row_survives(self):
        """The scan loads photos in pages of thousands, then gets to each one."""
        held_by_scan = Photo.objects.get(pk=self.photo.pk)
        edited = Photo.objects.get(pk=self.photo.pk)
        edited.rating = 5
        edited.save()

        detach_missing_files(held_by_scan)

        self.photo.refresh_from_db()
        self.assertEqual(self.photo.rating, 5)

    def test_an_edit_survives_even_when_a_file_is_detached(self):
        gone = create_test_file(
            f"/tmp/{self.photo.image_hash}_gone.png", self.user, b"gone"
        )
        os.remove(gone.path)
        self.photo.files.add(gone)
        held_by_scan = Photo.objects.get(pk=self.photo.pk)
        Photo.objects.filter(pk=self.photo.pk).update(rating=4)

        detach_missing_files(held_by_scan)

        self.photo.refresh_from_db()
        self.assertEqual(self.photo.rating, 4)
        self.assertNotIn(gone, self.photo.files.all())

    def test_a_photo_that_lost_nothing_is_not_written(self):
        """Every scan used to bump every row, so removed photos never aged out."""
        before = Photo.objects.get(pk=self.photo.pk).last_modified

        detach_missing_files(Photo.objects.get(pk=self.photo.pk))

        self.assertEqual(Photo.objects.get(pk=self.photo.pk).last_modified, before)

    def test_a_photo_that_lost_a_file_tells_the_sync_feed(self):
        gone = create_test_file(
            f"/tmp/{self.photo.image_hash}_gone.png", self.user, b"gone"
        )
        os.remove(gone.path)
        self.photo.files.add(gone)
        before = Photo.objects.get(pk=self.photo.pk).last_modified

        detach_missing_files(Photo.objects.get(pk=self.photo.pk))

        self.assertGreater(Photo.objects.get(pk=self.photo.pk).last_modified, before)

    def test_manual_delete_still_delegates_to_remove_photo(self):
        with patch("api.photo_files.remove_photo", return_value="done") as remove:
            self.assertEqual(self.photo.manual_delete(), "done")

        remove.assert_called_once_with(self.photo)

    def test_save_metadata_still_delegates_to_write_photo_metadata(self):
        with patch("api.models.photo.write_photo_metadata") as write:
            self.photo._save_metadata(["rating"], False, ["ratings"])

        write.assert_called_once_with(
            self.photo,
            modified_fields=["rating"],
            use_sidecar=False,
            metadata_types=["ratings"],
        )
