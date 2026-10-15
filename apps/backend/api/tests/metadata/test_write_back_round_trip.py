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
from contextlib import contextmanager
from unittest.mock import patch

from django.db import transaction
from rest_framework.test import APIClient

from api.directory_watcher.file_handlers import _process_photo
from api.faces import extractor as face_extractor
from api.faces.extractor import extract_from_exif
from api.faces.photo_faces import extract_faces
from api.geocode.photo_location import geolocate_photo
from api.metadata import edits
from api.metadata.jobs import (
    queue_rating_write,
    write_photo_keywords,
    write_photo_ratings,
)
from api.metadata.library_write import types_written_for, write_library_metadata
from api.metadata.photo_datetime import extract_date_time
from api.metadata.photo_reader import extract_exif_data, read_file_values
from api.metadata.photo_writer import rotate_photo, write_photo_metadata
from api.metadata.reader import existing_sidecars, get_metadata
from api.metadata.tags import Tags
from api.metadata.writer import MetadataWriteError, write_metadata
from api.models import LongRunningJob
from api.models.face import Face
from api.models.person import Person
from api.models.photo import LocationSource, Photo
from api.models.photo_caption import PhotoCaption
from api.models.photo_metadata import description_of
from api.models.tag import Tag
from api.models.user import User
from api.serializers.photos import PhotoEditSerializer
from api.tests.metadata.exiftool_harness import (
    RealExifToolTestCase,
    layout,
    load,
    shown_layout,
)
from api.tests.utils import (
    create_test_face,
    create_test_job,
    create_test_person,
    create_test_tag,
    create_test_user,
)

SIDECAR = User.SaveMetadata.SIDECAR_FILE
MEDIA_FILE = User.SaveMetadata.MEDIA_FILE
OFF = User.SaveMetadata.OFF
MODES = (SIDECAR, MEDIA_FILE)

IMAGE_FORMATS = (".jpg", ".png", ".tif", ".heic")

TIMESTAMP = datetime.datetime(2019, 8, 15, 7, 45, 0, tzinfo=datetime.timezone.utc)


def run_now(func, *args):
    """Stand-in for ``enqueue_task`` that runs the job right away."""
    func(*args)


def run_write_metadata_job(user, types):
    """The "Write metadata to files" job (#2287), its batches run at once."""
    job = create_test_job(user, LongRunningJob.JOB_WRITE_METADATA)
    with patch("api.metadata.library_write.enqueue_task", side_effect=run_now):
        write_library_metadata(user, types, job_id=job.job_id)
    job.refresh_from_db()
    return job


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
        # A fresh row with no user timestamp, so the date set by hand does
        # not override the rules and rule 16 has to find it in the file.
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


CAPTION = "Golden Gate at dusk & fog\n\nSecond paragraph"


class CaptionRoundTripTest(RealExifToolTestCase):
    """A caption edit (``edits.set_caption``) read back as the scan reads it (#2289)."""

    def _photo(self, path, mode, **fields):
        return self.photo_for(
            path, create_test_user(save_metadata_to_disk=mode), **fields
        )

    def _caption(self, photo, text):
        with (
            patch("api.metadata.jobs.enqueue_task", run_now),
            self.captureOnCommitCallbacks(execute=True),
        ):
            edits.set_caption(photo, text, photo.owner)

    def _description_the_scan_reads(self, photo):
        return description_of(read_file_values(photo))

    def _round_trip(self, path, mode, **fields):
        photo = self._photo(path, mode, **fields)

        self._caption(photo, CAPTION)

        self.assertEqual(CAPTION, self._description_the_scan_reads(photo))
        self.assertWritesLanded(expected=1)
        target = self.exiftool.writes[0].target
        self.assertEqual(self.sidecar_of(path) if mode == SIDECAR else path, target)
        return photo

    def test_image_formats(self):
        for extension in IMAGE_FORMATS:
            for mode in MODES:
                with self.subTest(extension=extension, mode=mode):
                    self.exiftool.writes.clear()
                    self._round_trip(self.make_image(extension, f"c-{mode}"), mode)

    def test_video(self):
        for mode in MODES:
            with self.subTest(mode=mode):
                self.exiftool.writes.clear()
                self._round_trip(self.make_video(f"c-{mode}"), mode, video=True)

    def test_the_media_file_gets_the_exif_description_too(self):
        path = self.make_image(".jpg")
        self._round_trip(path, MEDIA_FILE)

        found = self.read_tags(path, Tags.IMAGE_DESCRIPTION, Tags.IPTC_CAPTION)
        self.assertEqual(CAPTION, found[Tags.IMAGE_DESCRIPTION])
        # MWG writes IPTC only into a file that has an IPTC block already.
        self.assertIsNone(found[Tags.IPTC_CAPTION])

    def test_an_existing_iptc_caption_follows_the_edit(self):
        path = self.make_image(".jpg")
        self.tag(path, "-IPTC:Caption-Abstract=Old caption")

        self._round_trip(path, MEDIA_FILE)

        self.assertEqual(
            CAPTION, self.read_tags(path, Tags.IPTC_CAPTION)[Tags.IPTC_CAPTION]
        )

    def test_the_sidecar_caption_wins_over_the_embedded_description(self):
        path = self.make_image(".jpg")
        self.tag(path, "-XMP-dc:Description=From the camera")

        with self._original_kept(path):
            self._round_trip(path, SIDECAR)

    def test_clearing_the_caption_removes_the_description(self):
        for mode in MODES:
            with self.subTest(mode=mode):
                self.exiftool.writes.clear()
                path = self.make_image(".jpg", f"clear-{mode}")
                photo = self._round_trip(path, mode)

                self._caption(photo, "")

                self.assertIsNone(self._description_the_scan_reads(photo))
                self.assertWritesLanded(expected=2)

    def test_clearing_without_a_sidecar_creates_none(self):
        path = self.make_image(".jpg")
        photo = self._photo(path, SIDECAR)
        self._caption_silently(photo, "typed before write-back was on")

        with self.assertUntouched(path):
            self._caption(photo, "")

    def _caption_silently(self, photo, text):
        """A caption set while nothing is written."""
        with patch("api.metadata.edits.queue_field_write"):
            edits.set_caption(photo, text, photo.owner)

    def test_a_rescan_keeps_the_caption(self):
        path = self.make_image(".jpg")
        self.tag(path, "-XMP-dc:Description=From the camera")
        photo = self._photo(path, MEDIA_FILE)
        extract_exif_data(photo, commit=True)
        self.assertEqual("From the camera", self._user_caption(photo))

        self._caption(photo, CAPTION)
        extract_exif_data(Photo.objects.get(pk=photo.pk), commit=True)

        self.assertEqual(CAPTION, self._user_caption(photo))

    def test_a_caption_cleared_in_the_sidecar_stays_cleared_after_rescans(self):
        # Clearing removes the sidecar's description, so the file again says
        # what the original says. The rescan must not import that as new.
        path = self.make_image(".jpg")
        self.tag(path, "-XMP-dc:Description=From the camera")
        photo = self._photo(path, SIDECAR)
        extract_exif_data(photo, commit=True)

        self._caption(photo, CAPTION)
        extract_exif_data(Photo.objects.get(pk=photo.pk), commit=True)
        self._caption(photo, "")
        extract_exif_data(Photo.objects.get(pk=photo.pk), commit=True)

        self.assertEqual("", self._user_caption(photo))
        self.assertEqual("From the camera", self._description_the_scan_reads(photo))

    def _user_caption(self, photo):
        return PhotoCaption.objects.get(photo=photo).captions_json["user_caption"]

    def test_the_same_caption_again_writes_nothing(self):
        photo = self._round_trip(self.make_image(".jpg"), SIDECAR)
        self.exiftool.writes.clear()

        self._caption(photo, CAPTION)

        self.assertEqual([], self.exiftool.writes)

    def test_nothing_is_written_when_off(self):
        path = self.make_image(".jpg")
        photo = self._photo(path, OFF)

        with self.assertUntouched(path):
            self._caption(photo, CAPTION)

    def test_a_rolled_back_edit_leaves_the_file_alone(self):
        path = self.make_image(".jpg")
        photo = self._photo(path, MEDIA_FILE)

        with (
            self.assertUntouched(path),
            patch("api.metadata.jobs.enqueue_task", run_now),
            self.captureOnCommitCallbacks(execute=True),
        ):
            with self.assertRaises(RuntimeError), transaction.atomic():
                edits.set_caption(photo, CAPTION, photo.owner)
                raise RuntimeError("the request fails after the save")

    def test_importing_the_file_description_writes_nothing(self):
        # The scan carries the file's description over to the caption
        # through PhotoCaption.apply_user_caption, not the edit service.
        for mode in MODES:
            with self.subTest(mode=mode):
                path = self.make_image(".jpg", f"import-{mode}")
                self.tag(path, "-XMP-dc:Description=From the camera")
                photo = self._photo(path, mode)

                with (
                    self.assertUntouched(path),
                    patch("api.metadata.jobs.enqueue_task", run_now),
                    self.captureOnCommitCallbacks(execute=True),
                ):
                    extract_exif_data(photo, commit=True)

                self.assertEqual("From the camera", self._user_caption(photo))

    def test_the_lightbox_caption_reaches_the_sidecar(self):
        path = self.make_image(".jpg")
        photo = self._photo(path, SIDECAR)
        client = APIClient()
        client.force_authenticate(user=photo.owner)

        with (
            patch("api.metadata.jobs.enqueue_task", run_now),
            self.captureOnCommitCallbacks(execute=True),
        ):
            response = client.post(
                "/api/photosedit/savecaption/",
                {"image_hash": photo.image_hash, "caption": CAPTION},
                format="json",
            )

        self.assertEqual(200, response.status_code, response.content)
        self.assertEqual(CAPTION, self._description_the_scan_reads(photo))
        self.assertWritesLanded(expected=1)

    def test_a_bulk_caption_is_one_job(self):
        user = create_test_user(save_metadata_to_disk=SIDECAR)
        photos = [
            self.photo_for(self.make_image(".jpg", f"bulk-{index}"), user)
            for index in range(2)
        ]
        client = APIClient()
        client.force_authenticate(user=user)

        with (
            patch("api.metadata.jobs.enqueue_task", side_effect=run_now) as queued,
            self.captureOnCommitCallbacks(execute=True),
        ):
            response = client.patch(
                "/api/photos/metadata/bulk/",
                {
                    "photo_ids": [str(photo.pk) for photo in photos],
                    "updates": {"caption": CAPTION},
                },
                format="json",
            )

        self.assertEqual(200, response.status_code, response.content)
        self.assertEqual(1, queued.call_count)
        self.assertWritesLanded(expected=2)
        for photo in photos:
            self.assertEqual(CAPTION, self._description_the_scan_reads(photo))

    @contextmanager
    def _original_kept(self, path):
        with open(path, "rb") as handle:
            before = handle.read()
        yield
        with open(path, "rb") as handle:
            self.assertEqual(before, handle.read(), f"{path} was rewritten")


class KeywordRoundTripTest(RealExifToolTestCase):
    """A tag edit written as the file's keywords and read back as the scan reads them (#2289).

    The photos start from file keywords that a first scan turned into tags,
    and are edited through the tag endpoints, as the lightbox and the bulk
    tag actions do.
    """

    def _photo(self, path, mode, *keywords, user=None, **fields):
        # Its own bytes: two identical fixtures would share one File row.
        self.tag(path, f"-XMP-dc:Source={os.path.basename(path)}")
        if keywords:
            self.tag(path, *(f"-XMP-dc:Subject={keyword}" for keyword in keywords))
        owner = user or create_test_user(save_metadata_to_disk=mode)
        photo = self.photo_for(path, owner, **fields)
        extract_exif_data(photo, commit=True)
        self.exiftool.writes.clear()
        return self._reloaded(photo)

    def _reloaded(self, photo):
        return Photo.objects.select_related("main_file", "owner").get(pk=photo.pk)

    @contextmanager
    def _jobs(self):
        """Run the queued writes right away; yields the ``enqueue_task`` mock."""
        with (
            patch("api.metadata.jobs.enqueue_task", side_effect=run_now) as queued,
            self.captureOnCommitCallbacks(execute=True),
        ):
            yield queued

    def _client(self, user):
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    def _tag_id(self, user, name):
        response = self._client(user).post("/api/tags/", {"name": name}, format="json")
        self.assertIn(response.status_code, (200, 201), response.content)
        return response.json()["id"]

    def _post(self, user, url, body):
        with self._jobs():
            response = self._client(user).post(url, body, format="json")
        self.assertEqual(200, response.status_code, response.content)

    def _add(self, photos, name):
        user = photos[0].owner
        tag_id = self._tag_id(user, name)
        self._post(
            user, f"/api/tags/{tag_id}/add/", {"photos": [str(p.pk) for p in photos]}
        )

    def _remove(self, photo, name):
        tag = Tag.objects.owned_by(photo.owner).get(name=name)
        self._post(
            photo.owner, f"/api/tags/{tag.id}/remove/", {"photos": [str(photo.pk)]}
        )

    def _tags(self, photo):
        return sorted(
            Tag.objects.owned_by(photo.owner)
            .filter(photos=photo)
            .values_list("name", flat=True)
        )

    def _scan_keywords(self, photo):
        """The photo's keywords as the next scan reads them."""
        return extract_exif_data(self._reloaded(photo), commit=False).keywords

    def _rescan(self, photo):
        extract_exif_data(self._reloaded(photo), commit=True)

    def _file_keywords(self, path):
        (subject,) = self.read_tags(path, "XMP-dc:Subject").values()
        if subject is None:
            return []
        values = subject if isinstance(subject, list) else [subject]
        return [str(value) for value in values]

    def _round_trip(self, path, mode, **fields):
        photo = self._photo(path, mode, "Holiday", "Beach", **fields)
        self.assertEqual(["Beach", "Holiday"], self._tags(photo))

        self._add([photo], "Sunset")
        self._remove(photo, "Beach")

        self.assertEqual(["Holiday", "Sunset"], self._scan_keywords(photo))
        self.assertWritesLanded(expected=2)
        target = self.sidecar_of(path) if mode == SIDECAR else path
        self.assertEqual({target}, {write.target for write in self.exiftool.writes})
        self.assertCountEqual(["Holiday", "Sunset"], self._file_keywords(target))
        return photo

    def test_image_formats(self):
        for extension in IMAGE_FORMATS:
            for mode in MODES:
                with self.subTest(extension=extension, mode=mode):
                    self.exiftool.writes.clear()
                    self._round_trip(self.make_image(extension, f"k-{mode}"), mode)

    def test_video(self):
        for mode in MODES:
            with self.subTest(mode=mode):
                self.exiftool.writes.clear()
                self._round_trip(self.make_video(f"k-{mode}"), mode, video=True)

    def test_the_original_is_untouched_in_the_sidecar_mode(self):
        path = self.make_image(".jpg")
        photo = self._photo(path, SIDECAR, "Holiday", "Beach")
        with open(path, "rb") as handle:
            before = handle.read()

        self._add([photo], "Sunset")
        self._remove(photo, "Beach")

        with open(path, "rb") as handle:
            self.assertEqual(before, handle.read(), f"{path} was rewritten")
        self.assertEqual(["Holiday", "Sunset"], self._scan_keywords(photo))

    def test_a_rescan_keeps_the_tags(self):
        for mode in MODES:
            with self.subTest(mode=mode):
                photo = self._round_trip(self.make_image(".jpg", f"re-{mode}"), mode)

                self._rescan(photo)

                self.assertEqual(["Holiday", "Sunset"], self._tags(photo))

    def test_a_removed_keyword_the_file_still_gives_stays_removed(self):
        # A sidecar cannot remove the original's IPTC:Keywords, and no write
        # touches a HierarchicalSubject leaf: the file still gives both.
        path = self.make_image(".jpg")
        self.tag(
            path,
            "-IPTC:Keywords=Sunset",
            "-XMP-lr:HierarchicalSubject=Places|USA|San Francisco",
        )
        photo = self._photo(path, SIDECAR, "Holiday")
        self.assertEqual(["Holiday", "San Francisco", "Sunset"], self._tags(photo))

        self._remove(photo, "Sunset")
        self._remove(photo, "San Francisco")
        self._rescan(photo)
        self._rescan(photo)

        self.assertEqual(["Holiday"], self._tags(photo))
        self.assertEqual(["Holiday"], self._file_keywords(self.sidecar_of(path)))
        self.assertIn("Sunset", self._scan_keywords(photo))

    def test_a_keyword_another_app_adds_becomes_a_tag(self):
        path = self.make_image(".jpg")
        photo = self._round_trip(path, MEDIA_FILE)

        self.tag(path, "-XMP-dc:Subject+=Lighthouse")
        self._rescan(photo)

        self.assertEqual(["Holiday", "Lighthouse", "Sunset"], self._tags(photo))

    def test_while_off_a_rescan_still_adds_a_removed_file_keyword_back(self):
        path = self.make_image(".jpg")
        photo = self._photo(path, OFF, "Holiday", "Beach")

        with self.assertUntouched(path):
            self._remove(photo, "Beach")
        self._rescan(photo)

        self.assertEqual(["Beach", "Holiday"], self._tags(photo))

    def test_an_existing_iptc_block_follows_the_edit(self):
        path = self.make_image(".jpg")
        self.tag(path, "-IPTC:Keywords=Holiday", "-IPTC:Keywords=Beach")

        self._round_trip(path, MEDIA_FILE)

        (iptc,) = self.read_tags(path, Tags.IPTC_KEYWORDS).values()
        self.assertCountEqual(["Holiday", "Sunset"], iptc)

    def test_a_file_without_iptc_gains_none(self):
        path = self.make_image(".jpg")

        self._round_trip(path, MEDIA_FILE)

        self.assertEqual(
            {Tags.IPTC_KEYWORDS: None}, self.read_tags(path, Tags.IPTC_KEYWORDS)
        )

    def test_a_new_sidecar_starts_from_the_photo_keywords(self):
        path = self.make_image(".jpg")
        self.tag(path, "-IPTC:Keywords=Sunset")
        photo = self._photo(path, SIDECAR, "Holiday")

        self._add([photo], "Lighthouse")

        self.assertCountEqual(
            ["Holiday", "Sunset", "Lighthouse"],
            self._file_keywords(self.sidecar_of(path)),
        )
        self.assertEqual(
            ["Holiday", "Lighthouse", "Sunset"], self._scan_keywords(photo)
        )

    def test_keywords_of_an_existing_sidecar_survive(self):
        """A digiKam sidecar's keywords stay, and the media file's are not copied in."""
        path = self.make_image(".jpg")
        self.tag(path, "-XMP-dc:Subject=Original")
        sidecar = path + ".xmp"
        write_metadata(path, {Tags.SUBJECT: ["Holiday", "Beach"]}, use_sidecar=True)
        photo = self._photo(path, SIDECAR)

        self._add([photo], "Sunset")
        self._remove(photo, "Beach")

        self.assertCountEqual(["Holiday", "Sunset"], self._file_keywords(sidecar))
        self.assertEqual(["Original"], self._file_keywords(path))

    def test_removing_the_last_keyword_creates_no_sidecar(self):
        # ExifTool cannot store an empty list; the removal stays in LibrePhotos.
        path = self.make_image(".jpg")
        photo = self._photo(path, SIDECAR, "Holiday")

        with self.assertUntouched(path):
            self._remove(photo, "Holiday")
        self._rescan(photo)

        self.assertEqual([], self._tags(photo))

    def test_a_tag_the_file_already_has_writes_nothing(self):
        path = self.make_image(".jpg")
        photo = self._photo(path, MEDIA_FILE, "Holiday")
        Tag.objects.owned_by(photo.owner).get(name="Holiday").photos.remove(photo)

        with self.assertUntouched(path):
            self._add([photo], "Holiday")

    def test_a_tag_added_twice_is_written_once(self):
        for mode in MODES:
            with self.subTest(mode=mode):
                path = self.make_image(".jpg", f"twice-{mode}")
                photo = self._photo(path, mode, "Holiday")
                target = self.sidecar_of(path) if mode == SIDECAR else path

                self._add([photo], "Sunset")
                self._add([photo], "Sunset")
                write_photo_keywords([photo.id], ["Sunset"], mode == SIDECAR)

                self.assertEqual(["Holiday", "Sunset"], self._file_keywords(target))
                self.assertWritesLanded(expected=1)
                self.exiftool.writes.clear()

    def test_person_names_of_the_face_regions_survive(self):
        for mode in MODES:
            with self.subTest(mode=mode):
                path = self.make_image(".jpg", f"faces-{mode}")
                user = create_test_user(
                    save_metadata_to_disk=mode, save_face_tags_to_disk=True
                )
                photo = self._photo(path, mode, "Holiday", user=user, thumbnails=True)
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
                self._rescan(photo)
                self.assertEqual(["Alice", "Holiday"], self._tags(photo))
                target = self.sidecar_of(path) if mode == SIDECAR else path

                self._add([photo], "Sunset")
                self._remove(photo, "Holiday")
                self._remove(photo, "Alice")

                self.assertCountEqual(["Alice", "Sunset"], self._file_keywords(target))
                self._rescan(photo)
                self.assertEqual(["Sunset"], self._tags(photo))

    def test_people_and_hierarchies_are_not_written_as_keywords(self):
        path = self.make_image(".jpg")
        self.tag(
            path,
            "-XMP-iptcExt:PersonInImage=Bob",
            "-XMP-lr:HierarchicalSubject=Places|Lisbon",
        )
        photo = self._photo(path, MEDIA_FILE, "Holiday")
        self.assertEqual(["Bob", "Holiday", "Lisbon"], self._tags(photo))

        self._add([photo], "Sunset")
        self._remove(photo, "Bob")

        self.assertCountEqual(["Holiday", "Sunset"], self._file_keywords(path))
        found = self.read_tags(path, Tags.PERSON_IN_IMAGE, Tags.HIERARCHICAL_SUBJECT)
        self.assertEqual(["Bob"], found[Tags.PERSON_IN_IMAGE])
        self.assertEqual(["Places|Lisbon"], found[Tags.HIERARCHICAL_SUBJECT])
        self._rescan(photo)
        self.assertEqual(["Holiday", "Lisbon", "Sunset"], self._tags(photo))

    def test_renaming_a_tag_renames_the_keyword(self):
        path = self.make_image(".jpg")
        photo = self._photo(path, MEDIA_FILE, "Holiday", "Beach")
        tag = Tag.objects.owned_by(photo.owner).get(name="Beach")

        with self._jobs():
            response = self._client(photo.owner).patch(
                f"/api/tags/{tag.id}/", {"name": "Seaside"}, format="json"
            )

        self.assertEqual(200, response.status_code, response.content)
        self.assertCountEqual(["Holiday", "Seaside"], self._file_keywords(path))
        self.assertWritesLanded(expected=1)

    def test_deleting_a_tag_removes_the_keyword(self):
        path = self.make_image(".jpg")
        photo = self._photo(path, SIDECAR, "Holiday", "Beach")
        tag = Tag.objects.owned_by(photo.owner).get(name="Beach")

        with self._jobs():
            response = self._client(photo.owner).delete(f"/api/tags/{tag.id}/")

        self.assertEqual(204, response.status_code, response.content)
        self.assertEqual(["Holiday"], self._file_keywords(self.sidecar_of(path)))
        self._rescan(photo)
        self.assertEqual(["Holiday"], self._tags(photo))

    def test_merging_tags_merges_the_keywords(self):
        path = self.make_image(".jpg")
        photo = self._photo(path, MEDIA_FILE, "Holiday", "Vacation")
        target = Tag.objects.owned_by(photo.owner).get(name="Holiday")
        source = Tag.objects.owned_by(photo.owner).get(name="Vacation")

        self._post(photo.owner, f"/api/tags/{target.id}/merge/", {"tag": source.id})

        self.assertEqual(["Holiday"], self._file_keywords(path))

    def test_a_bulk_tag_is_one_job(self):
        user = create_test_user(save_metadata_to_disk=SIDECAR)
        photos = [
            self._photo(self.make_image(".jpg", f"bulk-{index}"), SIDECAR, user=user)
            for index in range(2)
        ]
        tag_id = self._tag_id(user, "Sunset")

        with self._jobs() as queued:
            response = self._client(user).post(
                f"/api/tags/{tag_id}/add/",
                {"select_all": True, "query": {}},
                format="json",
            )

        self.assertEqual(200, response.status_code, response.content)
        self.assertEqual(1, queued.call_count)
        self.assertWritesLanded(expected=2)
        for photo in photos:
            self.assertEqual(["Sunset"], self._scan_keywords(photo))

    def test_a_metadata_api_keyword_edit_is_one_job(self):
        user = create_test_user(save_metadata_to_disk=MEDIA_FILE)
        paths = [self.make_image(".jpg", f"api-{index}") for index in range(2)]
        photos = [self._photo(path, MEDIA_FILE, "Holiday", user=user) for path in paths]

        with self._jobs() as queued:
            response = self._client(user).patch(
                "/api/photos/metadata/bulk/",
                {
                    "photo_ids": [str(photo.pk) for photo in photos],
                    "updates": {"keywords": ["Sunset"]},
                },
                format="json",
            )

        self.assertEqual(200, response.status_code, response.content)
        self.assertEqual(1, queued.call_count)
        for path in paths:
            self.assertEqual(["Sunset"], self._file_keywords(path))

    def test_writes_that_run_out_of_order_leave_the_latest_tags(self):
        path = self.make_image(".jpg")
        photo = self._photo(path, MEDIA_FILE, "Holiday")
        queued = []
        with (
            patch("api.metadata.jobs.enqueue_task", lambda *job: queued.append(job)),
            self.captureOnCommitCallbacks(execute=True),
        ):
            tag_id = self._tag_id(photo.owner, "Sunset")
            client = self._client(photo.owner)
            body = {"photos": [str(photo.pk)]}
            client.post(f"/api/tags/{tag_id}/add/", body, format="json")
            client.post(f"/api/tags/{tag_id}/remove/", body, format="json")
            client.post(f"/api/tags/{tag_id}/add/", body, format="json")
        self.assertEqual(3, len(queued))

        for job in reversed(queued):
            run_now(*job)

        self.assertCountEqual(["Holiday", "Sunset"], self._file_keywords(path))

    def test_nothing_is_written_when_off(self):
        path = self.make_image(".jpg")
        photo = self._photo(path, OFF, "Holiday")

        with self.assertUntouched(path):
            self._add([photo], "Sunset")
            self._remove(photo, "Holiday")
            edits.set_keywords(photo, ["Beach"], photo.owner)

    def test_a_rolled_back_edit_leaves_the_file_alone(self):
        path = self.make_image(".jpg")
        photo = self._photo(path, MEDIA_FILE, "Holiday")

        with self.assertUntouched(path), self._jobs():
            with self.assertRaises(RuntimeError), transaction.atomic():
                edits.set_keywords(photo, ["Sunset"], photo.owner)
                raise RuntimeError("the request fails after the save")

    def test_the_scan_writes_nothing(self):
        for mode in MODES:
            with self.subTest(mode=mode):
                path = self.make_image(".jpg", f"scan-{mode}")
                self.tag(path, "-XMP-dc:Subject=Holiday")
                photo = self.photo_for(
                    path, create_test_user(save_metadata_to_disk=mode)
                )

                with self.assertUntouched(path), self._jobs():
                    extract_exif_data(photo, commit=True)

                self.assertEqual(["Holiday"], self._tags(photo))


# South and west, so a lost sign shows.
LATITUDE, LONGITUDE = -33.856784, -70.5


class LocationRoundTripTest(RealExifToolTestCase):
    """A location edit (``edits.set_location``) read back as the scan reads it (#2290)."""

    def setUp(self):
        super().setUp()
        # No geocoder here; its failure must not stop the write anyway.
        geocoder = patch("api.metadata.edits.reverse_geocode", return_value=None)
        geocoder.start()
        self.addCleanup(geocoder.stop)

    def _photo(self, path, mode, **fields):
        return self.photo_for(
            path, create_test_user(save_metadata_to_disk=mode), **fields
        )

    def _locate(self, photo, latitude=LATITUDE, longitude=LONGITUDE):
        with (
            patch("api.metadata.jobs.enqueue_task", run_now),
            self.captureOnCommitCallbacks(execute=True),
        ):
            edits.set_location(photo, latitude, longitude, photo.owner)

    def _position_the_scan_reads(self, photo):
        values = read_file_values(photo)
        return values["gps_latitude"], values["gps_longitude"]

    def assertPosition(self, photo, latitude=LATITUDE, longitude=LONGITUDE):
        read_latitude, read_longitude = self._position_the_scan_reads(photo)
        self.assertAlmostEqual(latitude, read_latitude, places=6)
        self.assertAlmostEqual(longitude, read_longitude, places=6)

    def _round_trip(self, path, mode, **fields):
        photo = self._photo(path, mode, **fields)

        self._locate(photo)

        self.assertPosition(photo)
        self.assertWritesLanded(expected=1)
        target = self.exiftool.writes[0].target
        self.assertEqual(self.sidecar_of(path) if mode == SIDECAR else path, target)
        return photo

    def test_image_formats(self):
        for extension in IMAGE_FORMATS:
            for mode in MODES:
                with self.subTest(extension=extension, mode=mode):
                    self.exiftool.writes.clear()
                    self._round_trip(self.make_image(extension, f"l-{mode}"), mode)

    def test_video(self):
        for mode in MODES:
            with self.subTest(mode=mode):
                self.exiftool.writes.clear()
                self._round_trip(self.make_video(f"l-{mode}"), mode, video=True)

    def test_every_hemisphere(self):
        for latitude, longitude in ((48.858844, 2.294351), (-0.5, 0.25), (1.5, -170)):
            with self.subTest(latitude=latitude, longitude=longitude):
                photo = self._photo(self.make_image(".jpg", "h"), MEDIA_FILE)
                self._locate(photo, latitude, longitude)
                self.assertPosition(photo, latitude, longitude)

    def test_the_sidecar_position_wins_over_the_embedded_one(self):
        path = self.make_image(".jpg")
        self.tag(
            path,
            "-GPS:GPSLatitude=10",
            "-GPS:GPSLatitudeRef=N",
            "-GPS:GPSLongitude=20",
            "-GPS:GPSLongitudeRef=E",
            "-GPS:GPSAltitude=120",
        )

        with self.assertOriginalKept(path):
            self._round_trip(path, SIDECAR)

    def test_the_media_file_loses_the_old_altitude(self):
        path = self.make_image(".jpg")
        self.tag(path, "-GPS:GPSAltitude=120", "-GPS:GPSAltitudeRef=0")

        self._round_trip(path, MEDIA_FILE)

        self.assertIsNone(
            self.read_tags(path, Tags.GPS_ALTITUDE_EXIF)[Tags.GPS_ALTITUDE_EXIF]
        )

    def test_a_video_loses_its_older_position(self):
        path = self.make_video()
        self.tag(path, "-UserData:GPSCoordinates=10 20")

        self._round_trip(path, MEDIA_FILE, video=True)

        found = self.read_tags(path, Tags.GPS_COORDINATES_USER_DATA)
        self.assertIsNone(found[Tags.GPS_COORDINATES_USER_DATA])

    def test_removing_the_location_removes_the_tags(self):
        for mode in MODES:
            with self.subTest(mode=mode):
                self.exiftool.writes.clear()
                path = self.make_image(".jpg", f"clear-{mode}")
                photo = self._round_trip(path, mode)

                self._locate(photo, None, None)

                self.assertEqual((None, None), self._position_the_scan_reads(photo))
                self.assertWritesLanded(expected=2)

    def test_removing_a_video_location(self):
        path = self.make_video()
        photo = self._round_trip(path, MEDIA_FILE, video=True)

        self._locate(photo, None, None)

        self.assertEqual((None, None), self._position_the_scan_reads(photo))

    def test_removing_without_a_sidecar_creates_none(self):
        path = self.make_image(".jpg")
        photo = self._photo(path, SIDECAR, exif_gps_lat=10.0, exif_gps_lon=20.0)

        with self.assertUntouched(path):
            self._locate(photo, None, None)

    def test_a_geocoder_failure_does_not_stop_the_write(self):
        path = self.make_image(".jpg")
        photo = self._photo(path, MEDIA_FILE)

        with patch(
            "api.metadata.edits.reverse_geocode", side_effect=RuntimeError("down")
        ):
            self._locate(photo)

        self.assertPosition(photo)

    def test_the_same_position_again_writes_nothing(self):
        photo = self._round_trip(self.make_image(".jpg"), SIDECAR)
        self.exiftool.writes.clear()

        self._locate(Photo.objects.get(pk=photo.pk))

        self.assertEqual([], self.exiftool.writes)

    def test_nothing_is_written_when_off(self):
        path = self.make_image(".jpg")
        photo = self._photo(path, OFF)

        with self.assertUntouched(path):
            self._locate(photo)

    def test_the_geolocation_job_writes_nothing(self):
        # "Add geolocation" looks up the place of the stored position; the
        # position is not an edit.
        for mode in MODES:
            with self.subTest(mode=mode):
                path = self.make_image(".jpg", f"geo-{mode}")
                photo = self._photo(
                    path, mode, exif_gps_lat=LATITUDE, exif_gps_lon=LONGITUDE
                )

                with (
                    self.assertUntouched(path),
                    patch(
                        "api.geocode.photo_location._reverse_geocode_safely",
                        return_value={"features": [], "_v": 1},
                    ),
                    patch("api.metadata.jobs.enqueue_task", run_now),
                    self.captureOnCommitCallbacks(execute=True),
                ):
                    geolocate_photo(photo)

    def test_the_picker_reaches_the_media_file(self):
        path = self.make_image(".jpg")
        photo = self._photo(path, MEDIA_FILE)
        client = APIClient()
        client.force_authenticate(user=photo.owner)

        with (
            patch("api.metadata.jobs.enqueue_task", run_now),
            self.captureOnCommitCallbacks(execute=True),
        ):
            response = client.patch(
                f"/api/photos/edit/{photo.image_hash}/",
                {"exif_gps_lat": LATITUDE, "exif_gps_lon": LONGITUDE},
                format="json",
            )

        self.assertEqual(200, response.status_code, response.content)
        self.assertWritesLanded(expected=1)
        self.assertPosition(photo)

    @contextmanager
    def assertOriginalKept(self, path):
        with open(path, "rb") as handle:
            before = handle.read()
        yield
        with open(path, "rb") as handle:
            self.assertEqual(before, handle.read(), f"{path} was rewritten")


class BulkDateRoundTripTest(RealExifToolTestCase):
    """A bulk shift (``POST /api/photosedit/datetime/``, #2278): one queued
    ``write_photo_fields`` job writes every shifted date, read back by rule 16."""

    HOUR = datetime.timedelta(hours=1)

    def _shift(self, mode, paths):
        user = create_test_user(save_metadata_to_disk=mode)
        photos = [
            self.photo_for(path, user, exif_timestamp=TIMESTAMP) for path in paths
        ]
        client = APIClient()
        client.force_authenticate(user=user)
        with (
            patch("api.metadata.jobs.enqueue_task", run_now),
            self.captureOnCommitCallbacks(execute=True),
        ):
            response = client.post(
                "/api/photosedit/datetime/",
                {
                    "image_hashes": [photo.image_hash for photo in photos],
                    "mode": "shift",
                    "seconds": -3600,
                },
                format="json",
            )
        self.assertEqual(200, response.status_code, response.content)
        return photos

    def _date_the_scan_reads(self, photo):
        fresh = Photo.objects.get(pk=photo.pk)
        fresh.timestamp = None
        extract_date_time(fresh, commit=False)
        return fresh.exif_timestamp

    def test_every_shifted_date_reaches_its_target(self):
        for mode in MODES:
            with self.subTest(mode=mode):
                self.exiftool.writes.clear()
                # Two formats: two copies of one image would be one File row.
                paths = [
                    self.make_image(ext, f"bulk-{mode}") for ext in (".jpg", ".png")
                ]

                photos = self._shift(mode, paths)

                for photo in photos:
                    self.assertEqual(
                        TIMESTAMP - self.HOUR, self._date_the_scan_reads(photo)
                    )
                self.assertWritesLanded(expected=2)
                expected = {self.sidecar_of(p) if mode == SIDECAR else p for p in paths}
                self.assertEqual(
                    expected, {write.target for write in self.exiftool.writes}
                )

    def test_the_sidecar_says_the_shifted_time(self):
        path = self.make_image(".jpg")

        self._shift(SIDECAR, [path])

        created = self.read_tags(self.sidecar_of(path), Tags.DATE_CREATED)
        self.assertIn("2019:08:15 06:45:00", str(created[Tags.DATE_CREATED]))

    def test_nothing_is_written_when_off(self):
        path = self.make_image(".jpg")
        with self.assertUntouched(path):
            self._shift(OFF, [path])


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

    # #2292: the write fetched the orientation as the number 6 and compared it
    # with ExifTool's display strings, so the region was written in display
    # coordinates and read back somewhere else.
    def test_portrait_jpeg_into_the_sidecar(self):
        self._portrait_round_trip(SIDECAR)

    def test_portrait_jpeg_into_the_media_file(self):
        self._portrait_round_trip(MEDIA_FILE)

    def test_every_rotated_orientation_reads_back_the_same_box(self):
        # The portrait tests above pin where 6 is written; libvips pins the
        # transforms themselves (test_face_region_orientation).
        for orientation in (5, 7, 8):
            with self.subTest(orientation=orientation):
                self.exiftool.writes.clear()
                path = self.make_image(".jpg", f"o{orientation}")
                self.tag(path, f"-EXIF:Orientation#={orientation}")
                self._round_trip(path, MEDIA_FILE, FACE_PORTRAIT)

    def _scan_keywords(self, photo):
        """The photo's keywords as the next scan reads them."""
        return extract_exif_data(photo, commit=False).keywords

    def _file_keywords(self, path):
        (subject,) = self.read_tags(path, "XMP-dc:Subject").values()
        if subject is None:
            return []
        return subject if isinstance(subject, list) else [subject]

    def _keywords_survive(self, mode):
        path = self.make_image(".jpg")
        self.tag(path, "-XMP-dc:Subject=Holiday", "-XMP-dc:Subject=Beach")
        photo = self._face_photo(path, mode, FACE_LANDSCAPE)
        use_sidecar = mode == SIDECAR
        target = self.sidecar_of(path) if use_sidecar else path

        write_photo_metadata(
            photo, use_sidecar=use_sidecar, metadata_types=["face_tags"]
        )

        (subject,) = get_metadata(path, tags=[Tags.SUBJECT], try_sidecar=True)
        keywords = subject if isinstance(subject, list) else [subject]
        self.assertCountEqual(["Holiday", "Beach", "Alice"], keywords)
        self.assertEqual(["Alice", "Beach", "Holiday"], self._scan_keywords(photo))
        self.assertCountEqual(
            ["Holiday", "Beach", "Alice"], self._file_keywords(target)
        )

        # Relabelled: the previous name goes, the keywords stay.
        self._label_face(photo)
        self.assertCountEqual(["Holiday", "Beach", "Bob"], self._file_keywords(target))

        # Written again: no duplicate.
        write_photo_metadata(
            photo, use_sidecar=use_sidecar, metadata_types=["face_tags"]
        )
        self.assertCountEqual(["Holiday", "Beach", "Bob"], self._file_keywords(target))
        self.assertEqual(["Beach", "Bob", "Holiday"], self._scan_keywords(photo))
        self.assertWritesLanded(expected=3)
        if use_sidecar:
            self.assertCountEqual(["Holiday", "Beach"], self._file_keywords(path))

    # #2291: the person names were assigned to XMP:Subject, replacing the
    # photo's keywords (in the file, or in the sidecar the scan reads instead).
    def test_keywords_survive_in_the_sidecar(self):
        self._keywords_survive(SIDECAR)

    def test_keywords_survive_in_the_media_file(self):
        self._keywords_survive(MEDIA_FILE)

    def test_a_new_sidecar_starts_from_the_iptc_keywords_too(self):
        path = self.make_image(".jpg")
        self.tag(path, "-XMP-dc:Subject=Holiday", "-IPTC:Keywords=Sunset")
        photo = self._face_photo(path, SIDECAR, FACE_LANDSCAPE)

        write_photo_metadata(photo, use_sidecar=True, metadata_types=["face_tags"])

        self.assertCountEqual(
            ["Holiday", "Sunset", "Alice"], self._file_keywords(self.sidecar_of(path))
        )
        self.assertEqual(["Alice", "Holiday", "Sunset"], self._scan_keywords(photo))

    def test_keywords_of_an_existing_sidecar_survive(self):
        """A digiKam sidecar's keywords stay, and the media file's are not copied in."""
        path = self.make_image(".jpg")
        self.tag(path, "-XMP-dc:Subject=Original")
        sidecar = path + ".xmp"
        write_metadata(path, {Tags.SUBJECT: ["Holiday", "Beach"]}, use_sidecar=True)
        self.assertEqual(sidecar, self.sidecar_of(path))
        photo = self._face_photo(path, SIDECAR, FACE_LANDSCAPE)

        write_photo_metadata(photo, use_sidecar=True, metadata_types=["face_tags"])

        self.assertCountEqual(
            ["Holiday", "Beach", "Alice"], self._file_keywords(sidecar)
        )
        self.assertEqual(["Alice", "Beach", "Holiday"], self._scan_keywords(photo))

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

    # #2207: taking a person off a photo from the person page writes the
    # region again, without the name.
    def test_removing_a_photo_from_a_person_writes_the_face_tags(self):
        path = self.make_image(".jpg")
        photo = self._face_photo(path, SIDECAR, FACE_LANDSCAPE)
        write_photo_metadata(photo, use_sidecar=True, metadata_types=["face_tags"])
        person = photo.faces.get().person
        client = APIClient()
        client.force_authenticate(user=photo.owner)

        with self._original_untouched(path):
            response = client.post(
                f"/api/persons/{person.pk}/remove-photos/",
                {"photo_ids": [str(photo.pk)]},
                format="json",
            )

        self.assertEqual(200, response.status_code, response.content)
        self.assertIsNone(response.json()["write_error"])
        self.assertWritesLanded(expected=2)
        names = [face[4] for face in self._faces_read_back(photo)]
        self.assertNotIn("Alice", names)

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

    def test_the_write_metadata_job_writes_the_sidecar(self):
        path = self.make_image(".jpg")
        photo = self._face_photo(path, SIDECAR, FACE_LANDSCAPE)

        with self._original_untouched(path):
            run_write_metadata_job(photo.owner, ["ratings", "face_tags"])

        self.assertWritesLanded(expected=1)
        self.assertEqual(self.sidecar_of(path), self.exiftool.writes[0].target)
        self.assertEqual(["Alice"], [face[4] for face in self._faces_read_back(photo)])

    def test_the_write_metadata_endpoint_refuses_when_off(self):
        path = self.make_image(".jpg")
        photo = self._face_photo(path, OFF, FACE_LANDSCAPE)
        client = APIClient()
        client.force_authenticate(user=photo.owner)

        with self.assertUntouched(path):
            response = client.post(
                "/api/savemetadata", {"types": ["ratings", "face_tags"]}, format="json"
            )

        self.assertEqual(400, response.status_code, response.content)
        # The setting under its name in the UI (#2609, #2670).
        self.assertIn("Write edits to files is Off", response.content.decode())


# A second face in the 96 x 64 thumbnail, clear of FACE_LANDSCAPE.
FACE_SECOND = (34, 90, 58, 60)


class FaceDeleteRoundTripTest(RealExifToolTestCase):
    """Deleting faces takes their regions out of the file or sidecar (#1531).

    The write is queued once per request and reads the faces as they are
    when it runs; ``enqueue_task`` runs it right away here. The next face
    scan reads the file back (``extract_faces``, face service off).
    """

    def _photo(self, path, mode, *faces):
        user = create_test_user(save_metadata_to_disk=mode, save_face_tags_to_disk=True)
        photo = self.photo_for(path, user, thumbnails=True)
        for name, (top, right, bottom, left) in faces:
            person = create_test_person(
                name=name, kind=Person.KIND_USER, cluster_owner=user
            )
            create_test_face(
                photo=photo,
                person=person,
                location_top=top,
                location_right=right,
                location_bottom=bottom,
                location_left=left,
            )
        return photo

    def _written(self, path, mode, *faces):
        """A photo with ``faces`` whose regions are already on disk."""
        photo = self._photo(path, mode, *faces)
        write_photo_metadata(
            photo, use_sidecar=mode == SIDECAR, metadata_types=["face_tags"]
        )
        self.exiftool.writes.clear()
        return photo

    def _alice_and_bob(self, path, mode):
        return self._written(
            path, mode, ("Alice", FACE_LANDSCAPE), ("Bob", FACE_SECOND)
        )

    def _post(self, photo, url, names):
        client = APIClient()
        client.force_authenticate(user=photo.owner)
        ids = list(
            Face.objects.filter(photo=photo, person__name__in=names).values_list(
                "pk", flat=True
            )
        )
        with (
            patch("api.faces.labels.enqueue_task", run_now),
            self.captureOnCommitCallbacks(execute=True),
        ):
            response = client.post(url, {"face_ids": ids}, format="json")
        self.assertEqual(200, response.status_code, response.content)

    def _delete(self, photo, *names):
        self._post(photo, "/api/deletefaces/", names)

    def _restore(self, photo, *names):
        self._post(photo, "/api/restore-faces/", names)

    def _names_read_back(self, photo):
        faces = extract_from_exif(
            photo.main_file.path, photo.thumbnail.thumbnail_big.path
        )
        return sorted(face[4] for face in faces or [])

    def _target(self, path, mode):
        return self.sidecar_of(path) if mode == SIDECAR else path

    def _file_keywords(self, path):
        (subject,) = self.read_tags(path, "XMP-dc:Subject").values()
        if subject is None:
            return []
        return subject if isinstance(subject, list) else [subject]

    def _rescan(self, photo):
        with (
            patch("api.faces.photo_faces.feature_enabled", return_value=True),
            patch.object(face_extractor, "extract_from_face_service", return_value=[]),
        ):
            extract_faces(Photo.objects.get(pk=photo.pk))

    def _live_names(self, photo):
        return sorted(
            Face.objects.filter(photo=photo, deleted=False).values_list(
                "person__name", flat=True
            )
        )

    @contextmanager
    def _original_untouched(self, path, mode):
        if mode != SIDECAR:
            yield
            return
        with open(path, "rb") as handle:
            before = handle.read()
        yield
        with open(path, "rb") as handle:
            self.assertEqual(before, handle.read(), f"{path} was rewritten")

    def _delete_one_of_two(self, extension):
        for mode in MODES:
            with self.subTest(mode=mode):
                self.exiftool.writes.clear()
                path = self.make_image(extension, f"two-{mode}")
                photo = self._alice_and_bob(path, mode)

                with self._original_untouched(path, mode):
                    self._delete(photo, "Alice")

                self.assertWritesLanded(expected=1)
                self.assertEqual(["Bob"], self._names_read_back(photo))
                self.assertEqual(["Bob"], self._file_keywords(self._target(path, mode)))
                self._rescan(photo)
                self.assertEqual(["Bob"], self._live_names(photo))
                self.assertEqual(2, Face.objects.filter(photo=photo).count())

    def test_deleting_one_of_two_faces_in_a_jpeg(self):
        self._delete_one_of_two(".jpg")

    def test_deleting_one_of_two_faces_in_a_heic(self):
        self._delete_one_of_two(".heic")

    def _delete_the_last_face(self, extension):
        for mode in MODES:
            with self.subTest(mode=mode):
                path = self.make_image(extension, f"last-{mode}")
                photo = self._written(path, mode, ("Alice", FACE_LANDSCAPE))
                target = self._target(path, mode)

                with self._original_untouched(path, mode):
                    self._delete(photo, "Alice")

                self.assertWritesLanded(expected=1)
                region = self.read_tags(target, Tags.REGION_INFO)[Tags.REGION_INFO]
                # Gone from the media file; an empty Regions in the sidecar.
                self.assertEqual(None if mode == MEDIA_FILE else "", region)
                self.assertEqual([], self._names_read_back(photo))
                self.assertEqual([], self._file_keywords(target))
                self._rescan(photo)
                self.assertEqual([], self._live_names(photo))

    def test_deleting_the_last_face_of_a_jpeg_clears_its_regions(self):
        self._delete_the_last_face(".jpg")

    def test_deleting_the_last_face_of_a_heic_clears_its_regions(self):
        self._delete_the_last_face(".heic")

    def test_regions_another_app_wrote_into_the_original(self):
        """digiKam wrote the regions into the JPEG; the scan imported them."""
        for mode in MODES:
            with self.subTest(mode=mode):
                self.exiftool.writes.clear()
                path = self.make_image(".jpg", f"digikam-{mode}")
                self.tag(
                    path,
                    "-XMP-mwg-rs:RegionInfo={AppliedToDimensions={W=96,H=64,"
                    "Unit=pixel},RegionList=[{Area={X=0.291667,Y=0.3125,"
                    "W=0.25,H=0.3125,Unit=normalized},Name=Alice,Type=Face}]}",
                    "-XMP-dc:Subject=Alice",
                    "-XMP-dc:Subject=Holiday",
                )
                user = create_test_user(
                    save_metadata_to_disk=mode, save_face_tags_to_disk=True
                )
                photo = self.photo_for(path, user, thumbnails=True)
                self._rescan(photo)
                self.assertEqual(["Alice"], self._live_names(photo))

                with self._original_untouched(path, mode):
                    self._delete(photo, "Alice")

                self.assertWritesLanded(expected=1)
                self.assertEqual([], self._names_read_back(photo))
                self._rescan(photo)
                self.assertEqual([], self._live_names(photo))
                keywords = self._file_keywords(self._target(path, mode))
                self.assertEqual(["Holiday"], keywords)

    def test_deleting_then_restoring_writes_the_regions_back(self):
        for mode in MODES:
            with self.subTest(mode=mode):
                self.exiftool.writes.clear()
                path = self.make_image(".jpg", f"restore-{mode}")
                photo = self._alice_and_bob(path, mode)
                target = self._target(path, mode)

                self._delete(photo, "Alice")
                self._restore(photo, "Alice")
                self.assertEqual(["Alice", "Bob"], self._names_read_back(photo))

                self._delete(photo, "Alice", "Bob")
                self.assertEqual([], self._names_read_back(photo))
                self._restore(photo, "Alice", "Bob")

                self.assertWritesLanded(expected=4)
                self.assertEqual(["Alice", "Bob"], self._names_read_back(photo))
                self.assertCountEqual(["Alice", "Bob"], self._file_keywords(target))
                self._rescan(photo)
                self.assertEqual(["Alice", "Bob"], self._live_names(photo))
                self.assertEqual(2, Face.objects.filter(photo=photo).count())

    def test_a_keyword_the_user_added_as_a_tag_stays(self):
        for mode in MODES:
            with self.subTest(mode=mode):
                path = self.make_image(".jpg", f"tagged-{mode}")
                photo = self._alice_and_bob(path, mode)
                create_test_tag(photo.owner, "Alice").photos.add(photo)

                self._delete(photo, "Alice", "Bob")

                self.assertEqual([], self._names_read_back(photo))
                target = self._target(path, mode)
                self.assertEqual(["Alice"], self._file_keywords(target))

    def test_a_photo_without_faces_keeps_the_regions_of_its_file(self):
        path = self.make_image(".jpg")
        self.tag(
            path,
            "-XMP-mwg-rs:RegionInfo={RegionList=[{Area={X=0.3,Y=0.3,W=0.2,"
            "H=0.2,Unit=normalized},Name=Alice,Type=Face}]}",
        )
        photo = self._photo(path, MEDIA_FILE)

        with self.assertUntouched(path):
            write_photo_metadata(photo, use_sidecar=False, metadata_types=["face_tags"])

    def test_a_cleared_photo_is_not_written_again(self):
        path = self.make_image(".jpg")
        photo = self._written(path, SIDECAR, ("Alice", FACE_LANDSCAPE))
        self._delete(photo, "Alice")

        write_photo_metadata(photo, use_sidecar=True, metadata_types=["face_tags"])

        self.assertWritesLanded(expected=1)

    def test_nothing_is_written_when_off(self):
        for mode, face_tags in ((OFF, True), (MEDIA_FILE, False)):
            with self.subTest(mode=mode, face_tags=face_tags):
                path = self.make_image(".jpg", f"off-{mode}-{face_tags}")
                photo = self._photo(path, mode, ("Alice", FACE_LANDSCAPE))
                User.objects.filter(pk=photo.owner.pk).update(
                    save_face_tags_to_disk=face_tags
                )
                photo.owner.refresh_from_db()

                with self.assertUntouched(path):
                    self._delete(photo, "Alice")


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
        path = self.make_image(extension, f"photo-{orientation}")
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

        with self.assertOriginalKept(path):
            rotate_photo(photo, CLOCKWISE)

        expected = TURNED_CLOCKWISE if orientation is None else TURNED_HALF
        self.assertEqual(expected, self._thumbnail(photo))
        self.assertWritesLanded(expected=1)
        self.assertEqual(expected, self._viewer_sees(path))

    @contextmanager
    def assertOriginalKept(self, path):
        with open(path, "rb") as handle:
            original = handle.read()
        yield
        with open(path, "rb") as handle:
            self.assertEqual(original, handle.read(), "the original was rewritten")

    def _sidecar_orientation(self, path):
        sidecar = self.sidecar_of(path)
        return self.read_tags(sidecar, Tags.ORIENTATION_XMP)[Tags.ORIENTATION_XMP]

    def test_jpeg_sidecar(self):
        self._sidecar_round_trip(".jpg")

    def test_portrait_jpeg_sidecar(self):
        self._sidecar_round_trip(".jpg", orientation=6)

    def test_heic_sidecar(self):
        self._sidecar_round_trip(".heic")

    def test_rotations_in_the_sidecar_do_not_pile_up(self):
        """Each rotate writes the original's tag with the whole rotation on top."""
        photo, path = self._rotated_photo(".jpg", SIDECAR, 6)

        with self.assertOriginalKept(path):
            rotate_photo(photo, CLOCKWISE)
            self.assertEqual(3, self._sidecar_orientation(path))
            rotate_photo(photo, CLOCKWISE)
            self.assertEqual(8, self._sidecar_orientation(path))

        self.assertEqual(
            ("portrait", "green", "white", "red", "blue"), self._thumbnail(photo)
        )
        self.assertEqual(self._thumbnail(photo), self._viewer_sees(path))
        self.assertWritesLanded(expected=2)

    def test_every_orientation_turned_either_way_matches_the_thumbnail(self):
        """A viewer applying the sidecar shows what LibrePhotos' thumbnail shows."""
        for start in range(1, 9):
            with self.subTest(orientation=start):
                photo, path = self._rotated_photo(".jpg", SIDECAR, start)
                with self.assertOriginalKept(path):
                    rotate_photo(photo, CLOCKWISE)
                    self.assertEqual(self._thumbnail(photo), self._viewer_sees(path))
                    # Back past the start: one counter-clockwise turn from it.
                    rotate_photo(photo, -CLOCKWISE)
                    rotate_photo(photo, -CLOCKWISE)
                    self.assertEqual(self._thumbnail(photo), self._viewer_sees(path))
                self.assertNotEqual(shown_layout(path, start), self._thumbnail(photo))

    def test_heic_media_file_keeps_the_original(self):
        """#2297: HEIC renders without its EXIF tag (libheif applies ``irot``),
        so the original is not written and the rotation stays in the database."""
        for start in (None, 6):
            with self.subTest(orientation=start):
                photo, path = self._rotated_photo(".heic", MEDIA_FILE, start)
                before = self._thumbnail(photo)

                with self.assertUntouched(path):
                    error = rotate_photo(photo, CLOCKWISE)

                self.assertIsNone(error)
                self.assertEqual(8, photo.local_orientation)
                self.assertEqual(UPRIGHT, before)
                self.assertEqual(TURNED_CLOCKWISE, self._thumbnail(photo))

    def _raw_photo(self, mode):
        """A TIFF ExifTool takes for a DNG shot in portrait. rawpy cannot
        decode it, so it gets no thumbnails."""
        path = self.make_image(".tif", f"raw-{mode}")
        raw = path[: -len(".tif")] + ".dng"
        os.replace(path, raw)
        self.tag(raw, "-EXIF:DNGVersion=1.4.0.0", "-EXIF:Orientation#=6")
        user = create_test_user(save_metadata_to_disk=mode)
        return self.photo_for(raw, user), raw

    @patch("api.thumbnails.render.regenerate_thumbnails")
    def test_raw_media_file_keeps_the_original(self, regenerate):
        photo, path = self._raw_photo(MEDIA_FILE)

        with self.assertUntouched(path):
            error = rotate_photo(photo, CLOCKWISE)

        self.assertIsNone(error)
        self.assertEqual(8, photo.local_orientation)
        self.assertEqual(6, self.read_tags(path, Tags.ORIENTATION)[Tags.ORIENTATION])

    @patch("api.thumbnails.render.regenerate_thumbnails")
    def test_raw_sidecar(self, regenerate):
        photo, path = self._raw_photo(SIDECAR)

        with self.assertOriginalKept(path):
            self.assertIsNone(rotate_photo(photo, CLOCKWISE))

        self.assertEqual(3, self._sidecar_orientation(path))
        self.assertWritesLanded(expected=1)

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
class LibraryWriteRoundTripTest(RealExifToolTestCase):
    """The "Write metadata to files" job (#2287) writes what the library holds.

    Only a photo with a value of a type gets a write, through the writers the
    live edits use.
    """

    def _labelled_face(self, photo):
        person = create_test_person(
            name="Alice", kind=Person.KIND_USER, cluster_owner=photo.owner
        )
        top, right, bottom, left = FACE_LANDSCAPE
        create_test_face(
            photo=photo,
            person=person,
            location_top=top,
            location_right=right,
            location_bottom=bottom,
            location_left=left,
        )

    def _image(self, name):
        """An image of its own: the same pixels would make one File of them all."""
        path = self.make_image(".jpg", name)
        self.tag(path, f"-Comment={name}")
        return path

    def test_only_photos_with_a_value_get_a_sidecar(self):
        user = create_test_user(
            save_metadata_to_disk=SIDECAR, save_face_tags_to_disk=True
        )
        unrated = self._image("unrated")
        self.photo_for(unrated, user, rating=0)
        three = self._image("three")
        self.photo_for(three, user, rating=3)
        five = self._image("five")
        self.photo_for(five, user, rating=5)
        faced = self._image("faced")
        self._labelled_face(self.photo_for(faced, user, thumbnails=True, rating=0))

        job = run_write_metadata_job(user, types_written_for(user))

        self.assertWritesLanded(expected=3)
        self.assertEqual([], existing_sidecars(unrated))
        for path, rating in ((three, 3), (five, 5)):
            self.assertEqual([self.sidecar_of(path)], existing_sidecars(path))
            self.assertEqual(
                [rating], get_metadata(path, tags=[Tags.RATING], try_sidecar=True)
            )
        self.assertEqual([self.sidecar_of(faced)], existing_sidecars(faced))
        faced_photo = Photo.objects.get(main_file__path=faced)
        names = [
            face[4]
            for face in extract_from_exif(
                faced, faced_photo.thumbnail.thumbnail_big.path
            )
        ]
        self.assertEqual(["Alice"], names)
        self.assertEqual((3, 3), (job.progress_current, job.progress_target))
        self.assertEqual(3, job.result["written"])
        self.assertNotIn("error_count", job.result)
        self.assertTrue(job.finished)
        self.assertFalse(job.failed)

    def test_every_type_reaches_the_target(self):
        for mode in MODES:
            with self.subTest(mode=mode):
                self.exiftool.writes.clear()
                user = create_test_user(
                    save_metadata_to_disk=mode, save_face_tags_to_disk=True
                )
                path = self.make_image(".jpg", f"every-{mode}")
                photo = self.photo_for(
                    path,
                    user,
                    thumbnails=True,
                    rating=4,
                    timestamp=TIMESTAMP,
                    captions_json={"user_caption": "At the lake"},
                    exif_gps_lat=48.5,
                    exif_gps_lon=-3.25,
                    location_source=LocationSource.USER,
                    local_orientation=6,
                )
                create_test_tag(user, "lake").photos.add(photo)
                self._labelled_face(photo)

                job = run_write_metadata_job(user, types_written_for(user))

                self.assertWritesLanded(expected=7)
                self.assertEqual(1, job.result["written"])
                values = read_file_values(photo)
                self.assertEqual(4, values["rating"])
                self.assertIn("lake", values["xmp_subject"])
                self.assertEqual("At the lake", description_of(values))
                self.assertAlmostEqual(48.5, values["gps_latitude"], places=5)
                self.assertAlmostEqual(-3.25, values["gps_longitude"], places=5)
                (date_created,) = get_metadata(
                    path, tags=[Tags.DATE_CREATED], try_sidecar=True
                )
                self.assertTrue(str(date_created).startswith("2019:08:15 07:45:00"))


EXERCISED_WRITERS = {
    "api.metadata.photo_writer.write_photo_metadata": (
        "RatingRoundTripTest, DateRoundTripTest, BulkDateRoundTripTest, "
        "FaceTagRoundTripTest"
    ),
    "api.metadata.photo_writer._write_sidecar_orientation": "RotationRoundTripTest",
    "api.metadata.photo_writer._fold_rotation_into_file": "RotationRoundTripTest",
    "api.metadata.photo_writer._write_edit": (
        "CaptionRoundTripTest, LocationRoundTripTest, KeywordRoundTripTest"
    ),
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
        for mode in MODES:
            user = create_test_user(save_metadata_to_disk=mode)
            for extension in (".jpg", ".heic"):
                path = self.make_image(extension, f"guard-rotate-{mode}")
                rotate_photo(self.photo_for(path, user, thumbnails=True), CLOCKWISE)
        self._edit_caption_and_location()

        self.assertWritesLanded()
        emitted = set().union(*(write.tags for write in self.exiftool.writes))
        self.assertLessEqual(
            {
                Tags.RATING,
                Tags.DATE_CREATED,
                Tags.REGION_INFO_WRITE,
                Tags.SUBJECT,
                Tags.ORIENTATION,
                Tags.ORIENTATION_XMP,
                Tags.DESCRIPTION_XMP,
                Tags.DESCRIPTION_MWG,
                Tags.GPS_LATITUDE_XMP,
                Tags.GPS_LATITUDE,
                Tags.GPS_LATITUDE_REF,
                Tags.GPS_COORDINATES_KEYS,
                Tags.KEYWORDS_MWG,
            },
            emitted,
        )

    @patch("api.metadata.edits.reverse_geocode", return_value=None)
    def _edit_caption_and_location(self, geocoder):
        for mode in MODES:
            user = create_test_user(save_metadata_to_disk=mode)
            image = self.photo_for(self.make_image(".jpg", f"guard-edit-{mode}"), user)
            video = self.photo_for(self.make_video(f"guard-{mode}"), user, video=True)
            with (
                patch("api.metadata.jobs.enqueue_task", run_now),
                self.captureOnCommitCallbacks(execute=True),
            ):
                for photo in (image, video):
                    edits.set_caption(photo, CAPTION, user)
                    edits.set_location(photo, LATITUDE, LONGITUDE, user)
                    edits.set_keywords(photo, ["Sunset"], user)

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
