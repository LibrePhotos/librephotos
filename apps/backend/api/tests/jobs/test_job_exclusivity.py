"""Which job starts refuse which running jobs (``api.jobs.queue``).

Exclusivity was per user and job type only. An instance-wide job (over every
user's photos, or the instance's files) could run once per admin at the same
time; a scan started while a move or rename of the same user's photos ran,
though a move refused to start beside a scan; and the face encoding and
clustering at the end of Scan Faces wrote rows of their own beside the same
jobs started by the user, doing the same work twice.
"""

from unittest.mock import MagicMock, patch

from django.test import TestCase

from api.directory_watcher import processing_jobs
from api.drf.exceptions import JobAlreadyRunning, QueueBusy
from api.jobs.queue import enqueue_job, reserve_job
from api.models import LongRunningJob
from api.runtime.ml_models import start_model_download
from api.tests.utils import create_test_job, create_test_user

J = LongRunningJob


def job_task(user: object, job_id: str | None = None) -> None:
    """A planted task that claims its row."""


class InstanceWideJobTest(TestCase):
    def setUp(self) -> None:
        self.admin = create_test_user(is_admin=True)
        self.other_admin = create_test_user(is_admin=True)
        queue = patch("api.jobs.queue.AsyncTask")
        queue.start()
        self.addCleanup(queue.stop)

    def test_another_admins_start_is_refused_while_one_runs(self) -> None:
        for job_type in sorted(J.INSTANCE_WIDE_JOB_TYPES):
            with self.subTest(job_type=job_type):
                running = enqueue_job(self.admin, job_type, job_task, self.admin)

                with self.assertRaises(JobAlreadyRunning) as refused:
                    enqueue_job(self.other_admin, job_type, job_task, self.other_admin)

                self.assertEqual(refused.exception.job_id, running.job_id)

    def test_a_per_user_job_still_runs_once_per_user(self) -> None:
        enqueue_job(self.admin, J.JOB_GENERATE_TAGS, job_task, self.admin)

        enqueue_job(self.other_admin, J.JOB_GENERATE_TAGS, job_task, self.other_admin)

        self.assertEqual(J.objects.filter(job_type=J.JOB_GENERATE_TAGS).count(), 2)

    def test_a_finished_instance_wide_job_refuses_nothing(self) -> None:
        create_test_job(self.admin, J.JOB_LOOK_UP_PLACES, finished=True)

        enqueue_job(self.other_admin, J.JOB_LOOK_UP_PLACES, job_task, self.other_admin)


class ScanBesideMoveTest(TestCase):
    def setUp(self) -> None:
        self.user = create_test_user()
        queue = patch("api.jobs.queue.AsyncTask")
        queue.start()
        self.addCleanup(queue.stop)

    def test_a_scan_is_refused_while_a_move_runs(self) -> None:
        for path_change in J.PATH_CHANGE_JOB_TYPES:
            with self.subTest(path_change=path_change):
                move = create_test_job(self.user, path_change)

                with self.assertRaises(JobAlreadyRunning) as refused:
                    enqueue_job(self.user, J.JOB_SCAN_PHOTOS, job_task, self.user)

                self.assertEqual(refused.exception.job_id, move.job_id)
                J.objects.filter(pk=move.pk).update(finished=True)

    def test_a_move_is_refused_while_a_scan_runs(self) -> None:
        scan = create_test_job(self.user, J.JOB_SCAN_MISSING_PHOTOS)

        with self.assertRaises(JobAlreadyRunning) as refused:
            enqueue_job(self.user, J.JOB_MOVE_PHOTOS, job_task, self.user)

        self.assertEqual(refused.exception.job_id, scan.job_id)

    def test_another_users_move_does_not_hold_up_a_scan(self) -> None:
        create_test_job(create_test_user(), J.JOB_MOVE_PHOTOS)

        enqueue_job(self.user, J.JOB_SCAN_PHOTOS, job_task, self.user)


class ScanFacesTailTest(TestCase):
    """Scan Faces encodes and clusters under rows written like a user's start."""

    def setUp(self) -> None:
        self.user = create_test_user()

    def run_tail(self) -> tuple[MagicMock, MagicMock]:
        needs_encoding = MagicMock()
        needs_encoding.exists.return_value = True
        with (
            patch.object(processing_jobs, "generate_face_embeddings") as encode,
            patch.object(processing_jobs, "cluster_all_faces") as cluster,
            patch.object(
                processing_jobs, "faces_missing_encoding", return_value=needs_encoding
            ),
            patch.object(processing_jobs, "feature_enabled", return_value=True),
        ):
            processing_jobs._encode_and_cluster(self.user)
        return encode, cluster

    def test_each_step_runs_under_a_row_of_its_type(self) -> None:
        encode, cluster = self.run_tail()

        for work, job_type in (
            (encode, J.JOB_GENERATE_FACE_EMBEDDINGS),
            (cluster, J.JOB_CLUSTER_ALL_FACES),
        ):
            with self.subTest(job_type=job_type):
                work.assert_called_once()
                job_id = work.call_args.kwargs["job_id"]
                job = J.objects.get(job_id=job_id)
                self.assertEqual(job.job_type, job_type)
                self.assertEqual(job.started_by, self.user)

    def test_a_step_the_user_started_is_left_to_that_job(self) -> None:
        create_test_job(self.user, J.JOB_GENERATE_FACE_EMBEDDINGS)

        encode, cluster = self.run_tail()

        encode.assert_not_called()
        cluster.assert_called_once()

    def test_reserving_is_refused_like_a_start(self) -> None:
        running = create_test_job(self.user, J.JOB_CLUSTER_ALL_FACES)

        with self.assertRaises(JobAlreadyRunning) as refused:
            reserve_job(self.user, J.JOB_CLUSTER_ALL_FACES)

        self.assertEqual(refused.exception.job_id, running.job_id)


class InstanceWideRefusalAnswerTest(TestCase):
    """A refusal names the running job only to someone who can open it."""

    def setUp(self) -> None:
        self.admin = create_test_user(is_admin=True)
        queue = patch("api.jobs.queue.AsyncTask")
        queue.start()
        self.addCleanup(queue.stop)
        self.running = enqueue_job(
            self.admin, J.JOB_DOWNLOAD_MODELS, job_task, self.admin
        )

    def test_another_admin_is_told_the_job_to_follow(self) -> None:
        other_admin = create_test_user(is_admin=True)

        with self.assertRaises(JobAlreadyRunning) as refused:
            enqueue_job(other_admin, J.JOB_DOWNLOAD_MODELS, job_task, other_admin)

        self.assertEqual(refused.exception.job_id, self.running.job_id)

    def test_a_user_who_cannot_see_it_is_told_the_queue_is_busy(self) -> None:
        user = create_test_user()

        with self.assertRaises(QueueBusy) as refused:
            enqueue_job(user, J.JOB_DOWNLOAD_MODELS, job_task, user)

        self.assertNotIn(self.running.job_id, str(refused.exception.detail))
        self.assertFalse(hasattr(refused.exception, "entry_fields"))

    def test_the_model_download_of_a_user_counts_it_as_running(self) -> None:
        user = create_test_user()

        with patch("api.runtime.ml_models.model_download_running", return_value=False):
            self.assertTrue(start_model_download(user))
