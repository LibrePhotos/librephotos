import uuid
from unittest.mock import patch

import requests
from django.test import TestCase, override_settings

from api.directory_watcher import processing_jobs
from api.directory_watcher.processing_jobs import scan_faces
from api.jobs import store, worker
from api.jobs.queue import remove_queued_tasks
from api.jobs.worker import run_task
from api.models import LongRunningJob, QueuedTask
from api.models.task_queue import CANCELLED, HEAVY_QUEUE, QUEUED, QUEUES, WAITING
from api.tests.queue_recorder import run_queued
from api.tests.utils import create_test_photo, create_test_user


@override_settings(FEATURE_FACE_DETECTION=True)
class ScanFacesFanOutTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.job_id = str(uuid.uuid4())
        chunk = patch.object(processing_jobs, "FACE_SCAN_CHUNK", 4)
        chunk.start()
        self.addCleanup(chunk.stop)
        crops = patch.object(processing_jobs.photo_faces, "restore_missing_crops")
        crops.start()
        self.addCleanup(crops.stop)
        followups = patch.object(processing_jobs, "_queue_face_followups")
        self.followups = followups.start()
        self.addCleanup(followups.stop)

    def photos(self, count):
        return [create_test_photo(owner=self.user) for _ in range(count)]

    def job(self):
        return LongRunningJob.objects.get(job_id=self.job_id)

    def test_the_photos_go_out_in_chunks_with_one_follow_up_behind_them(self):
        self.photos(10)

        scan_faces(self.user, self.job_id)

        tasks = list(QueuedTask.objects.order_by("id"))
        chunks = [task for task in tasks if not task.is_group_followup]
        self.assertEqual([4, 4, 2], [len(task.args[1]) for task in chunks])
        self.assertEqual({HEAVY_QUEUE}, {task.queue for task in chunks})
        self.assertEqual([0, 1, 2], [task.args[2] for task in chunks])
        [followup] = [task for task in tasks if task.is_group_followup]
        self.assertEqual(
            ("api.directory_watcher.processing_jobs.finish_face_scan", WAITING),
            (followup.func, followup.status),
        )

    def test_one_worker_scans_every_photo_once_in_listing_order(self):
        photos = self.photos(10)

        with patch.object(processing_jobs, "extract_faces") as extract:
            scan_faces(self.user, self.job_id)
            run_queued()

        scanned = [call.args[0].pk for call in extract.call_args_list]
        self.assertEqual(sorted(photo.pk for photo in photos), sorted(scanned))
        self.assertEqual(len(set(scanned)), 10)
        job = self.job()
        self.assertEqual(
            (10, 10, True, False),
            (job.progress_current, job.progress_target, job.finished, job.failed),
        )
        self.followups.assert_called_once_with(self.user)
        self.assertFalse(QueuedTask.objects.exists())

    def test_a_chunk_delivered_twice_counts_its_photos_once(self):
        self.photos(3)
        scan_faces(self.user, self.job_id)
        [chunk] = QueuedTask.objects.filter(is_group_followup=False)

        with patch.object(processing_jobs, "extract_faces") as extract:
            processing_jobs.scan_faces_chunk(*chunk.args)
            LongRunningJob.objects.filter(job_id=self.job_id).update(finished=False)
            processing_jobs.scan_faces_chunk(*chunk.args)

        self.assertEqual(3, extract.call_count)
        self.assertEqual(3, self.job().progress_current)

    def test_a_cancel_drops_the_chunks_still_queued_and_queues_no_follow_up(self):
        self.photos(10)
        with patch.object(processing_jobs, "extract_faces") as extract:
            scan_faces(self.user, self.job_id)
            run_task(store.claim("w", QUEUES))
            self.job().cancel()
            remove_queued_tasks(self.job_id)
            run_queued()

        self.assertEqual(4, extract.call_count)
        self.assertEqual(2, QueuedTask.objects.filter(status=CANCELLED).count())
        self.followups.assert_not_called()

    def test_a_chunk_that_crashed_does_not_hold_the_follow_up_back(self):
        self.photos(8)
        scan_faces(self.user, self.job_id)
        first = store.claim("w", QUEUES)
        store.fail(first, "the worker crashed three times")

        with patch.object(processing_jobs, "extract_faces"):
            run_queued()

        self.followups.assert_called_once()
        self.assertTrue(self.job().finished)

    def test_the_unreachable_count_spans_chunks(self):
        limit = processing_jobs.FACE_SERVICE_UNREACHABLE_LIMIT
        self.photos(limit + 6)
        down = requests.ConnectionError("Connection refused")

        with patch.object(
            processing_jobs, "extract_faces", side_effect=down
        ) as extract:
            scan_faces(self.user, self.job_id)
            run_queued()

        self.assertEqual(limit, extract.call_count)
        job = self.job()
        self.assertTrue(job.failed)
        self.assertIn("Face service unreachable", job.result["error"])
        self.followups.assert_not_called()

    def test_a_worker_that_must_stop_hands_the_rest_of_its_chunk_back(self):
        self.photos(4)
        scan_faces(self.user, self.job_id)
        drained = worker.Worker(0, _Never(), _Width(), worker.WorkerSettings())
        extracted = []

        def extract_then_drain(photo):
            extracted.append(photo.pk)
            if len(extracted) == 2:
                drained.running.drain = "memory: 900 MB"

        with (
            patch.object(
                processing_jobs, "extract_faces", side_effect=extract_then_drain
            ),
            patch.object(worker.Worker, "_register"),
            patch.object(worker, "_state", drained.running),
        ):
            drained.run_one()
            chunk = QueuedTask.objects.get(is_group_followup=False)
            self.assertEqual((QUEUED, 0), (chunk.status, chunk.attempts))
            drained.running.drain = ""
            run_queued()

        self.assertEqual(4, len(extracted))
        self.assertEqual(4, len(set(extracted)))
        self.assertTrue(self.job().finished)


class _Never:
    def is_set(self):
        return False


class _Width:
    value = 4
