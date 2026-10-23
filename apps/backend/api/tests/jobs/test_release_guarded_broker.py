"""A cluster takes no tasks once a newer release has migrated the database.

The incident: a rolling deploy of the unified image kept the old container
running while the new one migrated and wrote its startup schedules. Their first
run went to the old cluster, whose worker could not find the functions:

    Failed 'api.updates.check.check_for_updates' - Function
    api.updates.check.check_for_updates is not defined

``api.jobs.broker.ReleaseGuardedORM`` leaves such tasks in the queue for the
new release's cluster.
"""

import datetime
import pickle
import pydoc
from unittest.mock import patch

from django.db import connection
from django.db.migrations.recorder import MigrationRecorder
from django.test import TestCase
from django.utils import timezone
from django_q.brokers import get_broker
from django_q.brokers.orm import ORM
from django_q.models import OrmQ
from django_q.signing import SignedPackage

from api.jobs import broker as broker_module
from api.jobs.broker import RECHECK_SECONDS, ReleaseGuardedORM

LIST_KEY = "release-guard-test"
# A task of the newer release: its module does not exist in this code.
NEWER_RELEASE_FUNC = "api.not_in_this_release.task"


def queue_newer_release_task(broker: ORM) -> int:
    payload = SignedPackage.dumps(
        {"id": "t1", "name": "t1", "func": NEWER_RELEASE_FUNC}
    )
    task_id: int = broker.enqueue(payload)
    # Due now: a task is taken once its lock is in the past, and on Windows
    # the next clock reading can still equal the enqueue time.
    unlock(task_id)
    return task_id


def unlock(task_id: int) -> None:
    """Put a taken task back, as its lock running out would."""
    OrmQ.objects.filter(pk=task_id).update(
        lock=timezone.now() - datetime.timedelta(seconds=1)
    )


class ReleaseGuardedBrokerTest(TestCase):
    def setUp(self) -> None:
        self.recorder = MigrationRecorder(connection)
        sleep = patch.object(broker_module.time, "sleep")
        self.sleep = sleep.start()
        self.addCleanup(sleep.stop)

    def newer_release_migrates(self) -> None:
        self.recorder.record_applied("api", "9999_from_a_newer_release")

    def test_plain_orm_broker_hands_a_newer_release_task_to_an_older_cluster(
        self,
    ) -> None:
        # The bug: the old cluster takes the task, and its worker's lookup
        # (pydoc.locate) finds nothing, so it fails "is not defined".
        plain = ORM(list_key=LIST_KEY)
        self.newer_release_migrates()
        queue_newer_release_task(plain)

        taken = plain.dequeue()

        self.assertEqual(len(taken), 1)
        task = SignedPackage.loads(taken[0][1])
        self.assertIsNone(pydoc.locate(task["func"]))

    def test_takes_no_task_once_a_newer_release_migrated_the_database(self) -> None:
        guarded = ReleaseGuardedORM(list_key=LIST_KEY)
        self.newer_release_migrates()
        task_id = queue_newer_release_task(guarded)

        with self.assertLogs("api.jobs.broker", "WARNING") as logs:
            self.assertIsNone(guarded.dequeue())

        self.assertIn("api.9999_from_a_newer_release", logs.output[0])
        # Left unlocked, so the newer release's cluster takes it right away.
        self.assertLessEqual(OrmQ.objects.get(pk=task_id).lock, timezone.now())
        self.sleep.assert_called_once()

    def test_takes_tasks_from_a_database_of_its_own_release(self) -> None:
        guarded = ReleaseGuardedORM(list_key=LIST_KEY)
        task_id = queue_newer_release_task(guarded)

        taken = guarded.dequeue() or []

        self.assertEqual([pk for pk, _payload in taken], [task_id])

    def test_looks_at_the_migrations_again_after_the_recheck_interval(self) -> None:
        guarded = ReleaseGuardedORM(list_key=LIST_KEY)
        task_id = queue_newer_release_task(guarded)
        clock = patch.object(broker_module.time, "monotonic", return_value=1000.0)
        monotonic = clock.start()
        self.addCleanup(clock.stop)

        self.assertTrue(guarded.dequeue())
        self.newer_release_migrates()
        unlock(task_id)

        # Within the interval the earlier answer stands.
        monotonic.return_value = 1000.0 + RECHECK_SECONDS - 1
        self.assertEqual(
            guarded.dequeue(), [(task_id, OrmQ.objects.get(pk=task_id).payload)]
        )
        unlock(task_id)

        monotonic.return_value = 1000.0 + RECHECK_SECONDS
        with self.assertLogs("api.jobs.broker", "WARNING"):
            self.assertIsNone(guarded.dequeue())

    def test_guards_in_the_process_it_is_pickled_into(self) -> None:
        # Without fork (Windows) the cluster pickles its broker into the pusher.
        guarded = pickle.loads(pickle.dumps(ReleaseGuardedORM(list_key=LIST_KEY)))
        self.newer_release_migrates()
        queue_newer_release_task(guarded)

        with self.assertLogs("api.jobs.broker", "WARNING"):
            self.assertIsNone(guarded.dequeue())

    def test_is_the_broker_every_process_builds(self) -> None:
        self.assertIsInstance(get_broker(), ReleaseGuardedORM)
