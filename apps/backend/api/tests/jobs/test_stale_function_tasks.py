"""A queued task naming a function this release moved leaves the queue unrun.

The reports from 1.6.0: about 60 error reports "Failed
'api.services.check_services' (<task name>) - Function
api.services.check_services is not defined", and the same for
``cleanup_deleted_photos``. #2335 moved both; migrations 0157 and 0158 point
their schedules at the new paths, but the tasks those schedules had already
queued still name the old ones. A schedule queues its function as a dotted
path, which unpickles fine, so the broker handed each such task to a worker,
which failed it, and every one became an error report of its own.
"""

import datetime
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone
from django_q.brokers import orm as orm_module
from django_q.models import Failure, OrmQ
from django_q.tasks import async_task

from api.jobs import broker as broker_module
from api.jobs.broker import ReleaseGuardedORM

LIST_KEY = "stale-function-test"
MOVED = "api.services.check_services"


def queue_scheduled(func: str, cluster: ReleaseGuardedORM) -> int:
    """Queue ``func`` the way a schedule does: by its dotted path."""
    async_task(func, broker=cluster, task_name="magazine-xray-jupiter-fix")
    queued = OrmQ.objects.get(key=LIST_KEY, payload__isnull=False)
    OrmQ.objects.filter(pk=queued.pk).update(
        lock=timezone.now() - datetime.timedelta(seconds=1)
    )
    return queued.pk


class StaleFunctionTaskTest(TestCase):
    def setUp(self) -> None:
        for sleep in (
            patch.object(broker_module.time, "sleep"),
            patch.object(orm_module, "sleep"),
        ):
            sleep.start()
            self.addCleanup(sleep.stop)
        self.cluster = ReleaseGuardedORM(list_key=LIST_KEY)

    def test_a_task_of_a_moved_function_is_not_handed_to_a_worker(self) -> None:
        task_id = queue_scheduled(MOVED, self.cluster)

        with self.assertLogs("api.jobs.broker", "WARNING"):
            taken = self.cluster.dequeue()

        self.assertEqual(taken, [])
        self.assertFalse(OrmQ.objects.filter(pk=task_id).exists())
        self.assertNotIn(task_id, self.cluster._held)

    def test_it_is_recorded_as_failed_with_the_missing_path(self) -> None:
        queue_scheduled(MOVED, self.cluster)

        with self.assertLogs("api.jobs.broker", "WARNING"):
            self.cluster.dequeue()

        failure = Failure.objects.get()
        self.assertEqual(failure.name, "magazine-xray-jupiter-fix")
        self.assertEqual(failure.func, MOVED)
        self.assertIn(f"{MOVED} no longer exists", failure.result)

    def test_it_is_logged_once_as_a_warning_not_an_error(self) -> None:
        # An expected leftover of an upgrade: an error would be reported.
        queue_scheduled(MOVED, self.cluster)

        with self.assertLogs("api.jobs.broker", "DEBUG") as logs:
            self.cluster.dequeue()

        self.assertEqual([record.levelname for record in logs.records], ["WARNING"])
        self.assertIn(MOVED, logs.output[0])

    def test_a_task_of_an_existing_function_is_handed_out(self) -> None:
        task_id = queue_scheduled("api.runtime.supervisor.check_services", self.cluster)

        taken = self.cluster.dequeue() or []

        self.assertEqual([pk for pk, _payload in taken], [task_id])
        self.assertFalse(Failure.objects.exists())
