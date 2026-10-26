"""A cluster holds the tasks it took on a lease (#2852).

The incident: a ``docker compose up -d`` recreated the backend 1h46m into a
scan of 175,368 file groups. The new cluster worked through the rest of the
queue and then sat at 175,313 for hours: the 55 groups the old cluster had
taken were locked in ``django_q_ormq`` for ``Q_CLUSTER["retry"]``, about 231
days, so the scan never finished and never queued its follow-ups.
"""

import datetime
from contextlib import AbstractContextManager
from multiprocessing import Queue
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone
from django_q.brokers import orm as orm_module
from django_q.brokers.orm import ORM
from django_q.models import OrmQ
from django_q.monitor import monitor
from django_q.signing import SignedPackage

from api.jobs import broker as broker_module
from api.jobs.broker import LEASE, ReleaseGuardedORM

LIST_KEY = "lease-test"


def queue_task(broker: ORM, **fields: object) -> int:
    payload = SignedPackage.dumps(
        {
            "id": "t1",
            "name": "t1",
            "func": "math.floor",
            "args": (1.5,),
            "kwargs": {},
            **fields,
        }
    )
    task_id: int = broker.enqueue(payload)
    # Due now: a task is taken once its lock is in the past, and on Windows
    # the next clock reading can still equal the enqueue time.
    OrmQ.objects.filter(pk=task_id).update(
        lock=timezone.now() - datetime.timedelta(seconds=1)
    )
    return task_id


def taken_ids(broker: ORM) -> list[int]:
    return [pk for pk, _payload in broker.dequeue() or []]


class TaskLeaseTest(TestCase):
    def setUp(self) -> None:
        # The idle waits of an empty queue.
        for sleep in (
            patch.object(broker_module.time, "sleep"),
            patch.object(orm_module, "sleep"),
        ):
            sleep.start()
            self.addCleanup(sleep.stop)
        self.start = timezone.now()

    def at(self, minutes: float) -> AbstractContextManager[object]:
        """Run the block ``minutes`` after the test started."""
        later = self.start + datetime.timedelta(minutes=minutes)
        return patch("django.utils.timezone.now", return_value=later)

    def test_plain_orm_broker_strands_the_tasks_of_a_cluster_that_went_away(
        self,
    ) -> None:
        # The bug: locked for Q_CLUSTER["retry"], about 231 days.
        old_cluster = ORM(list_key=LIST_KEY)
        task_id = queue_task(old_cluster)
        self.assertEqual(taken_ids(old_cluster), [task_id])

        with self.at(minutes=24 * 60):
            self.assertEqual(taken_ids(ORM(list_key=LIST_KEY)), [])

    def test_the_tasks_of_a_cluster_that_went_away_run_again(self) -> None:
        old_cluster = ReleaseGuardedORM(list_key=LIST_KEY)
        task_id = queue_task(old_cluster)
        self.assertEqual(taken_ids(old_cluster), [task_id])
        # The old cluster is gone: it never renews, nor acknowledges.

        new_cluster = ReleaseGuardedORM(list_key=LIST_KEY)
        self.assertEqual(taken_ids(new_cluster), [])
        with self.at(minutes=LEASE.total_seconds() / 60 + 1):
            self.assertEqual(taken_ids(new_cluster), [task_id])

    def test_a_live_cluster_keeps_the_tasks_it_holds(self) -> None:
        cluster = ReleaseGuardedORM(list_key=LIST_KEY)
        task_id = queue_task(cluster)
        self.assertEqual(taken_ids(cluster), [task_id])
        other = ReleaseGuardedORM(list_key=LIST_KEY)

        with self.at(minutes=8):
            cluster.renew_leases()
        with self.at(minutes=12):
            self.assertEqual(taken_ids(other), [])
        # Nine minutes after the last renewal: still held.
        with self.at(minutes=17):
            self.assertEqual(taken_ids(other), [])
        # The cluster died after that renewal: the lease ran out.
        with self.at(minutes=19):
            self.assertEqual(taken_ids(other), [task_id])

    def test_a_finished_task_is_no_longer_held(self) -> None:
        cluster = ReleaseGuardedORM(list_key=LIST_KEY)
        done, running = queue_task(cluster), queue_task(cluster)
        # One task a dequeue: Q_CLUSTER has no "bulk".
        self.assertEqual(taken_ids(cluster) + taken_ids(cluster), [done, running])

        cluster.acknowledge(done)
        cluster.renew_leases()

        self.assertEqual(cluster._held, {running})

    def test_locks_from_before_leases_are_cut_to_one_lease(self) -> None:
        # Taken by the release before this one, whose cluster is gone: locked
        # for Q_CLUSTER["retry"]. Any live cluster's renewal releases it.
        task_id = queue_task(ORM(list_key=LIST_KEY))
        ORM(list_key=LIST_KEY).dequeue()
        cluster = ReleaseGuardedORM(list_key=LIST_KEY)

        cluster.renew_leases()

        lock = OrmQ.objects.get(pk=task_id).lock
        self.assertLessEqual(lock, timezone.now() + LEASE)
        with self.at(minutes=LEASE.total_seconds() / 60 + 1):
            self.assertEqual(taken_ids(cluster), [task_id])

    def test_renews_only_its_own_queue(self) -> None:
        other_queue = ORM(list_key="another-queue")
        task_id = queue_task(other_queue)
        other_queue.dequeue()
        locked_until = OrmQ.objects.get(pk=task_id).lock

        ReleaseGuardedORM(list_key=LIST_KEY).renew_leases()

        self.assertEqual(OrmQ.objects.get(pk=task_id).lock, locked_until)

    def test_a_failed_task_leaves_the_queue(self) -> None:
        # The monitor deletes a task only on success unless the task says to
        # acknowledge its failure; otherwise its cluster would renew its lease
        # for good, and it would run again after every restart.
        cluster = ReleaseGuardedORM(list_key=LIST_KEY)
        task_id = queue_task(cluster)
        [(ack_id, payload)] = cluster.dequeue() or []
        task = SignedPackage.loads(payload)
        now = timezone.now()
        task.update(
            ack_id=ack_id, success=False, result="boom", started=now, stopped=now
        )
        results: Queue = Queue()
        results.put(task)
        results.put("STOP")

        monitor(results, cluster)

        self.assertFalse(OrmQ.objects.filter(pk=task_id).exists())

    def test_a_task_that_keeps_its_failures_queued_says_so(self) -> None:
        cluster = ReleaseGuardedORM(list_key=LIST_KEY)
        queue_task(cluster, ack_failure=False)

        [(_ack_id, payload)] = cluster.dequeue() or []

        self.assertIs(SignedPackage.loads(payload)["ack_failure"], False)

    def test_renews_from_one_thread_per_process(self) -> None:
        cluster = ReleaseGuardedORM(list_key=LIST_KEY)
        queue_task(cluster)
        queue_task(cluster)

        with (
            patch.object(broker_module.Conf, "TESTING", False),
            patch.object(broker_module.threading, "Thread") as thread,
        ):
            cluster.dequeue()
            cluster.dequeue()
            # A broker that only enqueues, as every web request builds one.
            queue_task(ReleaseGuardedORM(list_key=LIST_KEY))

        thread.assert_called_once()
        thread.return_value.start.assert_called_once()
