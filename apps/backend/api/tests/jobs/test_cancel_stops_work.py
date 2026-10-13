"""Cancelling a job stops its work, not only its row (#2198).

``cancel()`` marks the row finished at once, so the queue reports itself free.
Before #2198 only the per-photo jobs looked at the flag: queued scan file
groups kept importing photos, and duplicate and stack detection, face
training, search embeddings, variant repair and event albums ran to the end
while the next job started next to them.
"""

import datetime
import os
import shutil
import tempfile
import uuid
from unittest.mock import MagicMock, patch

import pyvips
from django.test import TestCase
from django.utils import timezone

from api.albums import auto_albums
from api.directory_watcher import repair_jobs, scan_jobs
from api.directory_watcher.file_handlers import handle_file_group, handle_new_image
from api.duplicates import detection as duplicate_detection
from api.faces import classify
from api.models import File, LongRunningJob, Photo
from api.models.long_running_job import JobCancelledError
from api.photos.media_files import get_or_create_file
from api.search import embedding_jobs
from api.stacks import detection as stack_detection
from api.tests.utils import create_test_job, create_test_photo, create_test_user

CANCELLED = {"status": "cancelled"}


class CancelTestCase(TestCase):
    job_type = LongRunningJob.JOB_SCAN_PHOTOS

    def setUp(self):
        self.user = create_test_user()
        self.job_id = str(uuid.uuid4())
        create_test_job(self.user, self.job_type, job_id=self.job_id)

    def job(self):
        return LongRunningJob.objects.get(job_id=self.job_id)

    def cancel(self):
        """Cancel the job the way the job list does: through another instance."""
        self.job().cancel()

    def assert_cancelled(self):
        job = self.job()
        self.assertTrue(job.cancelled)
        self.assertTrue(job.finished)
        self.assertFalse(job.failed)
        self.assertEqual(job.result, CANCELLED)


class StopIfCancelledTest(CancelTestCase):
    def test_raises_once_the_row_is_cancelled(self):
        lrj = LongRunningJob.claim(self.user, self.job_type, self.job_id)
        lrj.stop_if_cancelled()
        self.cancel()
        with patch.object(LongRunningJob, "CANCEL_CHECK_SECONDS", 0):
            with self.assertRaises(JobCancelledError):
                lrj.stop_if_cancelled()

    def test_reads_the_row_at_most_once_per_interval(self):
        lrj = LongRunningJob.claim(self.user, self.job_type, self.job_id)
        with self.assertNumQueries(1):
            for _ in range(1000):
                lrj.stop_if_cancelled()

    def test_a_refused_progress_write_stops_without_waiting(self):
        """``set_result`` re-reads a cancelled row, so the next check raises."""
        lrj = LongRunningJob.claim(self.user, self.job_type, self.job_id)
        lrj.stop_if_cancelled()
        self.cancel()
        self.assertFalse(lrj.set_result({"stage": "x"}))
        with self.assertRaises(JobCancelledError):
            lrj.stop_if_cancelled()


def _write_image(path: str, width: int) -> str:
    pyvips.Image.black(width, 8).write_to_file(path)
    return path


class ScanCancelTest(CancelTestCase):
    def setUp(self):
        super().setUp()
        self.tmpdir = tempfile.mkdtemp(prefix="lp-2198-")
        self.addCleanup(shutil.rmtree, self.tmpdir, True)
        self.job().update_progress(current=0, target=2)

    def test_file_group_of_a_cancelled_scan_imports_nothing(self):
        path = _write_image(os.path.join(self.tmpdir, "IMG_1.png"), 9)
        self.cancel()

        handle_file_group(self.user, [path], self.job_id)

        self.assertFalse(Photo.objects.exists())
        self.assertFalse(File.objects.filter(path=path).exists())
        self.assert_cancelled()
        self.assertEqual(self.job().progress_current, 1)

    def test_single_file_of_a_cancelled_scan_imports_nothing(self):
        path = _write_image(os.path.join(self.tmpdir, "IMG_2.png"), 11)
        self.cancel()

        handle_new_image(self.user, path, self.job_id)

        self.assertFalse(Photo.objects.exists())
        self.assert_cancelled()

    def test_cancelled_scan_stops_queuing_file_groups(self):
        groups = [((self.tmpdir, f"IMG_{i}"), [f"IMG_{i}.jpg"]) for i in range(3)]
        self.cancel()
        with patch.object(scan_jobs, "enqueue_task") as enqueue:
            scan_jobs._queue_scan_work(
                self.user, groups, ["IMG_9.xmp"], False, None, self.job_id
            )
        enqueue.assert_not_called()


class DuplicateDetectionCancelTest(CancelTestCase):
    job_type = LongRunningJob.JOB_DETECT_DUPLICATES

    def cancel_between_ticks(self, reached):
        def detector(user, *args):
            progress = next(a for a in args if callable(a))
            progress(1, 10, 0)
            self.cancel()
            progress(2, 10, 0)
            reached.append(True)
            return 0

        return detector

    def test_cancel_during_exact_copies_stops_the_job(self):
        reached = []
        with (
            patch.object(
                duplicate_detection,
                "detect_exact_copies",
                side_effect=self.cancel_between_ticks(reached),
            ),
            patch.object(
                duplicate_detection, "detect_visual_duplicates", return_value=0
            ) as visual,
        ):
            duplicate_detection.batch_detect_duplicates(self.user, {}, self.job_id)

        self.assertEqual(reached, [])
        visual.assert_not_called()
        self.assert_cancelled()

    def test_cancel_during_visual_duplicates_stops_the_job(self):
        reached = []
        with patch.object(
            duplicate_detection,
            "detect_visual_duplicates",
            side_effect=self.cancel_between_ticks(reached),
        ):
            duplicate_detection.batch_detect_duplicates(
                self.user, {"detect_exact_copies": False}, self.job_id
            )

        self.assertEqual(reached, [])
        self.assert_cancelled()

    def test_visual_groups_are_not_created_after_a_cancel(self):
        """The pair search reports progress once; the group loop must stop too."""
        hashes = ["0" * 16, "0" * 15 + "1", "f" * 16, "f" * 15 + "e"]
        for phash in hashes:
            create_test_photo(owner=self.user, perceptual_hash=phash)
        calls = []

        def progress(current, total, found):
            calls.append(current)
            if len(calls) == 3:
                raise JobCancelledError(self.job_id)

        with (
            patch.object(
                duplicate_detection.Duplicate, "create_or_merge"
            ) as create_or_merge,
            self.assertRaises(JobCancelledError),
        ):
            duplicate_detection.detect_visual_duplicates(
                self.user, progress_callback=progress
            )
        # Two groups were found; the third progress call (before the first
        # group is written) stopped it.
        create_or_merge.assert_not_called()


class StackDetectionCancelTest(CancelTestCase):
    job_type = LongRunningJob.JOB_DETECT_STACKS

    def test_cancel_during_burst_detection_stops_the_job(self):
        reached = []

        def detector(user, progress_callback):
            progress_callback(1, 10, 0)
            self.cancel()
            progress_callback(2, 10, 0)
            reached.append(True)
            return 0

        with patch.object(
            stack_detection, "detect_burst_sequences", side_effect=detector
        ):
            stack_detection.batch_detect_stacks(self.user, {}, self.job_id)

        self.assertEqual(reached, [])
        self.assert_cancelled()

    def test_soft_rules_report_progress_per_group(self):
        """The soft burst rules never called the progress callback."""
        start = timezone.now()
        for seconds in (0, 1, 100, 101):
            create_test_photo(
                owner=self.user,
                exif_timestamp=start + datetime.timedelta(seconds=seconds),
            )
        rule = MagicMock(
            rule_type=stack_detection.BurstRuleTypes.TIMESTAMP_PROXIMITY,
            params={"interval_ms": 2000, "require_same_camera": False},
        )

        def progress(current, total, found):
            raise JobCancelledError(self.job_id)

        with (
            patch.object(stack_detection, "_create_burst_stack") as create_stack,
            self.assertRaises(JobCancelledError),
        ):
            stack_detection._detect_bursts_soft_criteria(
                self.user, [rule], progress_callback=progress
            )
        create_stack.assert_not_called()


class FaceJobsCancelTest(CancelTestCase):
    job_type = LongRunningJob.JOB_TRAIN_FACES

    def test_cancel_while_splitting_faces_stops_training(self):
        def split(user):
            self.cancel()
            return {"encoding": [], "id": []}, {"encoding": [], "id": []}

        with (
            patch.object(classify, "split_faces_by_label", side_effect=split),
            patch.object(classify, "add_cluster_centroids") as centroids,
            patch.object(classify, "fit_mlp") as fit,
            patch.object(classify, "filter_data", return_value=([], [])),
        ):
            self.assertFalse(classify.train_faces(self.user, self.job_id))

        fit.assert_not_called()
        centroids.assert_not_called()
        self.assert_cancelled()

    def test_cancel_between_pages_stops_training(self):
        pages = []

        def classify_page(classifiers, encodings, ids, lrj, target):
            pages.append(ids)
            self.cancel()

        unknown = {"encoding": [[0.0]] * 150, "id": list(range(150))}
        with (
            patch.object(LongRunningJob, "CANCEL_CHECK_SECONDS", 0),
            patch.object(
                classify,
                "split_faces_by_label",
                return_value=({"encoding": [], "id": []}, unknown),
            ),
            patch.object(classify, "add_cluster_centroids"),
            patch.object(classify, "fit_mlp"),
            patch.object(
                classify,
                "filter_data",
                side_effect=lambda enc, ids: (enc, ids),
            ),
            patch.object(classify, "get_unknown_cluster"),
            patch.object(classify, "classify_face_page", side_effect=classify_page),
        ):
            self.assertFalse(classify.train_faces(self.user, self.job_id))

        self.assertEqual(len(pages), 1)
        self.assert_cancelled()


class EmbeddingJobCancelTest(CancelTestCase):
    job_type = LongRunningJob.JOB_CALCULATE_CLIP_EMBEDDINGS

    def test_cancel_stops_the_batch_loop_and_the_index_build(self):
        for _ in range(3):
            create_test_photo(owner=self.user)
        batches = []

        def store(objs, with_tags=False):
            batches.append(objs)
            self.cancel()

        with (
            patch.object(LongRunningJob, "CANCEL_CHECK_SECONDS", 0),
            patch.object(embedding_jobs, "BATCH_SIZE", 1),
            patch.object(embedding_jobs, "semantic_shares_tagger", return_value=False),
            patch.object(
                embedding_jobs, "photos_with_existing_thumbnail", side_effect=list
            ),
            patch.object(embedding_jobs, "store_clip_embeddings", side_effect=store),
            patch.object(embedding_jobs, "build_image_similarity_index") as build,
        ):
            embedding_jobs.batch_calculate_clip_embedding(self.user, job_id=self.job_id)

        self.assertEqual(len(batches), 1)
        build.assert_not_called()
        self.assert_cancelled()


class RepairJobCancelTest(CancelTestCase):
    job_type = LongRunningJob.JOB_REPAIR_FILE_VARIANTS

    def setUp(self):
        super().setUp()
        self.tmpdir = tempfile.mkdtemp(prefix="lp-2198-")
        self.addCleanup(shutil.rmtree, self.tmpdir, True)

    def raw_photo(self, name):
        path = os.path.join(self.tmpdir, name)
        with open(path, "wb") as fh:
            fh.write(name.encode())
        raw = get_or_create_file(path, self.user)
        photo = create_test_photo(owner=self.user)
        photo.main_file = raw
        photo.save()
        return photo

    def test_cancel_stops_the_repair_loop(self):
        for i in range(3):
            self.raw_photo(f"IMG_{i}.CR2")
        promoted = []

        def promote(photo):
            promoted.append(photo)
            self.cancel()
            return True

        with (
            patch.object(LongRunningJob, "CANCEL_CHECK_SECONDS", 0),
            patch.object(repair_jobs, "_promote_image_main_file", side_effect=promote),
        ):
            repair_jobs.repair_ungrouped_file_variants(self.user, self.job_id)

        self.assertEqual(len(promoted), 1)
        self.assert_cancelled()


class EventAlbumsCancelTest(CancelTestCase):
    job_type = LongRunningJob.JOB_GENERATE_AUTO_ALBUMS

    def test_cancel_stops_the_album_loop(self):
        start = timezone.now() - datetime.timedelta(days=30)
        for day in (0, 5, 10):
            for minutes in (0, 1):
                create_test_photo(
                    owner=self.user,
                    exif_timestamp=start
                    + datetime.timedelta(days=day, minutes=minutes),
                )
        albums = []

        def event_album(user, group, key, job_id):
            albums.append(group)
            self.cancel()
            return MagicMock(), False

        with (
            patch.object(LongRunningJob, "CANCEL_CHECK_SECONDS", 0),
            patch.object(auto_albums, "_event_album", side_effect=event_album),
            patch.object(auto_albums, "_update_event_album"),
        ):
            auto_albums.generate_event_albums(self.user, self.job_id)

        self.assertEqual(len(albums), 1)
        self.assert_cancelled()
