"""Cancelling a job drops only its waiting tasks from the queue (B5).

``remove_queued_tasks`` deleted every row whose arguments named the job: also
one a cluster had taken, whose worker runs on regardless and acknowledges it,
and the head of a chain, which took the chain's later jobs with it: their
rows stayed queued, with no task left to run them.
"""

import datetime
import uuid

from django.test import TestCase
from django.utils import timezone
from django_q.brokers import get_broker
from django_q.models import OrmQ
from django_q.signing import SignedPackage
from django_q.tasks import async_chain

from api.jobs.broker import LEASE
from api.jobs.queue import remove_queued_tasks


def queue_task(*args: object, **kwargs: object) -> int:
    payload = SignedPackage.dumps(
        {"id": "t1", "name": "t1", "func": "math.floor", "args": args, "kwargs": kwargs}
    )
    task_id: int = get_broker().enqueue(payload)
    OrmQ.objects.filter(pk=task_id).update(
        lock=timezone.now() - datetime.timedelta(seconds=1)
    )
    return task_id


class RemoveQueuedTasksTest(TestCase):
    def setUp(self) -> None:
        self.job_id = str(uuid.uuid4())

    def remaining(self) -> list[int]:
        return list(OrmQ.objects.order_by("pk").values_list("pk", flat=True))

    def test_drops_the_waiting_tasks_of_the_job(self) -> None:
        mine = [queue_task(1, job_id=self.job_id), queue_task(uuid.UUID(self.job_id))]
        other = queue_task(1, job_id=str(uuid.uuid4()))

        self.assertEqual(remove_queued_tasks(self.job_id), len(mine))
        self.assertEqual(self.remaining(), [other])

    def test_leaves_a_task_a_cluster_has_taken(self) -> None:
        running = queue_task(1, job_id=self.job_id)
        OrmQ.objects.filter(pk=running).update(lock=timezone.now() + LEASE)

        self.assertEqual(remove_queued_tasks(self.job_id), 0)
        self.assertEqual(self.remaining(), [running])

    def test_leaves_a_chain_whose_later_steps_are_other_jobs(self) -> None:
        async_chain(
            [
                ("math.floor", (1,), {"job_id": self.job_id}),
                ("math.floor", (1,), {"job_id": str(uuid.uuid4())}),
            ]
        )

        self.assertEqual(remove_queued_tasks(self.job_id), 0)
        self.assertEqual(len(self.remaining()), 1)
