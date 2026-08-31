"""Characterization tests for directory_watcher.processing_jobs (unit 6).

Pins the CURRENT behaviour of ``generate_face_embeddings`` and
``add_geolocation`` before refactoring. Assertions describe what the code
does today, including several quirks that are called out in comments.

Everything heavy is mocked: ``Face.generate_encoding`` never touches the face
service, ``AsyncTask`` is patched so no worker runs, and no network or model
file is used.
"""

import uuid
from datetime import timedelta
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone

from api.directory_watcher import processing_jobs
from api.directory_watcher.processing_jobs import (
    add_geolocation,
    generate_face_embeddings,
)
from api.models import Face, LongRunningJob, Photo
from api.tests.utils import create_test_face, create_test_photo, create_test_user


def _job(job_id):
    return LongRunningJob.objects.get(job_id=str(job_id))


def _face_without_encoding(user):
    """A Face whose ``encoding`` is the empty string (the pending marker)."""
    photo = create_test_photo(owner=user)
    face = create_test_face(photo=photo)
    Face.objects.filter(pk=face.pk).update(encoding="")
    face.refresh_from_db()
    return face


class GenerateFaceEmbeddingsCharacterizationTest(TestCase):
    """Pin current behaviour of ``generate_face_embeddings``."""

    def setUp(self):
        self.user = create_test_user()
        self.job_id = uuid.uuid4()

    # ---- early exit --------------------------------------------------

    def test_no_pending_faces_returns_without_creating_a_job(self):
        photo = create_test_photo(owner=self.user)
        create_test_face(photo=photo)  # has a random encoding already

        with patch.object(Face, "generate_encoding") as gen:
            generate_face_embeddings(self.user, self.job_id)

        gen.assert_not_called()
        # The guard runs *before* get_or_create_job, so no row is written.
        self.assertFalse(LongRunningJob.objects.exists())

    def test_no_faces_at_all_returns_without_creating_a_job(self):
        generate_face_embeddings(self.user, self.job_id)
        self.assertFalse(LongRunningJob.objects.exists())

    # ---- happy path --------------------------------------------------

    def test_encodes_every_pending_face_and_finishes_job(self):
        faces = [_face_without_encoding(self.user) for _ in range(3)]

        with patch.object(Face, "generate_encoding") as gen:
            generate_face_embeddings(self.user, self.job_id)

        self.assertEqual(gen.call_count, 3)
        job = _job(self.job_id)
        self.assertEqual(job.job_type, LongRunningJob.JOB_GENERATE_FACE_EMBEDDINGS)
        self.assertEqual(job.progress_target, 3)
        # update_scan_counter() bumped progress_current to 3 in the DB.
        self.assertEqual(job.progress_current, 3)
        self.assertTrue(job.finished)
        self.assertFalse(job.failed)
        self.assertIsNotNone(job.started_at)
        self.assertEqual(len(faces), 3)

    def test_pending_faces_of_other_users_are_also_processed(self):
        """QUIRK: the queryset is global - ``user`` only owns the job row."""
        other = create_test_user()
        _face_without_encoding(other)
        _face_without_encoding(self.user)

        with patch.object(Face, "generate_encoding") as gen:
            generate_face_embeddings(self.user, self.job_id)

        self.assertEqual(gen.call_count, 2)
        job = _job(self.job_id)
        self.assertEqual(job.progress_target, 2)
        self.assertEqual(job.started_by_id, self.user.id)

    # ---- per-face errors ---------------------------------------------

    def test_per_face_failure_is_swallowed_and_loop_continues(self):
        _face_without_encoding(self.user)
        _face_without_encoding(self.user)

        with patch.object(
            Face,
            "generate_encoding",
            side_effect=[ValueError("no encoding"), None],
        ) as gen:
            generate_face_embeddings(self.user, self.job_id)

        self.assertEqual(gen.call_count, 2)
        job = _job(self.job_id)
        self.assertEqual(job.progress_current, 2)
        self.assertTrue(job.finished)
        # One error out of two stays below the sticky-failure floor (10).
        self.assertFalse(job.failed)
        # QUIRK: the trailing ``lrj.complete()`` writes the *stale* in-memory
        # ``result`` back over whatever update_scan_counter() accumulated, so
        # the per-face error text is lost from the job row.
        self.assertIsNone(job.result)

    def test_all_faces_failing_still_completes_the_job(self):
        _face_without_encoding(self.user)

        with patch.object(
            Face, "generate_encoding", side_effect=RuntimeError("service down")
        ):
            generate_face_embeddings(self.user, self.job_id)  # must not raise

        job = _job(self.job_id)
        self.assertTrue(job.finished)
        self.assertFalse(job.failed)
        self.assertIsNone(job.result)

    # ---- cancellation / fatal error ----------------------------------

    def test_cancelled_job_returns_before_encoding_anything(self):
        _face_without_encoding(self.user)

        with (
            patch.object(Face, "generate_encoding") as gen,
            patch.object(processing_jobs, "is_job_cancelled", return_value=True),
        ):
            generate_face_embeddings(self.user, self.job_id)

        gen.assert_not_called()
        job = _job(self.job_id)
        # The target was already published; the job is left unfinished.
        self.assertEqual(job.progress_target, 1)
        self.assertEqual(job.progress_current, 0)
        self.assertFalse(job.finished)
        self.assertFalse(job.failed)

    def test_cancellation_is_only_checked_on_the_first_iteration_of_a_small_batch(self):
        """CANCELLATION_CHECK_INTERVAL is 100, so idx 1..99 never check."""
        _face_without_encoding(self.user)
        _face_without_encoding(self.user)

        with (
            patch.object(Face, "generate_encoding"),
            patch.object(
                processing_jobs, "is_job_cancelled", return_value=False
            ) as cancelled,
        ):
            generate_face_embeddings(self.user, self.job_id)

        self.assertEqual(cancelled.call_count, 1)

    def test_unexpected_error_marks_job_failed_and_is_swallowed(self):
        _face_without_encoding(self.user)

        with (
            patch.object(Face, "generate_encoding") as gen,
            patch.object(
                processing_jobs.db.connections,
                "close_all",
                side_effect=RuntimeError("boom"),
            ),
        ):
            generate_face_embeddings(self.user, self.job_id)  # must not raise

        gen.assert_not_called()
        job = _job(self.job_id)
        self.assertTrue(job.failed)
        self.assertTrue(job.finished)
        self.assertEqual(job.result, {"status": "failed", "error": "boom"})

    def test_reuses_existing_job_row_for_same_job_id(self):
        existing = LongRunningJob.create_job(
            user=self.user,
            job_type=LongRunningJob.JOB_GENERATE_FACE_EMBEDDINGS,
            job_id=self.job_id,
        )
        _face_without_encoding(self.user)

        with patch.object(Face, "generate_encoding"):
            generate_face_embeddings(self.user, self.job_id)

        self.assertEqual(
            LongRunningJob.objects.filter(job_id=str(self.job_id)).count(), 1
        )
        existing.refresh_from_db()
        self.assertIsNotNone(existing.started_at)
        self.assertTrue(existing.finished)


class AddGeolocationCharacterizationTest(TestCase):
    """Pin current behaviour of ``add_geolocation``."""

    def setUp(self):
        self.user = create_test_user()
        self.job_id = uuid.uuid4()

    # ---- happy path --------------------------------------------------

    def test_queues_one_async_task_per_photo(self):
        photos = [create_test_photo(owner=self.user) for _ in range(3)]

        with patch.object(processing_jobs, "AsyncTask") as async_task:
            add_geolocation(self.user, self.job_id)

        self.assertEqual(async_task.call_count, 3)
        queued = set()
        for call in async_task.call_args_list:
            func, photo, job_id = call.args
            self.assertIs(func, processing_jobs.geolocation_job)
            self.assertEqual(job_id, self.job_id)
            queued.add(photo.pk)
        self.assertEqual(queued, {p.pk for p in photos})
        # Each AsyncTask is dispatched immediately via .run().
        self.assertEqual(async_task.return_value.run.call_count, 3)

        job = _job(self.job_id)
        self.assertEqual(job.job_type, LongRunningJob.JOB_ADD_GEOLOCATION)
        self.assertEqual(job.progress_target, 3)
        self.assertEqual(job.progress_current, 0)
        self.assertIsNotNone(job.started_at)
        # The dispatcher never finishes the job; the workers do that via
        # update_scan_counter().
        self.assertFalse(job.finished)
        self.assertFalse(job.failed)

    def test_photos_without_a_thumbnail_are_still_queued(self):
        """Unlike scan_faces, add_geolocation does not filter on thumbnails."""
        photo = create_test_photo(owner=self.user)
        photo.thumbnail.delete()

        with patch.object(processing_jobs, "AsyncTask") as async_task:
            add_geolocation(self.user, self.job_id)

        self.assertEqual(async_task.call_count, 1)
        self.assertEqual(async_task.call_args.args[1].pk, photo.pk)

    def test_no_photos_completes_job_with_zero_target(self):
        with patch.object(processing_jobs, "AsyncTask") as async_task:
            add_geolocation(self.user, self.job_id)

        async_task.assert_not_called()
        job = _job(self.job_id)
        self.assertEqual(job.progress_target, 0)
        self.assertEqual(job.progress_current, 0)
        self.assertTrue(job.finished)
        self.assertIsNotNone(job.finished_at)
        self.assertFalse(job.failed)

    def test_other_users_photos_are_not_queued(self):
        other = create_test_user()
        create_test_photo(owner=other)
        mine = create_test_photo(owner=self.user)

        with patch.object(processing_jobs, "AsyncTask") as async_task:
            add_geolocation(self.user, self.job_id)

        self.assertEqual(async_task.call_count, 1)
        self.assertEqual(async_task.call_args.args[1].pk, mine.pk)

    # ---- incremental vs full scan ------------------------------------

    def _finished_previous_scan(self, started_ago):
        last = LongRunningJob.create_job(
            user=self.user,
            job_type=LongRunningJob.JOB_ADD_GEOLOCATION,
            start_now=True,
        )
        last.started_at = timezone.now() - started_ago
        last.save(update_fields=["started_at"])
        last.complete()
        return last

    def test_incremental_scan_only_queues_photos_added_after_last_scan(self):
        now = timezone.now()
        self._finished_previous_scan(timedelta(hours=1))

        old = create_test_photo(owner=self.user)
        Photo.objects.filter(pk=old.pk).update(added_on=now - timedelta(hours=2))
        new = create_test_photo(owner=self.user)
        Photo.objects.filter(pk=new.pk).update(added_on=now)

        with patch.object(processing_jobs, "AsyncTask") as async_task:
            add_geolocation(self.user, self.job_id, full_scan=False)

        self.assertEqual(async_task.call_count, 1)
        self.assertEqual(async_task.call_args.args[1].pk, new.pk)
        self.assertEqual(_job(self.job_id).progress_target, 1)

    def test_full_scan_ignores_the_last_scan_cutoff(self):
        now = timezone.now()
        self._finished_previous_scan(timedelta(hours=1))

        old = create_test_photo(owner=self.user)
        Photo.objects.filter(pk=old.pk).update(added_on=now - timedelta(hours=2))
        create_test_photo(owner=self.user)

        with patch.object(processing_jobs, "AsyncTask") as async_task:
            add_geolocation(self.user, self.job_id, full_scan=True)

        self.assertEqual(async_task.call_count, 2)

    def test_incremental_scan_with_no_new_photos_completes_with_zero_target(self):
        now = timezone.now()
        self._finished_previous_scan(timedelta(hours=1))
        old = create_test_photo(owner=self.user)
        Photo.objects.filter(pk=old.pk).update(added_on=now - timedelta(hours=2))

        with patch.object(processing_jobs, "AsyncTask") as async_task:
            add_geolocation(self.user, self.job_id, full_scan=False)

        async_task.assert_not_called()
        job = _job(self.job_id)
        self.assertEqual(job.progress_target, 0)
        self.assertTrue(job.finished)

    def test_unfinished_previous_job_is_not_treated_as_last_scan(self):
        LongRunningJob.create_job(
            user=self.user,
            job_type=LongRunningJob.JOB_ADD_GEOLOCATION,
            start_now=True,
        )  # never completed -> no cutoff
        create_test_photo(owner=self.user)

        with patch.object(processing_jobs, "AsyncTask") as async_task:
            add_geolocation(self.user, self.job_id, full_scan=False)

        self.assertEqual(async_task.call_count, 1)

    def test_finished_scan_of_another_job_type_is_not_a_cutoff(self):
        now = timezone.now()
        other_type = LongRunningJob.create_job(
            user=self.user,
            job_type=LongRunningJob.JOB_SCAN_PHOTOS,
            start_now=True,
        )
        other_type.started_at = now - timedelta(hours=1)
        other_type.save(update_fields=["started_at"])
        other_type.complete()

        old = create_test_photo(owner=self.user)
        Photo.objects.filter(pk=old.pk).update(added_on=now - timedelta(hours=2))

        with patch.object(processing_jobs, "AsyncTask") as async_task:
            add_geolocation(self.user, self.job_id, full_scan=False)

        self.assertEqual(async_task.call_count, 1)

    def test_finished_scan_of_another_user_is_not_a_cutoff(self):
        now = timezone.now()
        other = create_test_user()
        theirs = LongRunningJob.create_job(
            user=other,
            job_type=LongRunningJob.JOB_ADD_GEOLOCATION,
            start_now=True,
        )
        theirs.started_at = now - timedelta(hours=1)
        theirs.save(update_fields=["started_at"])
        theirs.complete()

        old = create_test_photo(owner=self.user)
        Photo.objects.filter(pk=old.pk).update(added_on=now - timedelta(hours=2))

        with patch.object(processing_jobs, "AsyncTask") as async_task:
            add_geolocation(self.user, self.job_id, full_scan=False)

        self.assertEqual(async_task.call_count, 1)

    # ---- cancellation / fatal error ----------------------------------

    def test_cancelled_job_returns_before_queuing_any_task(self):
        create_test_photo(owner=self.user)

        with (
            patch.object(processing_jobs, "AsyncTask") as async_task,
            patch.object(processing_jobs, "is_job_cancelled", return_value=True),
        ):
            add_geolocation(self.user, self.job_id)

        async_task.assert_not_called()
        job = _job(self.job_id)
        # Target is already published; the row stays unfinished/unfailed.
        self.assertEqual(job.progress_target, 1)
        self.assertFalse(job.finished)
        self.assertFalse(job.failed)

    def test_cancellation_is_checked_once_for_a_small_batch(self):
        create_test_photo(owner=self.user)
        create_test_photo(owner=self.user)

        with (
            patch.object(processing_jobs, "AsyncTask"),
            patch.object(
                processing_jobs, "is_job_cancelled", return_value=False
            ) as cancelled,
        ):
            add_geolocation(self.user, self.job_id)

        self.assertEqual(cancelled.call_count, 1)

    def test_unexpected_error_marks_job_failed_and_is_swallowed(self):
        create_test_photo(owner=self.user)

        with (
            patch.object(processing_jobs, "AsyncTask") as async_task,
            patch.object(
                processing_jobs.db.connections,
                "close_all",
                side_effect=RuntimeError("boom"),
            ),
        ):
            add_geolocation(self.user, self.job_id)  # must not raise

        async_task.assert_not_called()
        job = _job(self.job_id)
        self.assertTrue(job.failed)
        self.assertTrue(job.finished)
        self.assertEqual(job.result, {"status": "failed", "error": "boom"})

    def test_error_raised_while_queuing_fails_the_job_midway(self):
        create_test_photo(owner=self.user)
        create_test_photo(owner=self.user)

        with patch.object(
            processing_jobs, "AsyncTask", side_effect=RuntimeError("queue down")
        ):
            add_geolocation(self.user, self.job_id)

        job = _job(self.job_id)
        self.assertTrue(job.failed)
        self.assertTrue(job.finished)
        self.assertEqual(job.result["error"], "queue down")

    def test_reuses_existing_job_row_for_same_job_id(self):
        existing = LongRunningJob.create_job(
            user=self.user,
            job_type=LongRunningJob.JOB_ADD_GEOLOCATION,
            job_id=self.job_id,
        )
        create_test_photo(owner=self.user)

        with patch.object(processing_jobs, "AsyncTask"):
            add_geolocation(self.user, self.job_id)

        self.assertEqual(
            LongRunningJob.objects.filter(job_id=str(self.job_id)).count(), 1
        )
        existing.refresh_from_db()
        self.assertIsNotNone(existing.started_at)
        self.assertEqual(existing.progress_target, 1)
