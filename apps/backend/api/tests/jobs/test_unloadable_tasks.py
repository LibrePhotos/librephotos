"""A queued task that this release cannot load fails instead of stopping the queue (#2945).

The incident: an update removed ``api.views.upload.generate_captions_wrapper``
(#2806) and moved ``api.ml_models`` (#2335) while tasks naming them were still
queued. django-q stores a task as a pickled reference to its function, so
opening such a task raises, the pusher logged "Failed to pull task from
broker" and died, and the sentinel restarted it, every 10 seconds, forever:
no queued work ran again until someone deleted the task by hand.
"""

import datetime
import queue
import types
import uuid
from collections.abc import Callable
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone
from django_q import core_signing
from django_q import pusher as pusher_module
from django_q.brokers import orm as orm_module
from django_q.conf import Conf
from django_q.models import Failure, OrmQ
from django_q.pusher import pusher
from django_q.signing import SignedPackage

from api.jobs import broker as broker_module
from api.jobs.broker import LEASE, ReleaseGuardedORM
from api.tests.stubs import stub_modules
from api.views import upload

LIST_KEY = "unloadable-test"


def due(task_id: int) -> int:
    # Due now: a task is taken once its lock is in the past, and on Windows
    # the next clock reading can still equal the enqueue time.
    OrmQ.objects.filter(pk=task_id).update(
        lock=timezone.now() - datetime.timedelta(seconds=1)
    )
    return task_id


def queue_payload(payload: str) -> int:
    task_id: int = ReleaseGuardedORM(list_key=LIST_KEY).enqueue(payload)
    return due(task_id)


def task_calling(func: Callable[..., object] | str, name: str, **fields: object) -> str:
    package: str = SignedPackage.dumps(
        {
            "id": uuid.uuid4().hex,
            "name": name,
            "func": func,
            "args": (),
            "kwargs": {},
            **fields,
        }
    )
    return package


def renamed(func: Callable[[], None], module: str, name: str) -> Callable[[], None]:
    """``func`` as pickle sees a function ``name`` in ``module``."""
    func.__module__ = module
    func.__name__ = func.__qualname__ = name
    return func


def queue_removed_function_task() -> int:
    """A task of ``generate_captions_wrapper``, queued before #2806 removed it."""

    def wrapper() -> None:
        pass

    func = renamed(wrapper, "api.views.upload", "generate_captions_wrapper")
    with patch.object(upload, "generate_captions_wrapper", func, create=True):
        payload = task_calling(func, "captions", kwargs={"job_id": "a-job"})
    return queue_payload(payload)


def queue_moved_module_task() -> int:
    """A task of ``api.ml_models.download_models``, queued before #2335 moved it."""

    def download() -> None:
        pass

    func = renamed(download, "api.ml_models", "download_models")
    module = types.ModuleType("api.ml_models")
    setattr(module, "download_models", func)
    with stub_modules({"api.ml_models": module}):
        payload = task_calling(func, "models")
    return queue_payload(payload)


def queue_good_task() -> int:
    return queue_payload(task_calling("math.floor", "good", args=(1.5,)))


class Geolocated:
    """A model whose method a queued task named, until an update removed it."""

    def _geolocate(self) -> None:
        pass


def queue_removed_method_task() -> int:
    """A task of a bound method, ``photo._geolocate`` on the incident's instance.

    Pickle stores a bound method as ``getattr(instance, name)``, so opening it
    raises in that call, not while looking up a class.
    """
    return queue_payload(task_calling(Geolocated()._geolocate, "geolocate"))


class _StopOnceDelivered:
    """The pusher's stop event: set once a task reached the workers, or after a few pulls."""

    def __init__(self, delivered: queue.Queue[dict[str, object]]) -> None:
        self.delivered = delivered
        self.pulls = 0

    def is_set(self) -> bool:
        self.pulls += 1
        return not self.delivered.empty() or self.pulls >= 5


class UnloadableTaskTest(TestCase):
    def setUp(self) -> None:
        # The pusher's wait after a failed pull and the idle waits of an empty queue.
        for sleep in (
            patch.object(pusher_module, "sleep"),
            patch.object(broker_module.time, "sleep"),
            patch.object(orm_module, "sleep"),
        ):
            sleep.start()
            self.addCleanup(sleep.stop)

    def run_pusher(self) -> list[dict[str, object]]:
        """Run the cluster's pusher until it delivered a task; the tasks it delivered."""
        delivered: queue.Queue[dict[str, object]] = queue.Queue()
        pusher(delivered, _StopOnceDelivered(delivered), ReleaseGuardedORM(LIST_KEY))
        return [delivered.get() for _ in range(delivered.qsize())]

    def test_the_pusher_keeps_pulling_past_a_task_whose_function_was_removed(
        self,
    ) -> None:
        bad = queue_removed_function_task()
        queue_good_task()

        # The broker's own log line is the next test's.
        with (
            self.assertLogs("django-q", "INFO") as pusher_logs,
            patch.object(broker_module, "logger"),
        ):
            delivered = self.run_pusher()

        self.assertEqual([task["name"] for task in delivered], ["good"])
        self.assertNotIn(
            "Failed to pull task from broker", "\n".join(pusher_logs.output)
        )
        self.assertFalse(OrmQ.objects.filter(pk=bad).exists())

    def test_a_task_that_cannot_be_loaded_is_recorded_as_failed_and_logged_once(
        self,
    ) -> None:
        bad = queue_removed_function_task()
        good = queue_good_task()
        cluster = ReleaseGuardedORM(list_key=LIST_KEY)

        with (
            patch.object(Conf, "BULK", 2),
            self.assertLogs("api.jobs.broker", "ERROR") as logs,
        ):
            taken = cluster.dequeue() or []

        self.assertEqual([pk for pk, _payload in taken], [good])
        self.assertEqual(len(logs.records), 1)
        self.assertIn(str(bad), logs.output[0])
        self.assertFalse(OrmQ.objects.filter(pk=bad).exists())
        failure = Failure.objects.get()
        self.assertEqual(failure.name, "captions")
        self.assertEqual(failure.func, "api.views.upload.generate_captions_wrapper")
        self.assertEqual(failure.kwargs, {"job_id": "a-job"})
        self.assertIn(
            "api.views.upload.generate_captions_wrapper no longer exists",
            failure.result,
        )
        # Not held: the lease thread has nothing to renew for it.
        self.assertNotIn(bad, cluster._held)

    def test_a_task_of_a_module_that_moved_is_recorded_as_failed(self) -> None:
        bad = queue_moved_module_task()

        with self.assertLogs("api.jobs.broker", "ERROR"):
            self.assertEqual(ReleaseGuardedORM(list_key=LIST_KEY).dequeue(), [])

        self.assertFalse(OrmQ.objects.filter(pk=bad).exists())
        failure = Failure.objects.get()
        self.assertEqual(failure.func, "api.ml_models.download_models")
        self.assertIn("api.ml_models.download_models no longer exists", failure.result)

    def test_a_payload_that_does_not_unpickle_at_all_is_recorded_as_failed(
        self,
    ) -> None:
        class NotAPickle:
            def dumps(self, obj: object) -> bytes:
                return b"not a pickle"

        bad = queue_payload(
            core_signing.dumps(
                {}, key=Conf.SECRET_KEY, salt=Conf.PREFIX, serializer=NotAPickle
            )
        )

        with self.assertLogs("api.jobs.broker", "ERROR"):
            self.assertEqual(ReleaseGuardedORM(list_key=LIST_KEY).dequeue(), [])

        self.assertFalse(OrmQ.objects.filter(pk=bad).exists())
        self.assertIn("could not be loaded", Failure.objects.get().result)

    def test_a_task_of_a_method_that_was_removed_is_recorded_as_failed(
        self,
    ) -> None:
        bad = queue_removed_method_task()
        good = queue_good_task()
        method = Geolocated.__dict__["_geolocate"]
        delattr(Geolocated, "_geolocate")
        self.addCleanup(setattr, Geolocated, "_geolocate", method)

        with (
            patch.object(Conf, "BULK", 2),
            self.assertLogs("api.jobs.broker", "ERROR"),
        ):
            taken = ReleaseGuardedORM(list_key=LIST_KEY).dequeue() or []

        self.assertEqual([pk for pk, _payload in taken], [good])
        self.assertFalse(OrmQ.objects.filter(pk=bad).exists())
        self.assertIn("could not be loaded", Failure.objects.get().result)

    def test_the_task_is_still_removed_when_recording_it_fails(self) -> None:
        bad = queue_removed_function_task()
        good = queue_good_task()

        with (
            patch.object(Conf, "BULK", 2),
            patch.object(broker_module, "save_task", side_effect=RuntimeError("db")),
            self.assertLogs("api.jobs.broker", "ERROR"),
        ):
            taken = ReleaseGuardedORM(list_key=LIST_KEY).dequeue() or []

        self.assertEqual([pk for pk, _payload in taken], [good])
        self.assertFalse(OrmQ.objects.filter(pk=bad).exists())

    def test_a_queue_stuck_on_such_a_task_recovers_once_its_lease_runs_out(
        self,
    ) -> None:
        # Already-stuck instances: the dead pusher of the old release had
        # taken the task, so it is locked for one lease; the fixed release
        # drops it as soon as it is due again, with no manual database work.
        bad = queue_removed_function_task()
        OrmQ.objects.filter(pk=bad).update(lock=timezone.now() + LEASE)
        good = queue_good_task()
        cluster = ReleaseGuardedORM(list_key=LIST_KEY)
        self.assertEqual([pk for pk, _ in cluster.dequeue() or []], [good])

        later = timezone.now() + LEASE + datetime.timedelta(seconds=1)
        with (
            patch("django.utils.timezone.now", return_value=later),
            self.assertLogs("api.jobs.broker", "ERROR"),
        ):
            self.assertEqual(cluster.dequeue(), [])

        self.assertFalse(OrmQ.objects.filter(pk=bad).exists())
