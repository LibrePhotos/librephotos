"""The "Write metadata to files" job and ``/api/savemetadata/`` (#2287).

The writers are mocked here; ``LibraryWriteRoundTripTest`` in
``test_write_back_round_trip.py`` runs the job against real ExifTool.
"""

import datetime
from unittest import mock

from django.test import TestCase
from rest_framework.test import APIClient

from api.metadata import library_write
from api.metadata.library_write import (
    WRITE_TYPES,
    WriteType,
    count_photos_to_write,
    photos_to_write,
    types_written_for,
    write_library_metadata,
    write_metadata_batch,
    write_photos,
)
from api.metadata.writer import MetadataWriteError
from api.models import LongRunningJob, User
from api.models.photo import LocationSource
from api.tests.utils import (
    api_error,
    create_test_face,
    create_test_file,
    create_test_job,
    create_test_photo,
    create_test_tag,
    create_test_user,
)

URL = "/api/savemetadata/"
SIDECAR = User.SaveMetadata.SIDECAR_FILE
MEDIA_FILE = User.SaveMetadata.MEDIA_FILE
OFF = User.SaveMetadata.OFF
EVERY_TYPE = list(WRITE_TYPES)
WITHOUT_FACES = [name for name in WRITE_TYPES if name != "face_tags"]
DATE = datetime.datetime(2011, 11, 11, 11, 11, tzinfo=datetime.timezone.utc)


def _run_now(func, *args, **kwargs):
    """``enqueue_task`` that runs the batch at once, as a worker would."""
    func(*args, **kwargs)


class MockWriters:
    """Every type's writer replaced by a mock, which records ``(type, photo)``."""

    def __init__(self, fail=None):
        self.calls = []
        self.fail = fail or {}

    def __enter__(self):
        writers = {
            name: WriteType(spec.carries_value, self._writer(name))
            for name, spec in WRITE_TYPES.items()
        }
        self._patch = mock.patch.dict(library_write.WRITE_TYPES, writers)
        self._patch.__enter__()
        return self

    def __exit__(self, *exc):
        return self._patch.__exit__(*exc)

    def _writer(self, name):
        def write(photo, use_sidecar):
            self.calls.append((name, photo.pk, use_sidecar))
            error = self.fail.get((name, photo.pk))
            if error is not None:
                raise error

        return write


class SelectionTest(TestCase):
    """Only a value that says something is written."""

    def setUp(self):
        self.user = create_test_user(save_metadata_to_disk=SIDECAR)

    def photo(self, **fields):
        return create_test_photo(owner=self.user, **fields)

    def selected(self, name):
        return set(photos_to_write(self.user, [name]).values_list("pk", flat=True))

    def test_ratings_above_zero(self):
        rated = self.photo(rating=3)
        self.photo(rating=0)
        self.assertEqual({rated.pk}, self.selected("ratings"))

    def test_dates_set_by_hand(self):
        dated = self.photo(timestamp=DATE, exif_timestamp=DATE)
        self.photo(exif_timestamp=DATE)
        self.assertEqual({dated.pk}, self.selected("dates"))

    def test_turned_photos(self):
        turned = self.photo(local_orientation=6)
        self.photo(local_orientation=1)
        self.assertEqual({turned.pk}, self.selected("rotations"))

    def test_captions_the_user_wrote(self):
        captioned = self.photo(captions_json={"user_caption": "At the lake"})
        self.photo(captions_json={"user_caption": ""})
        self.photo(captions_json={"im2txt": "a lake"})
        self.photo()
        self.assertEqual({captioned.pk}, self.selected("captions"))

    def test_positions_the_user_set(self):
        placed = self.photo(
            exif_gps_lat=1.5, exif_gps_lon=2.5, location_source=LocationSource.USER
        )
        self.photo(
            exif_gps_lat=1.5, exif_gps_lon=2.5, location_source=LocationSource.FILE
        )
        self.photo(location_source=LocationSource.USER)
        self.assertEqual({placed.pk}, self.selected("locations"))

    def test_tagged_photos_once(self):
        tagged = self.photo()
        for name in ("lake", "summer"):
            create_test_tag(self.user, name).photos.add(tagged)
        self.photo()
        self.assertEqual({tagged.pk}, self.selected("keywords"))
        self.assertEqual(1, photos_to_write(self.user, ["keywords"]).count())

    def test_photos_with_live_faces_named_or_not(self):
        faced = self.photo()
        create_test_face(photo=faced)
        create_test_face(photo=faced)
        deleted = self.photo()
        create_test_face(photo=deleted, deleted=True)
        self.assertEqual({faced.pk}, self.selected("face_tags"))

    def test_only_the_users_own_present_photos(self):
        create_test_photo(owner=create_test_user(), rating=5)
        self.photo(rating=5, removed=True)
        missing = create_test_file(None, self.user)
        missing.missing = True
        missing.save()
        self.photo(rating=5, main_file=missing)
        self.assertEqual(set(), self.selected("ratings"))

    def test_any_of_the_types(self):
        rated = self.photo(rating=2)
        dated = self.photo(timestamp=DATE)
        self.photo()
        self.assertEqual(
            {rated.pk, dated.pk},
            set(photos_to_write(self.user, EVERY_TYPE).values_list("pk", flat=True)),
        )

    def test_counts_per_type(self):
        self.photo(rating=2, timestamp=DATE)
        self.photo(rating=4)
        counts = count_photos_to_write(self.user, ["ratings", "dates", "captions"])
        self.assertEqual({"ratings": 2, "dates": 1, "captions": 0}, counts)


class TypesWrittenForTest(TestCase):
    def test_none_while_off(self):
        self.assertEqual([], types_written_for(create_test_user()))

    def test_face_tags_need_their_switch(self):
        self.assertEqual(
            WITHOUT_FACES,
            types_written_for(create_test_user(save_metadata_to_disk=MEDIA_FILE)),
        )
        user = create_test_user(
            save_metadata_to_disk=SIDECAR, save_face_tags_to_disk=True
        )
        self.assertEqual(EVERY_TYPE, types_written_for(user))


class WritePhotosTest(TestCase):
    def setUp(self):
        self.user = create_test_user(save_metadata_to_disk=SIDECAR)

    def test_each_photo_gets_the_types_it_carries(self):
        rated = create_test_photo(owner=self.user, rating=4)
        both = create_test_photo(owner=self.user, rating=1, timestamp=DATE)
        plain = create_test_photo(owner=self.user)

        with MockWriters() as writers:
            outcome = write_photos(
                self.user, [rated.pk, both.pk, plain.pk], ["ratings", "dates"], True
            )

        self.assertEqual(
            sorted(
                [
                    ("ratings", rated.pk, True),
                    ("ratings", both.pk, True),
                    ("dates", both.pk, True),
                ]
            ),
            sorted(writers.calls),
        )
        self.assertEqual((2, 1, []), (outcome.written, outcome.skipped, outcome.errors))

    def test_a_failed_write_is_one_failed_photo(self):
        photo = create_test_photo(owner=self.user, rating=4, timestamp=DATE)
        failures = {
            ("ratings", photo.pk): MetadataWriteError("x", "the file is read-only"),
            ("dates", photo.pk): RuntimeError("boom"),
        }

        with MockWriters(fail=failures):
            outcome = write_photos(self.user, [photo.pk], ["ratings", "dates"], False)

        self.assertEqual(0, outcome.written)
        self.assertEqual(
            [
                f"{photo.main_file.path}: ratings: the file is read-only; "
                "dates: could not be written"
            ],
            outcome.errors,
        )

    def test_a_nextcloud_copy_is_skipped(self):
        photo = create_test_photo(owner=self.user, rating=4)

        with (
            MockWriters() as writers,
            mock.patch.object(library_write, "keeps_edits", return_value=False),
        ):
            outcome = write_photos(self.user, [photo.pk], ["ratings"], True)

        self.assertEqual([], writers.calls)
        self.assertEqual((0, 1), (outcome.written, outcome.skipped))

    def test_another_users_photo_is_never_written(self):
        other = create_test_photo(owner=create_test_user(), rating=4)

        with MockWriters() as writers:
            outcome = write_photos(self.user, [other.pk], ["ratings"], True)

        self.assertEqual([], writers.calls)
        self.assertEqual((0, 0), (outcome.written, outcome.skipped))

    def test_one_exiftool_process_for_the_batch(self):
        photos = [create_test_photo(owner=self.user, rating=3) for _ in range(3)]

        with (
            MockWriters(),
            mock.patch.object(library_write, "one_exiftool_process") as process,
        ):
            write_photos(self.user, [photo.pk for photo in photos], ["ratings"], True)

        process.assert_called_once_with()


class WriteLibraryMetadataJobTest(TestCase):
    def setUp(self):
        self.user = create_test_user(save_metadata_to_disk=MEDIA_FILE)

    def run_job(self, types=("ratings",), user=None):
        user = user or self.user
        job = create_test_job(user, LongRunningJob.JOB_WRITE_METADATA)
        with mock.patch.object(library_write, "enqueue_task", side_effect=_run_now):
            write_library_metadata(user, list(types), job_id=job.job_id)
        job.refresh_from_db()
        return job

    def test_counts_and_progress(self):
        rated = create_test_photo(owner=self.user, rating=5)
        failing = create_test_photo(owner=self.user, rating=2)
        create_test_photo(owner=self.user)
        failures = {("ratings", failing.pk): MetadataWriteError("x", "read-only")}

        with MockWriters(fail=failures) as writers:
            job = self.run_job()

        self.assertEqual(
            {("ratings", rated.pk, False), ("ratings", failing.pk, False)},
            set(writers.calls),
        )
        self.assertTrue(job.finished)
        self.assertEqual((2, 2), (job.progress_current, job.progress_target))
        self.assertEqual(1, job.result["written"])
        self.assertEqual(0, job.result["skipped"])
        self.assertEqual(1, job.result["error_count"])
        self.assertEqual(["ratings"], job.result["types"])
        self.assertEqual(
            [f"{failing.main_file.path}: ratings: read-only"], job.result["errors"]
        )

    def test_the_photos_go_in_batches(self):
        for _ in range(3):
            create_test_photo(owner=self.user, rating=1)

        with (
            MockWriters(),
            mock.patch.object(library_write, "BATCH_SIZE", 2),
            mock.patch.object(
                library_write, "enqueue_task", side_effect=_run_now
            ) as enqueue,
        ):
            job = create_test_job(self.user, LongRunningJob.JOB_WRITE_METADATA)
            write_library_metadata(self.user, ["ratings"], job_id=job.job_id)

        self.assertEqual(2, enqueue.call_count)
        job.refresh_from_db()
        self.assertTrue(job.finished)
        self.assertEqual(3, job.result["written"])

    def test_nothing_to_write_completes_at_once(self):
        create_test_photo(owner=self.user)

        with MockWriters() as writers:
            job = self.run_job()

        self.assertEqual([], writers.calls)
        self.assertTrue(job.finished)
        self.assertFalse(job.failed)
        self.assertEqual(0, job.progress_target)

    def test_turned_off_before_it_ran_fails(self):
        create_test_photo(owner=self.user, rating=3)
        User.objects.filter(pk=self.user.pk).update(save_metadata_to_disk=OFF)
        self.user.refresh_from_db()

        with MockWriters() as writers:
            job = self.run_job()

        self.assertEqual([], writers.calls)
        self.assertTrue(job.failed)

    def test_a_cancelled_job_queues_no_more_batches(self):
        for _ in range(3):
            create_test_photo(owner=self.user, rating=1)
        job = create_test_job(self.user, LongRunningJob.JOB_WRITE_METADATA)

        def cancel_after_first(func, *args, **kwargs):
            func(*args, **kwargs)
            LongRunningJob.objects.get(pk=job.pk).cancel()

        with (
            MockWriters() as writers,
            mock.patch.object(library_write, "BATCH_SIZE", 1),
            mock.patch.object(
                library_write, "enqueue_task", side_effect=cancel_after_first
            ) as enqueue,
        ):
            write_library_metadata(self.user, ["ratings"], job_id=job.job_id)

        self.assertEqual(1, enqueue.call_count)
        self.assertEqual(1, len(writers.calls))
        job.refresh_from_db()
        self.assertTrue(job.cancelled)

    def test_a_job_cancelled_before_it_ran_does_nothing(self):
        create_test_photo(owner=self.user, rating=1)
        job = create_test_job(self.user, LongRunningJob.JOB_WRITE_METADATA)
        job.cancel()

        with mock.patch.object(library_write, "enqueue_task") as enqueue:
            write_library_metadata(self.user, ["ratings"], job_id=job.job_id)

        enqueue.assert_not_called()

    def test_a_failure_while_queuing_fails_the_job(self):
        create_test_photo(owner=self.user, rating=1)
        job = create_test_job(self.user, LongRunningJob.JOB_WRITE_METADATA)

        with mock.patch.object(
            library_write, "enqueue_task", side_effect=RuntimeError("broker down")
        ):
            write_library_metadata(self.user, ["ratings"], job_id=job.job_id)

        job.refresh_from_db()
        self.assertTrue(job.failed)
        self.assertEqual("broker down", job.result["error"])


class WriteMetadataBatchTest(TestCase):
    def setUp(self):
        self.user = create_test_user(save_metadata_to_disk=SIDECAR)
        self.photo = create_test_photo(owner=self.user, rating=3)
        self.job = create_test_job(
            self.user, LongRunningJob.JOB_WRITE_METADATA, progress_target=1
        )

    def run_batch(self, use_sidecar=True):
        with MockWriters() as writers:
            write_metadata_batch(
                self.user.pk, [self.photo.pk], ["ratings"], use_sidecar, self.job.job_id
            )
        self.job.refresh_from_db()
        return writers.calls

    def test_a_batch_of_a_cancelled_job_does_nothing(self):
        self.job.cancel()
        self.assertEqual([], self.run_batch())

    def test_a_changed_setting_skips_the_batch(self):
        for mode in (OFF, MEDIA_FILE):
            with self.subTest(mode=mode):
                self.job = create_test_job(
                    self.user, LongRunningJob.JOB_WRITE_METADATA, progress_target=1
                )
                User.objects.filter(pk=self.user.pk).update(save_metadata_to_disk=mode)
                self.assertEqual([], self.run_batch())
                self.assertEqual(1, self.job.result["skipped"])
                self.assertTrue(self.job.finished)

    def test_a_deleted_user_skips_the_batch(self):
        user_id = self.user.pk
        with MockWriters() as writers:
            write_metadata_batch(
                user_id + 1000, [self.photo.pk], ["ratings"], True, self.job.job_id
            )
        self.assertEqual([], writers.calls)


class SaveMetadataViewTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user(save_metadata_to_disk=SIDECAR)
        self.client.force_authenticate(user=self.user)

    def set_user(self, **fields):
        User.objects.filter(pk=self.user.pk).update(**fields)
        self.user.refresh_from_db()

    def post(self, body=None):
        with (
            mock.patch("api.jobs.queue.AsyncTask") as async_task,
            self.captureOnCommitCallbacks(execute=True),
        ):
            response = self.client.post(URL, body or {}, format="json")
        self.async_task = async_task
        return response

    def test_starts_the_job_with_every_type_the_settings_write(self):
        response = self.post()

        self.assertEqual(202, response.status_code, response.content)
        body = response.json()
        self.assertEqual(WITHOUT_FACES, body["types"])
        job = LongRunningJob.objects.get(job_id=body["job_id"])
        self.assertEqual(LongRunningJob.JOB_WRITE_METADATA, job.job_type)
        self.assertEqual(self.user, job.started_by)
        self.assertEqual(
            (write_library_metadata, self.user, WITHOUT_FACES),
            self.async_task.call_args.args,
        )
        self.assertEqual(body["job_id"], self.async_task.call_args.kwargs["job_id"])

    def test_given_types_in_the_jobs_order(self):
        response = self.post({"types": ["dates", "ratings", "dates"]})

        self.assertEqual(202, response.status_code, response.content)
        self.assertEqual(["ratings", "dates"], response.json()["types"])

    def test_unknown_types_are_a_400(self):
        response = self.post({"types": ["ratings", "titles"]})

        self.assertEqual(400, response.status_code)
        self.assertEqual("types", api_error(response)["field"])
        self.async_task.assert_not_called()
        self.assertFalse(LongRunningJob.objects.exists())

    def test_an_empty_list_is_a_400(self):
        response = self.post({"types": []})
        self.assertEqual(400, response.status_code)

    def test_face_tags_need_their_switch(self):
        response = self.post({"types": ["face_tags"]})

        self.assertEqual(400, response.status_code)
        self.assertEqual("face_tags_off", api_error(response)["code"])

        self.set_user(save_face_tags_to_disk=True)
        self.assertEqual(202, self.post({"types": ["face_tags"]}).status_code)

    def test_off_is_a_400(self):
        self.set_user(save_metadata_to_disk=OFF)

        response = self.post()

        self.assertEqual(400, response.status_code)
        self.assertEqual("write_edits_off", api_error(response)["code"])
        self.assertIn("Write edits to files is Off", api_error(response)["message"])

    def test_a_second_start_while_one_runs_is_a_409(self):
        first = self.post()
        second = self.post()

        self.assertEqual(409, second.status_code)
        self.assertEqual("job_already_running", api_error(second)["code"])
        self.assertEqual(first.json()["job_id"], api_error(second)["job_id"])

    def test_the_preview_counts_what_would_be_written(self):
        create_test_photo(owner=self.user, rating=2, timestamp=DATE)
        create_test_photo(owner=self.user, rating=4)
        create_test_photo(owner=self.user)
        create_test_photo(owner=create_test_user(), rating=5)

        response = self.client.get(URL)

        self.assertEqual(200, response.status_code, response.content)
        body = response.json()
        self.assertEqual("sidecar", body["target"])
        self.assertEqual(2, body["total"])
        counts = {item["type"]: item["photos"] for item in body["counts"]}
        self.assertEqual(WITHOUT_FACES, list(counts))
        self.assertEqual(2, counts["ratings"])
        self.assertEqual(1, counts["dates"])

    def test_the_preview_while_off_or_in_media_file_mode(self):
        create_test_photo(owner=self.user, rating=2)
        self.set_user(save_metadata_to_disk=OFF)
        self.assertEqual(
            {"target": None, "counts": [], "total": 0}, self.client.get(URL).json()
        )

        self.set_user(save_metadata_to_disk=MEDIA_FILE)
        self.assertEqual("media_file", self.client.get(URL).json()["target"])
