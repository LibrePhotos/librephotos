"""Applying the current date rules to the photos already in the library (#437).

``POST /api/photos/reapply-date-rules/`` and its job read each photo's date
again with the owner's rules as they are now: a date set by hand stays
(#2254), nothing is written to the files, and only the date, the day album
and ``last_modified`` change.
"""

import datetime
import json
from unittest import mock

from django.test import TestCase
from rest_framework.test import APIClient

from api.directory_watcher.utils import update_batch_counter
from api.metadata import date_rules_job
from api.metadata.date_rules_job import (
    reapply_date_rules_batch,
    reapply_date_rules_job,
)
from api.metadata.datetime_rules import RuleTypes
from api.metadata.photo_datetime import reapply_date_rules
from api.metadata.reader import MetadataReadError
from api.metadata.tags import Tags
from api.models import AlbumDate, LongRunningJob, Photo
from api.tests.utils import (
    api_error,
    create_test_album_date,
    create_test_file,
    create_test_job,
    create_test_photo,
    create_test_user,
)

URL = "/api/photos/reapply-date-rules/"

UTC = datetime.UTC
CAMERA_DATE = datetime.datetime(2005, 1, 2, 3, 4, 5, tzinfo=UTC)
OLD_DATE = datetime.datetime(2020, 6, 7, 8, 9, 10, tzinfo=UTC)
MANUAL_DATE = datetime.datetime(2011, 11, 11, 11, 11, tzinfo=UTC)

# The rule list after the change: the camera's EXIF:DateTimeOriginal only.
CAMERA_RULES = [
    {
        "id": 1,
        "name": "Local time from EXIF:DateTimeOriginal",
        "rule_type": RuleTypes.EXIF,
        "exif_tag": Tags.DATE_TIME_ORIGINAL,
    }
]


def _camera_metadata(path, tags, **kwargs):
    """A file whose only date is the camera's EXIF:DateTimeOriginal."""
    return [
        "2005:01:02 03:04:05" if tag == Tags.DATE_TIME_ORIGINAL else None
        for tag in tags
    ]


def _run_now(func, *args, **kwargs):
    """``enqueue_task`` that runs the batch at once, as a worker would."""
    func(*args, **kwargs)


def _day_album_of(photo):
    return AlbumDate.objects.filter(photos=photo).values_list("date", flat=True)


class ReapplyDateRulesJobTest(TestCase):
    def setUp(self):
        self.user = create_test_user(datetime_rules=json.dumps(CAMERA_RULES))
        self.old_album = create_test_album_date(self.user, OLD_DATE.date())

    def photo(self, **fields):
        return create_test_photo(owner=self.user, **fields)

    def run_job(self, user=None, metadata=_camera_metadata):
        user = user or self.user
        job = create_test_job(user, LongRunningJob.JOB_REAPPLY_DATE_RULES)
        with (
            mock.patch.object(date_rules_job, "enqueue_task", side_effect=_run_now),
            mock.patch(
                "api.metadata.photo_datetime.get_metadata", side_effect=metadata
            ) as get_metadata,
            mock.patch("api.metadata.writer.write_metadata") as write_metadata,
            mock.patch("api.metadata.jobs.enqueue_task") as queue_write,
        ):
            reapply_date_rules_job(user, job_id=job.job_id)
        write_metadata.assert_not_called()
        queue_write.assert_not_called()
        job.refresh_from_db()
        self.get_metadata = get_metadata
        return job

    def test_a_photo_moves_to_the_date_the_rules_read_now(self):
        photo = self.photo(exif_timestamp=OLD_DATE)
        self.old_album.photos.add(photo)
        before = Photo.objects.get(pk=photo.pk).last_modified

        job = self.run_job()

        photo = Photo.objects.get(pk=photo.pk)
        self.assertEqual(photo.exif_timestamp, CAMERA_DATE)
        self.assertGreater(photo.last_modified, before)
        self.assertEqual(list(_day_album_of(photo)), [CAMERA_DATE.date()])
        self.assertTrue(job.finished)
        self.assertFalse(job.failed)
        self.assertEqual((job.progress_current, job.progress_target), (1, 1))
        self.assertEqual(job.result, {"moved": 1, "unchanged": 0, "kept_hand_set": 0})

    def test_a_date_set_by_hand_is_never_replaced(self):
        photo = self.photo(timestamp=MANUAL_DATE, exif_timestamp=MANUAL_DATE)
        before = Photo.objects.get(pk=photo.pk).last_modified

        job = self.run_job()

        photo = Photo.objects.get(pk=photo.pk)
        self.assertEqual(photo.exif_timestamp, MANUAL_DATE)
        self.assertEqual(photo.timestamp, MANUAL_DATE)
        self.assertEqual(photo.last_modified, before)
        self.get_metadata.assert_not_called()
        self.assertEqual(job.progress_target, 0)
        self.assertTrue(job.finished)
        self.assertEqual(job.result["kept_hand_set"], 1)

    def test_a_date_set_by_hand_while_the_job_ran_wins(self):
        photo = self.photo(exif_timestamp=OLD_DATE)
        stale = Photo.objects.select_related("owner", "main_file").get(pk=photo.pk)
        Photo.objects.filter(pk=photo.pk).update(
            timestamp=MANUAL_DATE, exif_timestamp=MANUAL_DATE
        )

        with mock.patch(
            "api.metadata.photo_datetime.get_metadata", side_effect=_camera_metadata
        ):
            moved = reapply_date_rules(stale)

        self.assertFalse(moved)
        self.assertEqual(Photo.objects.get(pk=photo.pk).exif_timestamp, MANUAL_DATE)
        self.assertEqual(list(_day_album_of(photo)), [])

    def test_a_photo_whose_date_stays_is_not_saved(self):
        photo = self.photo(exif_timestamp=CAMERA_DATE)
        before = Photo.objects.get(pk=photo.pk).last_modified

        job = self.run_job()

        self.assertEqual(Photo.objects.get(pk=photo.pk).last_modified, before)
        self.assertEqual(job.result, {"moved": 0, "unchanged": 1, "kept_hand_set": 0})

    def test_each_photo_is_read_in_one_request(self):
        for _ in range(3):
            self.photo(exif_timestamp=OLD_DATE)

        self.run_job()

        self.assertEqual(self.get_metadata.call_count, 3)

    def test_only_the_users_own_photos_change(self):
        other = create_test_user(datetime_rules=json.dumps(CAMERA_RULES))
        others = create_test_photo(owner=other, exif_timestamp=OLD_DATE)
        own = self.photo(exif_timestamp=OLD_DATE)

        job = self.run_job()

        self.assertEqual(Photo.objects.get(pk=others.pk).exif_timestamp, OLD_DATE)
        self.assertEqual(Photo.objects.get(pk=own.pk).exif_timestamp, CAMERA_DATE)
        self.assertEqual(job.progress_target, 1)

    def test_photos_without_a_file_are_left_alone(self):
        missing_file = create_test_file(None, self.user, missing=True)
        gone = self.photo(exif_timestamp=OLD_DATE, main_file=missing_file)
        removed = self.photo(exif_timestamp=OLD_DATE, removed=True)

        job = self.run_job()

        self.assertEqual(Photo.objects.get(pk=gone.pk).exif_timestamp, OLD_DATE)
        self.assertEqual(Photo.objects.get(pk=removed.pk).exif_timestamp, OLD_DATE)
        self.assertEqual(job.progress_target, 0)

    def test_the_photos_go_in_batches(self):
        for _ in range(3):
            self.photo(exif_timestamp=OLD_DATE)

        with mock.patch.object(date_rules_job, "BATCH_SIZE", 2):
            job = self.run_job()

        self.assertEqual(self.get_metadata.call_count, 3)
        self.assertEqual((job.progress_current, job.progress_target), (3, 3))
        self.assertTrue(job.finished)
        self.assertEqual(job.result["moved"], 3)

    def test_a_photo_that_cannot_be_read_is_a_failed_item(self):
        broken = self.photo(exif_timestamp=OLD_DATE)
        fine = self.photo(exif_timestamp=OLD_DATE)
        broken_path = broken.main_file.path

        def metadata(path, tags, **kwargs):
            if path == broken_path:
                raise MetadataReadError("exif service down")
            return _camera_metadata(path, tags)

        job = self.run_job(metadata=metadata)

        self.assertEqual(Photo.objects.get(pk=broken.pk).exif_timestamp, OLD_DATE)
        self.assertEqual(Photo.objects.get(pk=fine.pk).exif_timestamp, CAMERA_DATE)
        self.assertTrue(job.finished)
        self.assertEqual(job.result["moved"], 1)
        self.assertEqual(job.result["error_count"], 1)
        self.assertEqual(job.result["status"], "partial_failure")
        self.assertIn(broken.image_hash, job.result["errors"][0])

    def test_an_empty_library_completes_at_once(self):
        job = self.run_job(create_test_user())

        self.assertTrue(job.finished)
        self.assertEqual(job.progress_target, 0)
        self.assertEqual(job.result, {"moved": 0, "unchanged": 0, "kept_hand_set": 0})

    def test_a_cancelled_job_queues_no_more_batches(self):
        for _ in range(3):
            self.photo(exif_timestamp=OLD_DATE)
        job = create_test_job(self.user, LongRunningJob.JOB_REAPPLY_DATE_RULES)

        def cancel_after_first(func, *args, **kwargs):
            func(*args, **kwargs)
            LongRunningJob.objects.get(pk=job.pk).cancel()

        with (
            mock.patch.object(date_rules_job, "BATCH_SIZE", 1),
            mock.patch.object(
                date_rules_job, "enqueue_task", side_effect=cancel_after_first
            ) as enqueue,
            mock.patch(
                "api.metadata.photo_datetime.get_metadata",
                side_effect=_camera_metadata,
            ),
        ):
            reapply_date_rules_job(self.user, job_id=job.job_id)

        self.assertEqual(enqueue.call_count, 1)
        job.refresh_from_db()
        self.assertTrue(job.cancelled)
        self.assertEqual(job.result, {"status": "cancelled"})

    def test_a_batch_of_a_cancelled_job_does_nothing(self):
        photo = self.photo(exif_timestamp=OLD_DATE)
        job = create_test_job(self.user, LongRunningJob.JOB_REAPPLY_DATE_RULES)
        job.cancel()

        with mock.patch(
            "api.metadata.photo_datetime.get_metadata", side_effect=_camera_metadata
        ) as get_metadata:
            reapply_date_rules_batch([photo.pk], job.job_id)

        get_metadata.assert_not_called()
        self.assertEqual(Photo.objects.get(pk=photo.pk).exif_timestamp, OLD_DATE)

    def test_a_job_cancelled_before_it_ran_does_nothing(self):
        photo = self.photo(exif_timestamp=OLD_DATE)
        job = create_test_job(self.user, LongRunningJob.JOB_REAPPLY_DATE_RULES)
        job.cancel()

        with mock.patch.object(date_rules_job, "enqueue_task") as enqueue:
            reapply_date_rules_job(self.user, job_id=job.job_id)

        enqueue.assert_not_called()
        self.assertEqual(Photo.objects.get(pk=photo.pk).exif_timestamp, OLD_DATE)

    def test_a_failure_while_queuing_fails_the_job(self):
        self.photo(exif_timestamp=OLD_DATE)
        job = create_test_job(self.user, LongRunningJob.JOB_REAPPLY_DATE_RULES)

        with mock.patch.object(
            date_rules_job, "enqueue_task", side_effect=RuntimeError("broker down")
        ):
            reapply_date_rules_job(self.user, job_id=job.job_id)

        job.refresh_from_db()
        self.assertTrue(job.failed)
        self.assertEqual(job.result["error"], "broker down")


class UpdateBatchCounterTest(TestCase):
    def test_a_cancelled_job_keeps_its_result(self):
        job = create_test_job(create_test_user(), progress_target=2)
        job.cancel()

        update_batch_counter(job.job_id, 2, {"moved": 2}, ["Photo x: broken"])

        job.refresh_from_db()
        self.assertEqual(job.result, {"status": "cancelled"})
        self.assertEqual(job.progress_current, 0)

    def test_too_many_errors_fail_the_job(self):
        job = create_test_job(create_test_user(), progress_target=20)

        update_batch_counter(
            job.job_id, 20, {}, [f"Photo {index}: broken" for index in range(20)]
        )

        job.refresh_from_db()
        self.assertTrue(job.failed)
        self.assertTrue(job.finished)
        self.assertEqual(job.result["error_count"], 20)


class ReapplyDateRulesViewTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user()

    def test_a_user_starts_the_job(self):
        self.client.force_authenticate(user=self.user)
        with (
            mock.patch("api.jobs.queue.AsyncTask") as async_task,
            self.captureOnCommitCallbacks(execute=True),
        ):
            response = self.client.post(URL)

        self.assertEqual(response.status_code, 200)
        job_id = response.json()["job_id"]
        job = LongRunningJob.objects.get(job_id=job_id)
        self.assertEqual(job.job_type, LongRunningJob.JOB_REAPPLY_DATE_RULES)
        self.assertEqual(job.started_by, self.user)
        self.assertEqual(async_task.call_args.args, (reapply_date_rules_job, self.user))
        self.assertEqual(async_task.call_args.kwargs["job_id"], job_id)

    def test_a_second_start_while_it_runs_is_refused(self):
        running = create_test_job(self.user, LongRunningJob.JOB_REAPPLY_DATE_RULES)
        self.client.force_authenticate(user=self.user)

        with mock.patch("api.jobs.queue.AsyncTask") as async_task:
            response = self.client.post(URL)

        self.assertEqual(response.status_code, 409)
        self.assertEqual(api_error(response)["code"], "job_already_running")
        self.assertIn(running.job_id, json.dumps(response.json()))
        async_task.assert_not_called()

    def test_an_anonymous_request_is_refused(self):
        response = self.client.post(URL)

        self.assertEqual(response.status_code, 401)
        self.assertFalse(LongRunningJob.objects.exists())


def _camera_metadata_with_offset(path, tags, **kwargs):
    """The camera's date with the UTC offset it was taken at (EXIF 2.31)."""
    values = {
        Tags.DATE_TIME_ORIGINAL: "2005:01:02 03:04:05",
        Tags.OFFSET_TIME_ORIGINAL: "+09:00",
    }
    return [values.get(tag) for tag in tags]


class ReapplyFillsTheOffsetTest(TestCase):
    """#2768: the job fills the UTC offset and the rule of photos dated before."""

    def setUp(self):
        self.user = create_test_user(datetime_rules=json.dumps(CAMERA_RULES))

    def reapply(self, photo, metadata):
        with mock.patch(
            "api.metadata.photo_datetime.get_metadata", side_effect=metadata
        ):
            changed = reapply_date_rules(
                Photo.objects.select_related("owner", "main_file").get(pk=photo.pk)
            )
        return changed, Photo.objects.get(pk=photo.pk)

    def test_an_offset_alone_counts_as_a_change(self):
        photo = create_test_photo(owner=self.user, exif_timestamp=CAMERA_DATE)
        before = Photo.objects.get(pk=photo.pk).last_modified

        changed, photo = self.reapply(photo, _camera_metadata_with_offset)

        self.assertTrue(changed)
        self.assertEqual(
            (CAMERA_DATE, 540, 1),
            (
                photo.exif_timestamp,
                photo.exif_timestamp_offset,
                photo.exif_timestamp_source,
            ),
        )
        # The mobile sync feed does not carry the offset: nothing to pull.
        self.assertEqual(before, photo.last_modified)

    def test_the_rule_alone_is_stored_but_is_no_change(self):
        photo = create_test_photo(owner=self.user, exif_timestamp=CAMERA_DATE)

        changed, photo = self.reapply(photo, _camera_metadata)

        self.assertFalse(changed)
        self.assertEqual(
            (None, 1), (photo.exif_timestamp_offset, photo.exif_timestamp_source)
        )

    def test_a_photo_already_up_to_date_is_not_written(self):
        photo = create_test_photo(
            owner=self.user,
            exif_timestamp=CAMERA_DATE,
            exif_timestamp_offset=540,
            exif_timestamp_source=1,
        )

        changed, photo = self.reapply(photo, _camera_metadata_with_offset)

        self.assertFalse(changed)
        self.assertEqual(
            (540, 1), (photo.exif_timestamp_offset, photo.exif_timestamp_source)
        )

    def test_a_photo_the_rules_no_longer_date_loses_them(self):
        photo = create_test_photo(
            owner=self.user,
            exif_timestamp=CAMERA_DATE,
            exif_timestamp_offset=540,
            exif_timestamp_source=1,
        )

        changed, photo = self.reapply(
            photo, lambda path, tags, **kwargs: [None] * len(tags)
        )

        self.assertTrue(changed)
        self.assertEqual(
            (None, None, None),
            (
                photo.exif_timestamp,
                photo.exif_timestamp_offset,
                photo.exif_timestamp_source,
            ),
        )
