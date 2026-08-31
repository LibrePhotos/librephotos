"""Characterization tests for directory_watcher.processing_jobs (unit 5).

Pins the CURRENT behaviour of ``generate_tags`` and ``scan_faces`` before
refactoring. These tests deliberately assert what the code does today,
including a couple of quirks that are called out in comments.

All ML work is mocked: ``Photo._extract_faces`` is patched, ``AsyncTask`` is
patched, and the face-embedding / clustering tail calls of ``scan_faces`` are
patched at module level. Nothing here touches the network or a model file.
"""

import uuid
from datetime import timedelta
from unittest.mock import patch

from constance.test import override_config
from django.test import TestCase
from django.utils import timezone

from api.directory_watcher import processing_jobs
from api.directory_watcher.processing_jobs import generate_tags, scan_faces
from api.models import LongRunningJob, Photo
from api.tests.utils import create_test_photo, create_test_user


def _job(job_id):
    return LongRunningJob.objects.get(job_id=str(job_id))


class GenerateTagsCharacterizationTest(TestCase):
    """Pin current behaviour of ``generate_tags``."""

    def setUp(self):
        self.user = create_test_user()
        self.job_id = uuid.uuid4()

    # ---- happy path -------------------------------------------------

    @override_config(TAGGING_MODEL="places365")
    def test_queues_one_async_task_per_untagged_photo(self):
        photos = [create_test_photo(owner=self.user) for _ in range(3)]

        with patch.object(processing_jobs, "AsyncTask") as async_task:
            generate_tags(self.user, self.job_id)

        self.assertEqual(async_task.call_count, 3)
        queued = set()
        for call in async_task.call_args_list:
            func, photo, job_id = call.args
            self.assertIs(func, processing_jobs.generate_tag_job)
            self.assertEqual(job_id, self.job_id)
            queued.add(photo.pk)
        self.assertEqual(queued, {p.pk for p in photos})

        job = _job(self.job_id)
        self.assertEqual(job.job_type, LongRunningJob.JOB_GENERATE_TAGS)
        self.assertEqual(job.progress_target, 3)
        self.assertEqual(job.progress_current, 0)
        self.assertIsNotNone(job.started_at)
        # The dispatching function never completes the job itself; the
        # worker tasks do that via update_scan_counter().
        self.assertFalse(job.finished)
        self.assertFalse(job.failed)

    @override_config(TAGGING_MODEL="places365")
    def test_no_matching_photos_completes_job_with_zero_target(self):
        with patch.object(processing_jobs, "AsyncTask") as async_task:
            generate_tags(self.user, self.job_id)

        async_task.assert_not_called()
        job = _job(self.job_id)
        self.assertEqual(job.progress_target, 0)
        self.assertEqual(job.progress_current, 0)
        self.assertTrue(job.finished)
        self.assertIsNotNone(job.finished_at)
        self.assertFalse(job.failed)

    @override_config(TAGGING_MODEL="places365")
    def test_photo_already_tagged_with_active_model_is_skipped(self):
        create_test_photo(
            owner=self.user, captions_json={"places365": {"attributes": []}}
        )
        pending = create_test_photo(owner=self.user, captions_json={"im2txt": "a cat"})

        with patch.object(processing_jobs, "AsyncTask") as async_task:
            generate_tags(self.user, self.job_id)

        # Only the photo missing a "places365" key is queued: a caption row
        # for a *different* model does not count as tagged.
        self.assertEqual(async_task.call_count, 1)
        self.assertEqual(async_task.call_args.args[1].pk, pending.pk)
        self.assertEqual(_job(self.job_id).progress_target, 1)

    @override_config(TAGGING_MODEL="im2txt")
    def test_active_tagging_model_selects_which_photos_are_pending(self):
        """Switching TAGGING_MODEL flips which photos are considered done."""
        places = create_test_photo(owner=self.user, captions_json={"places365": {}})
        create_test_photo(owner=self.user, captions_json={"im2txt": "a cat"})

        with patch.object(processing_jobs, "AsyncTask") as async_task:
            generate_tags(self.user, self.job_id)

        self.assertEqual(async_task.call_count, 1)
        self.assertEqual(async_task.call_args.args[1].pk, places.pk)

    @override_config(TAGGING_MODEL="places365")
    def test_other_users_photos_are_not_touched(self):
        other = create_test_user()
        create_test_photo(owner=other)
        mine = create_test_photo(owner=self.user)

        with patch.object(processing_jobs, "AsyncTask") as async_task:
            generate_tags(self.user, self.job_id)

        self.assertEqual(async_task.call_count, 1)
        self.assertEqual(async_task.call_args.args[1].pk, mine.pk)

    # ---- incremental vs full scan -----------------------------------

    @override_config(TAGGING_MODEL="places365")
    def test_incremental_scan_only_processes_photos_added_after_last_scan(self):
        now = timezone.now()
        last = LongRunningJob.create_job(
            user=self.user,
            job_type=LongRunningJob.JOB_GENERATE_TAGS,
            start_now=True,
        )
        last.started_at = now - timedelta(hours=1)
        last.save(update_fields=["started_at"])
        last.complete()

        old = create_test_photo(owner=self.user)
        Photo.objects.filter(pk=old.pk).update(added_on=now - timedelta(hours=2))
        new = create_test_photo(owner=self.user)
        Photo.objects.filter(pk=new.pk).update(added_on=now)

        with patch.object(processing_jobs, "AsyncTask") as async_task:
            generate_tags(self.user, self.job_id, full_scan=False)

        self.assertEqual(async_task.call_count, 1)
        self.assertEqual(async_task.call_args.args[1].pk, new.pk)

    @override_config(TAGGING_MODEL="places365")
    def test_full_scan_ignores_last_scan_cutoff(self):
        now = timezone.now()
        last = LongRunningJob.create_job(
            user=self.user,
            job_type=LongRunningJob.JOB_GENERATE_TAGS,
            start_now=True,
        )
        last.started_at = now - timedelta(hours=1)
        last.save(update_fields=["started_at"])
        last.complete()

        old = create_test_photo(owner=self.user)
        Photo.objects.filter(pk=old.pk).update(added_on=now - timedelta(hours=2))
        create_test_photo(owner=self.user)

        with patch.object(processing_jobs, "AsyncTask") as async_task:
            generate_tags(self.user, self.job_id, full_scan=True)

        self.assertEqual(async_task.call_count, 2)

    @override_config(TAGGING_MODEL="places365")
    def test_unfinished_previous_job_is_not_treated_as_last_scan(self):
        LongRunningJob.create_job(
            user=self.user,
            job_type=LongRunningJob.JOB_GENERATE_TAGS,
            start_now=True,
        )  # never completed -> not a cutoff
        create_test_photo(owner=self.user)

        with patch.object(processing_jobs, "AsyncTask") as async_task:
            generate_tags(self.user, self.job_id, full_scan=False)

        self.assertEqual(async_task.call_count, 1)

    # ---- cancellation / error ---------------------------------------

    @override_config(TAGGING_MODEL="places365")
    def test_cancelled_job_returns_before_queuing_any_task(self):
        create_test_photo(owner=self.user)

        with (
            patch.object(processing_jobs, "AsyncTask") as async_task,
            patch.object(processing_jobs, "is_job_cancelled", return_value=True),
        ):
            generate_tags(self.user, self.job_id)

        async_task.assert_not_called()
        job = _job(self.job_id)
        # Cancellation leaves the job un-finished and un-failed; the target
        # has already been written though.
        self.assertEqual(job.progress_target, 1)
        self.assertFalse(job.finished)
        self.assertFalse(job.failed)

    @override_config(TAGGING_MODEL="places365")
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
            generate_tags(self.user, self.job_id)  # must not raise

        async_task.assert_not_called()
        job = _job(self.job_id)
        self.assertTrue(job.failed)
        self.assertTrue(job.finished)
        self.assertEqual(job.result, {"status": "failed", "error": "boom"})

    @override_config(TAGGING_MODEL="places365")
    def test_reuses_existing_job_row_for_same_job_id(self):
        existing = LongRunningJob.create_job(
            user=self.user,
            job_type=LongRunningJob.JOB_GENERATE_TAGS,
            job_id=self.job_id,
        )
        with patch.object(processing_jobs, "AsyncTask"):
            generate_tags(self.user, self.job_id)

        self.assertEqual(
            LongRunningJob.objects.filter(job_id=str(self.job_id)).count(), 1
        )
        existing.refresh_from_db()
        self.assertIsNotNone(existing.started_at)


class ScanFacesCharacterizationTest(TestCase):
    """Pin current behaviour of ``scan_faces``."""

    def setUp(self):
        self.user = create_test_user()
        self.job_id = uuid.uuid4()

    def _patches(self):
        """Patch the two tail calls made after the main loop."""
        return (
            patch.object(processing_jobs, "generate_face_embeddings"),
            patch.object(processing_jobs, "cluster_all_faces"),
        )

    def test_extracts_faces_for_each_photo_and_finishes_job(self):
        photos = [create_test_photo(owner=self.user) for _ in range(2)]
        embed, cluster = self._patches()

        with (
            embed as mock_embed,
            cluster as mock_cluster,
            patch.object(Photo, "_extract_faces") as extract,
        ):
            scan_faces(self.user, self.job_id)

        self.assertEqual(extract.call_count, 2)
        job = _job(self.job_id)
        self.assertEqual(job.job_type, LongRunningJob.JOB_SCAN_FACES)
        self.assertEqual(job.progress_target, 2)
        self.assertEqual(job.progress_current, 2)
        # The job is finished by update_scan_counter(), not by scan_faces.
        self.assertTrue(job.finished)
        self.assertFalse(job.failed)

        # Embedding generation and clustering always run afterwards, each
        # with a freshly generated job id (not the scan's own job id).
        mock_embed.assert_called_once()
        mock_cluster.assert_called_once()
        self.assertIs(mock_embed.call_args.args[0], self.user)
        self.assertIsInstance(mock_embed.call_args.args[1], uuid.UUID)
        self.assertNotEqual(mock_embed.call_args.args[1], self.job_id)
        self.assertIs(mock_cluster.call_args.args[0], self.user)
        self.assertIsInstance(mock_cluster.call_args.args[1], uuid.UUID)
        self.assertNotEqual(
            mock_embed.call_args.args[1], mock_cluster.call_args.args[1]
        )

        self.assertEqual(len(photos), 2)

    def test_no_photos_completes_job_and_skips_embedding_and_clustering(self):
        embed, cluster = self._patches()

        with embed as mock_embed, cluster as mock_cluster:
            scan_faces(self.user, self.job_id)

        job = _job(self.job_id)
        self.assertEqual(job.progress_target, 0)
        self.assertTrue(job.finished)
        self.assertFalse(job.failed)
        # Early ``return`` skips the tail calls entirely.
        mock_embed.assert_not_called()
        mock_cluster.assert_not_called()

    def test_photo_without_thumbnail_row_is_excluded(self):
        photo = create_test_photo(owner=self.user)
        photo.thumbnail.delete()
        embed, cluster = self._patches()

        with (
            embed,
            cluster,
            patch.object(Photo, "_extract_faces") as extract,
        ):
            scan_faces(self.user, self.job_id)

        extract.assert_not_called()
        self.assertEqual(_job(self.job_id).progress_target, 0)

    def test_other_users_photos_are_not_scanned(self):
        other = create_test_user()
        create_test_photo(owner=other)
        embed, cluster = self._patches()

        with (
            embed,
            cluster,
            patch.object(Photo, "_extract_faces") as extract,
        ):
            scan_faces(self.user, self.job_id)

        extract.assert_not_called()
        self.assertEqual(_job(self.job_id).progress_target, 0)

    def test_per_photo_failure_is_recorded_and_loop_continues(self):
        create_test_photo(owner=self.user)
        create_test_photo(owner=self.user)
        embed, cluster = self._patches()

        with (
            embed,
            cluster,
            patch.object(
                Photo, "_extract_faces", side_effect=[ValueError("bad face"), None]
            ) as extract,
        ):
            scan_faces(self.user, self.job_id)

        self.assertEqual(extract.call_count, 2)
        job = _job(self.job_id)
        self.assertEqual(job.progress_current, 2)
        self.assertTrue(job.finished)
        # One error out of two is under the sticky-failure threshold.
        self.assertFalse(job.failed)
        self.assertEqual(job.result["status"], "partial_failure")
        self.assertEqual(job.result["error_count"], 1)
        self.assertIn("bad face", job.result["error"])

    def test_single_photo_failing_stays_below_sticky_failure_floor(self):
        """Even 1-of-1 failing does not set job.failed (absolute floor is 10)."""
        create_test_photo(owner=self.user)
        embed, cluster = self._patches()

        with (
            embed,
            cluster,
            patch.object(Photo, "_extract_faces", side_effect=RuntimeError("nope")),
        ):
            scan_faces(self.user, self.job_id)

        job = _job(self.job_id)
        self.assertTrue(job.finished)
        self.assertFalse(job.failed)
        self.assertEqual(job.result["status"], "partial_failure")
        self.assertEqual(job.result["error_count"], 1)

    def test_cancelled_job_stops_before_extraction_and_skips_tail_calls(self):
        create_test_photo(owner=self.user)
        embed, cluster = self._patches()

        with (
            embed as mock_embed,
            cluster as mock_cluster,
            patch.object(Photo, "_extract_faces") as extract,
            patch.object(processing_jobs, "is_job_cancelled", return_value=True),
        ):
            scan_faces(self.user, self.job_id)

        extract.assert_not_called()
        mock_embed.assert_not_called()
        mock_cluster.assert_not_called()
        job = _job(self.job_id)
        self.assertEqual(job.progress_target, 1)
        self.assertFalse(job.finished)

    def test_unexpected_error_fails_job_but_still_runs_tail_calls(self):
        create_test_photo(owner=self.user)
        embed, cluster = self._patches()

        with (
            embed as mock_embed,
            cluster as mock_cluster,
            patch.object(
                processing_jobs.db.connections,
                "close_all",
                side_effect=RuntimeError("boom"),
            ),
            patch.object(Photo, "_extract_faces") as extract,
        ):
            scan_faces(self.user, self.job_id)  # must not raise

        extract.assert_not_called()
        job = _job(self.job_id)
        self.assertTrue(job.failed)
        self.assertTrue(job.finished)
        self.assertEqual(job.result, {"status": "failed", "error": "boom"})
        # NOTE: unlike the cancel/empty paths, the failure path falls through
        # to the tail calls.
        mock_embed.assert_called_once()
        mock_cluster.assert_called_once()

    def test_incremental_scan_only_processes_photos_added_after_last_scan(self):
        now = timezone.now()
        last = LongRunningJob.create_job(
            user=self.user,
            job_type=LongRunningJob.JOB_SCAN_FACES,
            start_now=True,
        )
        last.started_at = now - timedelta(hours=1)
        last.save(update_fields=["started_at"])
        last.complete()

        old = create_test_photo(owner=self.user)
        Photo.objects.filter(pk=old.pk).update(added_on=now - timedelta(hours=2))
        new = create_test_photo(owner=self.user)
        Photo.objects.filter(pk=new.pk).update(added_on=now)

        embed, cluster = self._patches()
        seen = []
        with (
            embed,
            cluster,
            patch.object(
                Photo,
                "_extract_faces",
                autospec=True,
                side_effect=lambda s: seen.append(s.pk),
            ),
        ):
            scan_faces(self.user, self.job_id, full_scan=False)

        self.assertEqual(seen, [new.pk])

    def test_full_scan_ignores_last_scan_cutoff(self):
        now = timezone.now()
        last = LongRunningJob.create_job(
            user=self.user,
            job_type=LongRunningJob.JOB_SCAN_FACES,
            start_now=True,
        )
        last.started_at = now - timedelta(hours=1)
        last.save(update_fields=["started_at"])
        last.complete()

        old = create_test_photo(owner=self.user)
        Photo.objects.filter(pk=old.pk).update(added_on=now - timedelta(hours=2))
        create_test_photo(owner=self.user)

        embed, cluster = self._patches()
        with (
            embed,
            cluster,
            patch.object(Photo, "_extract_faces") as extract,
        ):
            scan_faces(self.user, self.job_id, full_scan=True)

        self.assertEqual(extract.call_count, 2)

    def test_last_scan_of_a_different_job_type_is_ignored(self):
        now = timezone.now()
        other = LongRunningJob.create_job(
            user=self.user,
            job_type=LongRunningJob.JOB_GENERATE_TAGS,
            start_now=True,
        )
        other.started_at = now
        other.save(update_fields=["started_at"])
        other.complete()

        old = create_test_photo(owner=self.user)
        Photo.objects.filter(pk=old.pk).update(added_on=now - timedelta(hours=2))

        embed, cluster = self._patches()
        with (
            embed,
            cluster,
            patch.object(Photo, "_extract_faces") as extract,
        ):
            scan_faces(self.user, self.job_id, full_scan=False)

        self.assertEqual(extract.call_count, 1)
