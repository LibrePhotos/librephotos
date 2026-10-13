"""Every metadata write-back path, written and read back with real ExifTool (#2288).

Each test writes through LibrePhotos' own code and reads the result back
through the code the scan uses (``get_metadata`` answered by the exif service
in process, ``extract_date_time``, ``face_extractor.extract_from_exif``), in
both write modes, and checks that nothing is written while sync is Off. Every
write ExifTool executes is also checked to have reached its target with every
tag it was given (``assertWritesLanded``), so a tag that cannot live in the
target (an EXIF tag aimed at an ``.xmp``) fails here.

Tests marked ``expectedFailure`` pin known write-back bugs; each names its
issue and flips to an unexpected success once that bug is fixed.
"""

import ast
import datetime
import os
import unittest
from contextlib import contextmanager
from unittest.mock import patch

from django.db import transaction
from rest_framework.test import APIClient

from api.directory_watcher.file_handlers import _process_photo
from api.faces.extractor import extract_from_exif
from api.metadata.jobs import queue_rating_write, write_photo_ratings
from api.metadata.photo_datetime import extract_date_time
from api.metadata.photo_reader import extract_exif_data
from api.metadata.photo_writer import rotate_photo, write_photo_metadata
from api.metadata.reader import get_metadata
from api.metadata.tags import Tags
from api.metadata.writer import MetadataWriteError, write_metadata
from api.models.person import Person
from api.models.photo import Photo
from api.models.user import User
from api.serializers.photos import PhotoEditSerializer
from api.tests.metadata.exiftool_harness import (
    RealExifToolTestCase,
    layout,
    load,
    shown_layout,
)
from api.tests.utils import create_test_face, create_test_person, create_test_user

SIDECAR = User.SaveMetadata.SIDECAR_FILE
MEDIA_FILE = User.SaveMetadata.MEDIA_FILE
OFF = User.SaveMetadata.OFF
MODES = (SIDECAR, MEDIA_FILE)

IMAGE_FORMATS = (".jpg", ".png", ".tif", ".heic")

TIMESTAMP = datetime.datetime(2019, 8, 15, 7, 45, 0, tzinfo=datetime.timezone.utc)


def run_now(func, *args):
    """Stand-in for ``enqueue_task`` that runs the job right away."""
    func(*args)


class RatingRoundTripTest(RealExifToolTestCase):
    """``write_photo_ratings`` (every rating edit) and ``Photo.save()``, which
    writes nothing."""

    def _rated_photo(self, path, mode, rating=4):
        user = create_test_user(save_metadata_to_disk=mode)
        return self.photo_for(path, user, rating=rating)

    def _read_rating(self, path):
        (rating,) = get_metadata(path, tags=[Tags.RATING], try_sidecar=True)
        return rating

    def _round_trip(self, path, mode):
        photo = self._rated_photo(path, mode)

        write_photo_ratings([photo.id], use_sidecar=mode == SIDECAR)

        self.assertEqual(4, self._read_rating(path))
        self.assertWritesLanded(expected=1)
        target = self.exiftool.writes[0].target
        self.assertEqual(self.sidecar_of(path) if mode == SIDECAR else path, target)

    def test_image_formats(self):
        for extension in IMAGE_FORMATS:
            for mode in MODES:
                with self.subTest(extension=extension, mode=mode):
                    self.exiftool.writes.clear()
                    self._round_trip(self.make_image(extension, f"r-{mode}"), mode)

    def test_video(self):
        for mode in MODES:
            with self.subTest(mode=mode):
                self.exiftool.writes.clear()
                self._round_trip(self.make_video(f"r-{mode}"), mode)

    def test_photo_save_writes_nothing(self):
        # #2336: Photo.save() only saves. The file has no rating, the row now
        # says 5, and write-back is on: the file and its sidecar stay as they
        # were.
        for mode in MODES:
            with self.subTest(mode=mode):
                path = self.make_image(".jpg", f"save-{mode}")
                photo = self._rated_photo(path, mode, rating=1)

                photo.rating = 5
                with (
                    self.assertUntouched(path),
                    self.captureOnCommitCallbacks(execute=True),
                ):
                    photo.save()

                self.assertIsNone(self._read_rating(path))

    def test_nothing_is_written_when_off(self):
        path = self.make_image(".jpg")
        photo = self._rated_photo(path, OFF, rating=1)

        with self.assertUntouched(path), self.captureOnCommitCallbacks(execute=True):
            queue_rating_write(photo.owner, [photo.id])

    def test_a_metadata_api_rating_reaches_the_sidecar(self):
        # #2252: the metadata PATCH used to write PhotoMetadata.rating, which
        # neither the app nor the write-back read.
        path = self.make_image(".jpg")
        photo = self._rated_photo(path, SIDECAR, rating=1)
        client = APIClient()
        client.force_authenticate(user=photo.owner)

        with patch("api.metadata.jobs.enqueue_task", run_now):
            response = client.patch(
                f"/api/photos/{photo.pk}/metadata/", {"rating": 5}, format="json"
            )

        self.assertEqual(200, response.status_code, response.content)
        self.assertEqual(5, self._read_rating(path))
        self.assertWritesLanded(expected=1)
        self.assertEqual(self.sidecar_of(path), self.exiftool.writes[0].target)

    def test_a_photo_patch_rating_reaches_the_sidecar(self):
        # #2295: PATCH /api/photos/{id}/ wrote the rating through the
        # Photo.save() default, which no longer writes; it goes through the
        # edit service like every other rating change.
        path = self.make_image(".jpg")
        photo = self._rated_photo(path, SIDECAR, rating=1)
        client = APIClient()
        client.force_authenticate(user=photo.owner)

        with patch("api.metadata.jobs.enqueue_task", run_now):
            response = client.patch(
                f"/api/photos/{photo.pk}/", {"rating": 5}, format="json"
            )

        self.assertEqual(200, response.status_code, response.content)
        self.assertEqual(5, response.data["rating"])
        self.assertEqual(5, self._read_rating(path))
        self.assertWritesLanded(expected=1)
        self.assertEqual(self.sidecar_of(path), self.exiftool.writes[0].target)

    def test_a_photo_patch_rating_out_of_range_is_refused(self):
        path = self.make_image(".jpg")
        photo = self._rated_photo(path, SIDECAR, rating=1)
        client = APIClient()
        client.force_authenticate(user=photo.owner)

        with self.assertUntouched(path):
            response = client.patch(
                f"/api/photos/{photo.pk}/", {"rating": 7}, format="json"
            )

        self.assertEqual(400, response.status_code, response.content)
        self.assertEqual(1, Photo.objects.get(pk=photo.pk).rating)


class DateRoundTripTest(RealExifToolTestCase):
    """A date edit (``PhotoEditSerializer``) read back by rule 16."""

    def _edit_date(self, path, mode):
        user = create_test_user(save_metadata_to_disk=mode)
        photo = self.photo_for(path, user)
        # The write waits for the commit (#2298).
        with self.captureOnCommitCallbacks(execute=True):
            PhotoEditSerializer().update(photo, {"exif_timestamp": TIMESTAMP})
        return photo

    def _date_the_scan_reads(self, photo):
        # A fresh row with no user timestamp, so rule 14 ("Timestamp set by
        # user") passes and rule 16 has to find the date in the file.
        fresh = Photo.objects.get(pk=photo.pk)
        fresh.timestamp = None
        extract_date_time(fresh, commit=False)
        return fresh.exif_timestamp

    def _round_trip(self, path, mode):
        photo = self._edit_date(path, mode)

        self.assertEqual(TIMESTAMP, self._date_the_scan_reads(photo))
        self.assertWritesLanded()
        targets = {write.target for write in self.exiftool.writes}
        self.assertEqual({self.sidecar_of(path) if mode == SIDECAR else path}, targets)

    def test_image_formats(self):
        for extension in IMAGE_FORMATS:
            for mode in MODES:
                with self.subTest(extension=extension, mode=mode):
                    self.exiftool.writes.clear()
                    self._round_trip(self.make_image(extension, f"d-{mode}"), mode)

    def test_video(self):
        for mode in MODES:
            with self.subTest(mode=mode):
                self.exiftool.writes.clear()
                self._round_trip(self.make_video(f"d-{mode}"), mode)

    def test_the_camera_date_survives(self):
        path = self.make_image(".jpg")
        self.tag(path, "-EXIF:DateTimeOriginal=2005:01:02 03:04:05")

        self._edit_date(path, MEDIA_FILE)

        self.assertEqual(
            "2005:01:02 03:04:05",
            self.read_tags(path, Tags.DATE_TIME_ORIGINAL)[Tags.DATE_TIME_ORIGINAL],
        )

    # #2298: Photo.save() diffed against the row as first loaded, so the
    # serializer's save and extract_date_time's save both wrote the date.
    def test_one_edit_is_one_write(self):
        self._edit_date(self.make_image(".jpg"), SIDECAR)

        self.assertWritesLanded(expected=1)

    def test_one_api_edit_is_one_write(self):
        path = self.make_image(".jpg")
        photo = self.photo_for(path, create_test_user(save_metadata_to_disk=SIDECAR))
        client = APIClient()
        client.force_authenticate(user=photo.owner)

        with self.captureOnCommitCallbacks(execute=True):
            response = client.patch(
                f"/api/photos/edit/{photo.image_hash}/",
                {"exif_timestamp": TIMESTAMP.isoformat()},
                format="json",
            )

        self.assertEqual(200, response.status_code, response.content)
        self.assertWritesLanded(expected=1)
        self.assertEqual(TIMESTAMP, self._date_the_scan_reads(photo))

    def test_a_later_save_without_changes_writes_nothing(self):
        photo = self._edit_date(self.make_image(".jpg"), SIDECAR)
        self.exiftool.writes.clear()

        with self.captureOnCommitCallbacks(execute=True):
            photo.save()

        self.assertEqual([], self.exiftool.writes)

    def test_the_same_date_again_writes_nothing(self):
        # set_capture_time writes only a date that changed, as the diff in
        # Photo.save() did before it moved there (#2336).
        photo = self._edit_date(self.make_image(".jpg"), SIDECAR)
        self.exiftool.writes.clear()

        with self.captureOnCommitCallbacks(execute=True):
            PhotoEditSerializer().update(photo, {"exif_timestamp": TIMESTAMP})

        self.assertEqual([], self.exiftool.writes)

    def test_the_date_is_written_after_the_commit(self):
        path = self.make_image(".jpg")
        user = create_test_user(save_metadata_to_disk=SIDECAR)
        photo = self.photo_for(path, user)

        with self.captureOnCommitCallbacks() as callbacks:
            with self.assertUntouched(path):
                PhotoEditSerializer().update(photo, {"exif_timestamp": TIMESTAMP})

        self.assertTrue(callbacks)
        for callback in callbacks:
            callback()
        self.assertWritesLanded(expected=1)
        self.assertEqual(TIMESTAMP, self._date_the_scan_reads(photo))

    def test_a_rolled_back_edit_leaves_the_file_alone(self):
        path = self.make_image(".jpg")
        user = create_test_user(save_metadata_to_disk=MEDIA_FILE)
        photo = self.photo_for(path, user)

        with self.assertUntouched(path), self.captureOnCommitCallbacks(execute=True):
            with self.assertRaises(RuntimeError), transaction.atomic():
                PhotoEditSerializer().update(photo, {"exif_timestamp": TIMESTAMP})
                raise RuntimeError("the request fails after the save")

        self.assertIsNone(Photo.objects.get(pk=photo.pk).timestamp)

    def test_nothing_is_written_when_off(self):
        path = self.make_image(".jpg")
        with self.assertUntouched(path):
            self._edit_date(path, OFF)


# Face box in the big thumbnail (display space), pixels: top, right, bottom,
# left. Off-centre and not square, so a wrong transform cannot map it onto
# itself.
FACE_LANDSCAPE = (10, 40, 30, 16)  # in the 96 x 64 thumbnail of an upright photo
FACE_PORTRAIT = (20, 50, 44, 30)  # in the 64 x 96 thumbnail of an Orientation=6 photo


class FaceTagRoundTripTest(RealExifToolTestCase):
    """``write_photo_metadata(..., ["face_tags"])`` read back by ``extract_from_exif``."""

    def _face_photo(self, path, mode, box, name="Alice"):
        user = create_test_user(save_metadata_to_disk=mode, save_face_tags_to_disk=True)
        photo = self.photo_for(path, user, thumbnails=True)
        person = create_test_person(
            name=name, kind=Person.KIND_USER, cluster_owner=user
        )
        top, right, bottom, left = box
        create_test_face(
            photo=photo,
            person=person,
            location_top=top,
            location_right=right,
            location_bottom=bottom,
            location_left=left,
        )
        return photo

    def _faces_read_back(self, photo):
        return extract_from_exif(
            photo.main_file.path, photo.thumbnail.thumbnail_big.path
        )

    def _round_trip(self, path, mode, box):
        photo = self._face_photo(path, mode, box)

        write_photo_metadata(
            photo, use_sidecar=mode == SIDECAR, metadata_types=["face_tags"]
        )

        self.assertWritesLanded(expected=1)
        faces = self._faces_read_back(photo)
        self.assertEqual(1, len(faces), faces)
        *read_box, name = faces[0]
        self.assertEqual("Alice", name)
        for read, written in zip(read_box, box):
            self.assertAlmostEqual(read, written, delta=1)
        return photo

    def test_upright_jpeg(self):
        for mode in MODES:
            with self.subTest(mode=mode):
                self.exiftool.writes.clear()
                self._round_trip(
                    self.make_image(".jpg", f"f-{mode}"), mode, FACE_LANDSCAPE
                )

    def test_upright_heic(self):
        for mode in MODES:
            with self.subTest(mode=mode):
                self.exiftool.writes.clear()
                self._round_trip(
                    self.make_image(".heic", f"f-{mode}"), mode, FACE_LANDSCAPE
                )

    def _portrait_round_trip(self, mode):
        path = self.make_image(".jpg")
        self.tag(path, "-EXIF:Orientation#=6")
        photo = self._round_trip(path, mode, FACE_PORTRAIT)

        # Written in the stored image's coordinates: display (x', y') of an
        # Orientation=6 photo is stored (y', 1 - x'), width and height swapped.
        top, right, bottom, left = FACE_PORTRAIT
        thumbnail = load(photo.thumbnail.thumbnail_big.path)
        width, height = thumbnail.width, thumbnail.height
        x, y = (left + right) / 2 / width, (top + bottom) / 2 / height
        w, h = (right - left) / width, (bottom - top) / height
        target = self.exiftool.writes[0].target
        region = self.read_tags(target, Tags.REGION_INFO)[Tags.REGION_INFO]
        area = region["RegionList"][0]["Area"]
        for key, expected in (("X", y), ("Y", 1 - x), ("W", h), ("H", w)):
            self.assertAlmostEqual(expected, area[key], places=2, msg=key)

    # #2292: the write fetches the orientation as the number 6 and compares it
    # with ExifTool's display strings, so the region is written in display
    # coordinates and read back somewhere else.
    @unittest.expectedFailure
    def test_portrait_jpeg_into_the_sidecar(self):
        self._portrait_round_trip(SIDECAR)

    @unittest.expectedFailure  # #2292, as above
    def test_portrait_jpeg_into_the_media_file(self):
        self._portrait_round_trip(MEDIA_FILE)

    def _keywords_survive(self, mode):
        path = self.make_image(".jpg")
        self.tag(path, "-XMP-dc:Subject=Holiday", "-XMP-dc:Subject=Beach")
        photo = self._face_photo(path, mode, FACE_LANDSCAPE)

        write_photo_metadata(
            photo, use_sidecar=mode == SIDECAR, metadata_types=["face_tags"]
        )

        (subject,) = get_metadata(path, tags=[Tags.SUBJECT], try_sidecar=True)
        keywords = subject if isinstance(subject, list) else [subject]
        self.assertCountEqual(["Holiday", "Beach", "Alice"], keywords)

    # #2291: the person names are assigned to XMP:Subject, replacing the
    # photo's keywords (in the file, or in the sidecar the scan reads instead).
    @unittest.expectedFailure
    def test_keywords_survive_in_the_sidecar(self):
        self._keywords_survive(SIDECAR)

    @unittest.expectedFailure  # #2291, as above
    def test_keywords_survive_in_the_media_file(self):
        self._keywords_survive(MEDIA_FILE)

    def _label_face(self, photo):
        client = APIClient()
        client.force_authenticate(user=photo.owner)
        face = photo.faces.get()
        response = client.post(
            "/api/labelfaces",
            {"face_ids": [face.id], "person_name": "Bob"},
            format="json",
        )
        self.assertEqual(200, response.status_code, response.content)

    def _draw_face(self, photo):
        client = APIClient()
        client.force_authenticate(user=photo.owner)
        # Clear of FACE_LANDSCAPE, in the bottom right of the thumbnail.
        box = {"top": 0.45, "right": 0.95, "bottom": 0.95, "left": 0.55}
        with patch(
            "api.faces.photo_faces.get_face_encodings", return_value=[[0.0] * 512]
        ):
            response = client.post(
                "/api/addface",
                {"photo": photo.image_hash, "person_name": "Carol", "box": box},
                format="json",
            )
        self.assertEqual(201, response.status_code, response.content)

    @contextmanager
    def _original_untouched(self, path):
        with open(path, "rb") as handle:
            before = handle.read()
        yield
        with open(path, "rb") as handle:
            self.assertEqual(before, handle.read(), f"{path} was rewritten")

    def test_labelling_writes_the_face_tags(self):
        path = self.make_image(".jpg")
        photo = self._face_photo(path, SIDECAR, FACE_LANDSCAPE)

        with self._original_untouched(path):
            self._label_face(photo)

        self.assertWritesLanded(expected=1)
        self.assertEqual(self.sidecar_of(path), self.exiftool.writes[0].target)
        self.assertEqual(["Bob"], [face[4] for face in self._faces_read_back(photo)])

    def test_drawing_a_face_writes_the_face_tags(self):
        path = self.make_image(".jpg")
        photo = self._face_photo(path, SIDECAR, FACE_LANDSCAPE)

        with self._original_untouched(path):
            self._draw_face(photo)

        self.assertWritesLanded(expected=1)
        self.assertEqual(self.sidecar_of(path), self.exiftool.writes[0].target)
        self.assertCountEqual(
            ["Alice", "Carol"], [face[4] for face in self._faces_read_back(photo)]
        )

    def test_nothing_is_written_with_the_face_tag_switch_off(self):
        path = self.make_image(".jpg")
        photo = self._face_photo(path, MEDIA_FILE, FACE_LANDSCAPE)
        User.objects.filter(pk=photo.owner.pk).update(save_face_tags_to_disk=False)
        photo.owner.refresh_from_db()

        with self.assertUntouched(path):
            self._label_face(photo)

    # #2293: the face-tag write used to derive "sidecar" from the mode and
    # wrote the original whenever the mode was not SIDECAR_FILE, Off included.
    def test_nothing_is_written_when_off(self):
        path = self.make_image(".jpg")
        photo = self._face_photo(path, OFF, FACE_LANDSCAPE)

        with self.assertUntouched(path):
            self._label_face(photo)

    def test_drawing_a_face_writes_nothing_when_off(self):
        path = self.make_image(".jpg")
        photo = self._face_photo(path, OFF, FACE_LANDSCAPE)

        with self.assertUntouched(path):
            self._draw_face(photo)

    def _save_metadata_request(self, photo):
        client = APIClient()
        client.force_authenticate(user=photo.owner)
        return client.post(
            "/api/savemetadata", {"types": ["ratings", "face_tags"]}, format="json"
        )

    def test_save_metadata_endpoint_writes_the_sidecar(self):
        path = self.make_image(".jpg")
        photo = self._face_photo(path, SIDECAR, FACE_LANDSCAPE)

        with self._original_untouched(path):
            response = self._save_metadata_request(photo)

        self.assertEqual(200, response.status_code, response.content)
        self.assertWritesLanded(expected=1)
        self.assertEqual(self.sidecar_of(path), self.exiftool.writes[0].target)
        self.assertEqual(["Alice"], [face[4] for face in self._faces_read_back(photo)])

    def test_save_metadata_endpoint_refuses_when_off(self):
        path = self.make_image(".jpg")
        photo = self._face_photo(path, OFF, FACE_LANDSCAPE)

        with self.assertUntouched(path):
            response = self._save_metadata_request(photo)

        self.assertEqual(400, response.status_code, response.content)


class ScanReadsOnlyTest(RealExifToolTestCase):
    """A scan reads the file and its sidecar; it never writes either (#2295).

    The file carries a rating the database does not have yet, as after the
    user rated the photo in another app. Writing it back would rewrite the
    original (media-file mode) or create a sidecar that from then on hides
    the original's rating (sidecar mode).
    """

    def _rated_elsewhere(self, mode):
        path = self.make_image(".jpg", f"scan-{mode}")
        self.tag(path, "-XMP-xmp:Rating=4")
        user = create_test_user(save_metadata_to_disk=mode)
        return self.photo_for(path, user, thumbnails=True, rating=0), path

    def test_extracting_the_exif_data_writes_nothing(self):
        for mode in MODES:
            with self.subTest(mode=mode):
                photo, path = self._rated_elsewhere(mode)

                with self.assertUntouched(path):
                    extract_exif_data(photo, commit=True)

                self.assertEqual(4, Photo.objects.get(pk=photo.pk).rating)

    def test_processing_a_scanned_photo_writes_nothing(self):
        for mode in MODES:
            with self.subTest(mode=mode):
                photo, path = self._rated_elsewhere(mode)

                with self.assertUntouched(path):
                    _process_photo(photo, path, "job", datetime.datetime.now())

                self.assertEqual(4, Photo.objects.get(pk=photo.pk).rating)


# The web app's clockwise button sends -90 (``rotate_photo`` counts its angle
# counter-clockwise as rendered).
CLOCKWISE = -90
UPRIGHT = ("landscape", "red", "green", "blue", "white")
TURNED_CLOCKWISE = ("portrait", "blue", "red", "white", "green")
TURNED_HALF = ("landscape", "white", "blue", "green", "red")


class RotationRoundTripTest(RealExifToolTestCase):
    """``rotate_photo``: LibrePhotos' thumbnail against a viewer's render of the result.

    A viewer applies the sidecar's Orientation when there is one, the file's
    own EXIF Orientation otherwise; ``shown_layout`` renders that with libvips'
    ``autorot()``.
    """

    def _rotated_photo(self, extension, mode, orientation=None):
        path = self.make_image(extension)
        if orientation is not None:
            self.tag(path, f"-EXIF:Orientation#={orientation}")
        user = create_test_user(save_metadata_to_disk=mode)
        photo = self.photo_for(path, user, thumbnails=True)
        return photo, path

    def _thumbnail(self, photo):
        return layout(load(photo.thumbnail.thumbnail_big.path))

    def _viewer_sees(self, path):
        orientation = None
        sidecar = self.sidecar_of(path)
        if os.path.exists(sidecar):
            orientation = self.read_tags(sidecar, "XMP:Orientation")["XMP:Orientation"]
        if orientation is None:
            orientation = self.read_tags(path, Tags.ORIENTATION)[Tags.ORIENTATION]
        return shown_layout(path, orientation or 1)

    def test_jpeg_media_file_folds_the_rotation_into_the_file(self):
        for start, before, after in (
            (None, UPRIGHT, TURNED_CLOCKWISE),
            (6, TURNED_CLOCKWISE, TURNED_HALF),
        ):
            with self.subTest(orientation=start):
                self.exiftool.writes.clear()
                photo, path = self._rotated_photo(".jpg", MEDIA_FILE, start)
                self.assertEqual(before, self._thumbnail(photo))

                rotate_photo(photo, CLOCKWISE)

                self.assertEqual(after, self._thumbnail(photo))
                self.assertEqual(after, self._viewer_sees(path))
                self.assertEqual(1, photo.local_orientation)
                self.assertWritesLanded(expected=1)

    def _sidecar_round_trip(self, extension, orientation=None):
        photo, path = self._rotated_photo(extension, SIDECAR, orientation)
        with open(path, "rb") as handle:
            original = handle.read()

        rotate_photo(photo, CLOCKWISE)

        expected = TURNED_CLOCKWISE if orientation is None else TURNED_HALF
        self.assertEqual(expected, self._thumbnail(photo))
        with open(path, "rb") as handle:
            self.assertEqual(original, handle.read(), "the original was rewritten")
        self.assertWritesLanded(expected=1)
        self.assertEqual(expected, self._viewer_sees(path))

    # #2297: the sidecar write is EXIF:Orientation, which ExifTool cannot store
    # in an .xmp; nothing is written.
    @unittest.expectedFailure
    def test_jpeg_sidecar(self):
        self._sidecar_round_trip(".jpg")

    @unittest.expectedFailure  # #2297, as above
    def test_portrait_jpeg_sidecar(self):
        self._sidecar_round_trip(".jpg", orientation=6)

    @unittest.expectedFailure  # #2297, as above
    def test_heic_sidecar(self):
        self._sidecar_round_trip(".heic")

    # #2297: a HEIC original gets EXIF:Orientation composed from the API angle
    # (the opposite turn) on a base the scan never fills in. The fix keeps the
    # rotation in the database and leaves the original alone.
    @unittest.expectedFailure
    def test_heic_media_file_keeps_the_original(self):
        photo, path = self._rotated_photo(".heic", MEDIA_FILE)
        with open(path, "rb") as handle:
            original = handle.read()

        rotate_photo(photo, CLOCKWISE)

        self.assertEqual(TURNED_CLOCKWISE, self._thumbnail(photo))
        with open(path, "rb") as handle:
            self.assertEqual(original, handle.read(), "the original was rewritten")

    def test_nothing_is_written_when_off(self):
        for extension in (".jpg", ".heic"):
            with self.subTest(extension=extension):
                self.exiftool.writes.clear()
                photo, path = self._rotated_photo(extension, OFF)

                with self.assertUntouched(path):
                    rotate_photo(photo, CLOCKWISE)

                self.assertEqual(TURNED_CLOCKWISE, self._thumbnail(photo))


# Every function that calls write_metadata, and the tests above that run it
# against real ExifTool. A new write path fails the guard until it has a
# round-trip test here.
EXERCISED_WRITERS = {
    "api.metadata.photo_writer.write_photo_metadata": (
        "RatingRoundTripTest, DateRoundTripTest, FaceTagRoundTripTest"
    ),
    "api.metadata.photo_writer._write_orientation": "RotationRoundTripTest",
    "api.metadata.photo_writer._fold_rotation_into_file": "RotationRoundTripTest",
}

BACKEND = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))


def _write_metadata_callers():
    """``module.function`` of every call to ``write_metadata`` outside the tests."""
    callers = set()
    api = os.path.join(BACKEND, "api")
    for directory, subdirectories, files in os.walk(api):
        subdirectories[:] = [
            d for d in subdirectories if d not in ("tests", "migrations")
        ]
        for name in files:
            if not name.endswith(".py"):
                continue
            path = os.path.join(directory, name)
            module = os.path.relpath(path, BACKEND)[:-3].replace(os.sep, ".")
            with open(path, encoding="utf-8") as handle:
                tree = ast.parse(handle.read(), path)
            for function in ast.walk(tree):
                if not isinstance(function, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    continue
                for node in ast.walk(function):
                    if (
                        isinstance(node, ast.Call)
                        and _called_name(node) == "write_metadata"
                    ):
                        callers.add(f"{module}.{function.name}")
    return callers


def _called_name(call):
    if isinstance(call.func, ast.Name):
        return call.func.id
    if isinstance(call.func, ast.Attribute):
        return call.func.attr
    return None


class WriteTargetGuardTest(RealExifToolTestCase):
    """Every tag a write path emits must end up in the file it was aimed at.

    ExifTool reports a tag it cannot store in the target (``EXIF:Orientation``
    in an ``.xmp``) only on stdout, so such a write passed every mocked test
    (``write_metadata`` raises on it since #2294). ``RecordingExifTool`` reads each written target
    back; this class runs every write path once and fails on any write that
    did not land.
    """

    def test_every_write_metadata_caller_has_a_round_trip_test(self):
        self.assertEqual(
            set(EXERCISED_WRITERS),
            _write_metadata_callers(),
            "a function that calls write_metadata changed: add a real ExifTool "
            "round-trip test for it to this module and list it in EXERCISED_WRITERS",
        )

    def test_every_tag_the_write_paths_emit_lands(self):
        for mode in MODES:
            with self.subTest(mode=mode):
                user = create_test_user(
                    save_metadata_to_disk=mode, save_face_tags_to_disk=True
                )
                path = self.make_image(".jpg", f"guard-{mode}")
                photo = self.photo_for(path, user, thumbnails=True, rating=3)
                write_photo_ratings([photo.id], use_sidecar=mode == SIDECAR)
                with self.captureOnCommitCallbacks(execute=True):
                    PhotoEditSerializer().update(photo, {"exif_timestamp": TIMESTAMP})
                person = create_test_person(
                    name="Alice", kind=Person.KIND_USER, cluster_owner=user
                )
                create_test_face(
                    photo=photo,
                    person=person,
                    location_top=10,
                    location_right=40,
                    location_bottom=30,
                    location_left=16,
                )
                write_photo_metadata(
                    photo, use_sidecar=mode == SIDECAR, metadata_types=["face_tags"]
                )
        # Rotation into the media file; into a sidecar it is #2297 (see
        # RotationRoundTripTest.test_jpeg_sidecar).
        user = create_test_user(save_metadata_to_disk=MEDIA_FILE)
        for extension in (".jpg", ".heic"):
            path = self.make_image(extension, "guard-rotate")
            rotate_photo(self.photo_for(path, user, thumbnails=True), CLOCKWISE)

        self.assertWritesLanded()
        emitted = set().union(*(write.tags for write in self.exiftool.writes))
        self.assertLessEqual(
            {
                Tags.RATING,
                Tags.DATE_CREATED,
                Tags.REGION_INFO_WRITE,
                Tags.SUBJECT,
                Tags.ORIENTATION,
            },
            emitted,
        )

    def test_the_guard_fails_a_tag_exiftool_leaves_unchanged(self):
        path = self.make_image(".jpg")

        # No sidecar yet: ExifTool has nothing it can write and creates none.
        with self.assertRaises(MetadataWriteError):
            write_metadata(path, {Tags.ORIENTATION: 6}, use_sidecar=True)
        # An existing sidecar: "1 image files unchanged".
        write_metadata(path, {Tags.RATING: 2}, use_sidecar=True)
        with self.assertRaises(MetadataWriteError):
            write_metadata(path, {Tags.ORIENTATION: 6}, use_sidecar=True)

        first, rating, second = self.exiftool.writes
        self.assertEqual([], rating.problems)
        for record in (first, second):
            self.assertTrue(record.problems, record)
        self.assertIn(f"{Tags.ORIENTATION} is not in", second.problems[-1])
