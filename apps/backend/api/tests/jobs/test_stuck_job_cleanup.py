"""The hourly stuck-job cleanup leaves alone the jobs a live cluster works on.

The incident (#2867): Find Similar Faces clusters in one call and reports no
progress until it ends; on a library of 96k faces that call ran for more than
three hours. Past ``STUCK_JOB_HOURS`` the cleanup failed the job while it
worked, and when the call then succeeded the job still showed "failed: no
progress for 24 hours".
"""

import datetime
import uuid

from django.conf import settings
from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone
from django_q.brokers import get_broker
from django_q.models import OrmQ, Schedule
from django_q.signing import SignedPackage
from django_q.tasks import async_chain

from api.jobs.broker import LEASE
from api.jobs.cleanup import OLD_STUCK_JOBS_FUNC, STUCK_JOBS_FUNC, fail_stuck_jobs
from api.models import LongRunningJob
from api.tests.utils import create_test_user

J = LongRunningJob


def queue_task(*args: object, **kwargs: object) -> int:
    payload = SignedPackage.dumps(
        {"id": "t1", "name": "t1", "func": "math.floor", "args": args, "kwargs": kwargs}
    )
    task_id: int = get_broker().enqueue(payload)
    return task_id


def hold(task_id: int) -> None:
    """Taken by a cluster that renews its lease: locked a lease ahead."""
    OrmQ.objects.filter(pk=task_id).update(lock=timezone.now() + LEASE)


class StuckJobCleanupTest(TestCase):
    def setUp(self) -> None:
        self.user = create_test_user()

    def silent_job(self) -> J:
        """A job that started, and reported nothing, past ``STUCK_JOB_HOURS``."""
        started = timezone.now() - datetime.timedelta(
            hours=settings.STUCK_JOB_HOURS + 1
        )
        return J.objects.create(
            started_by=self.user,
            job_id=str(uuid.uuid4()),
            job_type=J.JOB_CLUSTER_ALL_FACES,
            queued_at=started,
            started_at=started,
        )

    def assert_running(self, job: J) -> None:
        job.refresh_from_db()
        self.assertFalse(job.finished)
        self.assertFalse(job.failed)

    def assert_failed(self, job: J) -> None:
        job.refresh_from_db()
        self.assertTrue(job.finished)
        self.assertTrue(job.failed)

    def test_the_model_alone_fails_a_silent_job_that_is_still_working(self) -> None:
        # The bug: progress is the only sign of life it knows.
        job = self.silent_job()
        hold(queue_task(self.user.pk, job_id=job.job_id))

        self.assertEqual(J.cleanup_stuck_jobs(), 1)
        self.assert_failed(job)

    def test_leaves_alone_a_job_whose_task_a_live_cluster_holds(self) -> None:
        job = self.silent_job()
        hold(queue_task(self.user.pk, job_id=job.job_id))

        self.assertEqual(fail_stuck_jobs(), 0)
        self.assert_running(job)

    def test_fails_a_job_whose_cluster_went_away(self) -> None:
        # Its lease ran out: no cluster renews it any more.
        job = self.silent_job()
        task_id = queue_task(self.user.pk, job_id=job.job_id)
        OrmQ.objects.filter(pk=task_id).update(
            lock=timezone.now() - datetime.timedelta(seconds=1)
        )

        self.assertEqual(fail_stuck_jobs(), 1)
        self.assert_failed(job)

    def test_fails_a_job_no_held_task_names(self) -> None:
        job, other = self.silent_job(), self.silent_job()
        hold(queue_task(self.user.pk, job_id=other.job_id))

        self.assertEqual(fail_stuck_jobs(), 1)
        self.assert_failed(job)
        self.assert_running(other)

    def test_a_per_item_task_names_its_job_by_position(self) -> None:
        # handle_file_group(user, file_paths, job_id)
        job = self.silent_job()
        hold(queue_task(self.user.pk, ["/photos/a.jpg"], uuid.UUID(job.job_id)))

        self.assertEqual(fail_stuck_jobs(), 0)
        self.assert_running(job)

    def test_a_job_chained_after_a_held_task_waits_for_it(self) -> None:
        # Train Faces after Find Similar Faces: queued long ago, not started.
        running, waiting = self.silent_job(), self.silent_job()
        J.objects.filter(pk=waiting.pk).update(started_at=None)
        async_chain(
            [
                ("math.floor", (self.user.pk,), {"job_id": running.job_id}),
                ("math.floor", (self.user.pk,), {"job_id": waiting.job_id}),
            ]
        )
        [task_id] = OrmQ.objects.values_list("pk", flat=True)
        hold(task_id)

        self.assertEqual(fail_stuck_jobs(), 0)
        self.assert_running(running)
        self.assert_running(waiting)

    def test_skips_a_task_it_cannot_read(self) -> None:
        job = self.silent_job()
        hold(get_broker().enqueue("not a signed payload"))

        self.assertEqual(fail_stuck_jobs(), 1)
        self.assert_failed(job)

    def test_the_cleanup_service_replaces_the_schedule_of_the_model_method(
        self,
    ) -> None:
        # Every install up to 1.4.0 has it.
        Schedule.objects.create(func=OLD_STUCK_JOBS_FUNC, schedule_type=Schedule.HOURLY)

        call_command("start_job_cleanup_service")
        call_command("start_job_cleanup_service")

        self.assertFalse(Schedule.objects.filter(func=OLD_STUCK_JOBS_FUNC).exists())
        schedule = Schedule.objects.get(func=STUCK_JOBS_FUNC)
        self.assertEqual(Schedule.HOURLY, schedule.schedule_type)
