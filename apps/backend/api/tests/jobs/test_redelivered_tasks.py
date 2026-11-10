"""A task the broker hands out again counts its item once (B5).

A taken task is leased (``api.jobs.broker.LEASE``); when its cluster stops
renewing, it runs again, also when its worker had already counted it. The
per-item tasks bumped the job's progress again: it passed the work queued
and finished the job, firing its follow-ups, before the rest had run.
"""

import uuid
from unittest.mock import patch

from django.test import TestCase

from api.directory_watcher import processing_jobs
from api.directory_watcher.utils import item_key, update_scan_counter
from api.jobs.cleanup import fail_stuck_jobs
from api.metadata import date_rules_job
from api.models import CountedJobItem, LongRunningJob
from api.tests.utils import create_test_job, create_test_photo, create_test_user

J = LongRunningJob


class RedeliveredTaskTest(TestCase):
    def setUp(self) -> None:
        self.user = create_test_user()
        self.job = create_test_job(self.user, J.JOB_GENERATE_TAGS, progress_target=2)

    def progress(self) -> tuple[int, bool]:
        self.job.refresh_from_db()
        return self.job.progress_current, self.job.finished

    def test_a_photo_task_delivered_twice_counts_once(self) -> None:
        photo = create_test_photo(owner=self.user)

        with patch.object(processing_jobs.semantic, "generate_photo_tags"):
            processing_jobs.generate_tag_job(photo.pk, self.job.job_id)
            processing_jobs.generate_tag_job(photo.pk, self.job.job_id)

        self.assertEqual(self.progress(), (1, False))

    def test_the_job_still_finishes_with_its_last_item(self) -> None:
        photos = [create_test_photo(owner=self.user) for _ in range(2)]

        with patch.object(processing_jobs.semantic, "generate_photo_tags"):
            for photo in (photos[0], photos[0], photos[1]):
                processing_jobs.generate_tag_job(photo.pk, self.job.job_id)

        self.assertEqual(self.progress(), (2, True))

    def test_a_failed_item_delivered_twice_is_one_error(self) -> None:
        item = item_key("group", "/photos/a.jpg")

        update_scan_counter(self.job.job_id, True, "a.jpg: unreadable", item=item)
        update_scan_counter(self.job.job_id, True, "a.jpg: unreadable", item=item)

        self.assertEqual(self.progress(), (1, False))
        self.assertEqual(self.job.result["error_count"], 1)

    def test_the_same_item_counts_in_each_job(self) -> None:
        other = create_test_job(self.user, J.JOB_GENERATE_TAGS, progress_target=2)
        item = item_key("photo", uuid.uuid4())

        update_scan_counter(self.job.job_id, item=item)
        update_scan_counter(other.job_id, item=item)

        other.refresh_from_db()
        self.assertEqual(self.progress(), (1, False))
        self.assertEqual(other.progress_current, 1)

    def test_a_batch_delivered_twice_counts_once(self) -> None:
        job = create_test_job(self.user, J.JOB_REAPPLY_DATE_RULES, progress_target=4)
        batch = [create_test_photo(owner=self.user).pk for _ in range(2)]

        with patch.object(date_rules_job, "reapply_date_rules", return_value=False):
            date_rules_job.reapply_date_rules_batch(batch, job.job_id)
            date_rules_job.reapply_date_rules_batch(batch, job.job_id)

        job.refresh_from_db()
        self.assertEqual(job.progress_current, 2)
        self.assertFalse(job.finished)

    def test_the_counted_items_of_an_ended_job_are_dropped(self) -> None:
        ended = create_test_job(self.user, J.JOB_GENERATE_TAGS, finished=True)
        update_scan_counter(self.job.job_id, item=item_key("photo", 1))
        update_scan_counter(ended.job_id, item=item_key("photo", 1))

        fail_stuck_jobs()

        self.assertEqual(
            list(CountedJobItem.objects.values_list("job_id", flat=True)),
            [self.job.job_id],
        )
