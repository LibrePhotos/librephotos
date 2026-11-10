"""``running()`` agrees with the stuck-job cleanup: a job the queue holds a task of is alive.

The cleanup leaves alone a job whose task still waits in the queue
(``held_job_ids``), but ``running()`` (exclusivity, ``/api/rqavailable/``)
read only progress and timestamps: a job queued for more than
``STUCK_JOB_HOURS`` behind another user's scan dropped out of it, so the same
job could be started a second time and the queue showed free. The hourly
cleanup now records when it found such a job's task in the queue, well
before the threshold, and that counts as a sign of life.
"""

import datetime
import uuid

from django.conf import settings
from django.test import TestCase
from django.utils import timezone
from django_q.brokers import get_broker
from django_q.signing import SignedPackage
from rest_framework.test import APIClient

from api.jobs.cleanup import fail_stuck_jobs
from api.models import LongRunningJob
from api.tests.utils import create_test_job, create_test_user

J = LongRunningJob


def queue_task(*args: object, **kwargs: object) -> int:
    payload = SignedPackage.dumps(
        {"id": "t1", "name": "t1", "func": "math.floor", "args": args, "kwargs": kwargs}
    )
    task_id: int = get_broker().enqueue(payload)
    return task_id


def hours_ago(hours: float) -> datetime.datetime:
    return timezone.now() - datetime.timedelta(hours=hours)


class RunningAgreesWithTheQueueTest(TestCase):
    def setUp(self) -> None:
        self.user = create_test_user()

    def waiting_job(self, queued_hours_ago: float) -> J:
        job = create_test_job(
            self.user, J.JOB_GENERATE_TAGS, queued_at=hours_ago(queued_hours_ago)
        )
        queue_task(self.user.pk, job_id=job.job_id)
        return job

    def test_a_job_waiting_past_the_threshold_still_runs(self) -> None:
        job = self.waiting_job(settings.STUCK_JOB_HOURS + 1)

        fail_stuck_jobs()

        self.assertIn(job, J.objects.running())
        self.assertNotIn(job, J.objects.stuck())

    def test_a_waiting_job_is_seen_before_it_would_drop_out(self) -> None:
        # Half the threshold: the hourly cleanup refreshes it long before.
        job = self.waiting_job(settings.STUCK_JOB_HOURS / 2 + 1)

        fail_stuck_jobs()

        job.refresh_from_db()
        self.assertIsNotNone(job.queue_seen_at)
        self.assertNotIn(job, J.objects.stuck(1))

    def test_it_holds_the_queue_and_refuses_a_second_start(self) -> None:
        job = self.waiting_job(settings.STUCK_JOB_HOURS + 1)
        fail_stuck_jobs()
        client = APIClient()
        client.force_authenticate(user=self.user)

        availability = client.get("/api/rqavailable/").json()

        self.assertFalse(availability["queue_can_accept_job"])
        self.assertEqual(availability["job_detail"]["job_id"], job.job_id)

    def test_a_job_no_task_names_still_drops_out_and_fails(self) -> None:
        job = create_test_job(
            self.user,
            J.JOB_GENERATE_TAGS,
            queued_at=hours_ago(settings.STUCK_JOB_HOURS + 1),
        )
        queue_task(self.user.pk, job_id=str(uuid.uuid4()))

        self.assertNotIn(job, J.objects.running())
        self.assertEqual(fail_stuck_jobs(), 1)
