import uuid

from django.test import TestCase

from api.jobs import store
from api.jobs.queue import JobStep, enqueue_chain, remove_queued_tasks
from api.models import LongRunningJob, QueuedTask
from api.models.task_queue import CANCELLED, QUEUED, RUNNING
from api.tests.utils import create_test_user


def per_photo(photo_id: str, job_id: str) -> None:
    return None


def step(user: object, job_id: str) -> None:
    return None


class RemoveQueuedTasksTest(TestCase):
    def setUp(self) -> None:
        self.job_id = str(uuid.uuid4())

    def test_drops_the_waiting_tasks_of_the_job(self) -> None:
        mine = [
            store.add(per_photo, (1,), {"job_id": self.job_id}),
            store.add(per_photo, (2, uuid.UUID(self.job_id))),
        ]
        other = store.add(per_photo, (1,), {"job_id": str(uuid.uuid4())})

        self.assertEqual(len(mine), remove_queued_tasks(self.job_id))
        statuses = dict(QueuedTask.objects.values_list("pk", "status"))
        self.assertEqual(
            {mine[0].pk: CANCELLED, mine[1].pk: CANCELLED, other.pk: QUEUED}, statuses
        )

    def test_leaves_a_task_a_worker_has_taken(self) -> None:
        store.add(per_photo, (1,), {"job_id": self.job_id})
        running = store.claim("w", ["default"])

        self.assertEqual(0, remove_queued_tasks(self.job_id))
        self.assertEqual(RUNNING, QueuedTask.objects.get(pk=running.pk).status)

    def test_cancelling_a_chain_step_cancels_the_steps_after_it(self) -> None:
        user = create_test_user()
        first, second = enqueue_chain(
            user,
            [
                JobStep(LongRunningJob.JOB_SCAN_FACES, step, (user,)),
                JobStep(LongRunningJob.JOB_CLUSTER_ALL_FACES, step, (user,)),
            ],
        )

        self.assertEqual(1, remove_queued_tasks(first.job_id))

        second.refresh_from_db()
        self.assertTrue(second.cancelled)
        self.assertEqual(
            {CANCELLED}, set(QueuedTask.objects.values_list("status", flat=True))
        )
