from collections.abc import Callable
from unittest.mock import patch

from django.db import DatabaseError, OperationalError
from django.test import TestCase

from api.jobs import store
from api.jobs.pool import Pool, PoolSettings
from api.jobs.worker import MAX_DATABASE_BACKOFF_SECONDS, Worker
from api.jobs.worker_settings import WorkerSettings
from api.models import QueuedTask

CALLS: list[str] = []


def record(value: str) -> None:
    CALLS.append(value)


class Never:
    def is_set(self) -> bool:
        return False


def _worker() -> Worker:
    return Worker(0, Never(), [4, 4], WorkerSettings(poll_seconds=1.0))


def _failing_first(
    real: Callable[..., QueuedTask | None], errors: list[Exception]
) -> Callable[..., QueuedTask | None]:
    def claim(*args: object, **kwargs: object) -> QueuedTask | None:
        if errors:
            raise errors.pop(0)
        return real(*args, **kwargs)

    return claim


class WorkerDatabaseErrorTest(TestCase):
    def setUp(self):
        CALLS.clear()

    def test_a_failed_claim_is_a_warning_and_the_next_claim_runs_the_task(self):
        store.add(record, ("after the error",))
        worker = _worker()
        errors: list[Exception] = [DatabaseError("database disk image is malformed")]

        with (
            patch.object(store, "claim", _failing_first(store.claim, errors)),
            self.assertLogs("api.jobs.worker", "WARNING") as logs,
        ):
            self.assertFalse(worker.run_one())
            self.assertTrue(worker.run_one())

        self.assertIn("database disk image is malformed", logs.output[0])
        self.assertTrue(all(line.startswith("WARNING") for line in logs.output))
        self.assertEqual(["after the error"], CALLS)
        self.assertFalse(QueuedTask.objects.exists())

    def test_the_wait_grows_while_the_database_keeps_failing_and_resets_after(self):
        worker = _worker()
        waits: list[float] = []
        with (
            patch.object(store, "claim", side_effect=OperationalError("locked")),
            self.assertLogs("api.jobs.worker", "WARNING"),
        ):
            for _ in range(10):
                self.assertFalse(worker.run_one())
                waits.append(worker.idle_seconds())

        self.assertEqual(sorted(waits), waits)
        self.assertGreater(waits[-1], waits[0])
        self.assertEqual(MAX_DATABASE_BACKOFF_SECONDS, waits[-1])

        self.assertFalse(worker.run_one())
        self.assertEqual(1.0, worker.idle_seconds())

    def test_a_task_whose_end_cannot_be_recorded_does_not_stop_the_worker(self):
        store.add(record, ("ran",))
        worker = _worker()

        with (
            patch.object(store, "succeed", side_effect=DatabaseError("malformed")),
            self.assertLogs("api.jobs.worker", "WARNING") as logs,
        ):
            self.assertTrue(worker.run_one())

        self.assertEqual(["ran"], CALLS)
        self.assertIsNone(worker.running.task)
        self.assertIn(
            "api.tests.jobs.test_worker_database_errors.record", logs.output[0]
        )


class DeadProcess:
    pid = 4242
    exitcode = -9

    def join(self, timeout: float | None = None) -> None:
        return None


class DeadWorkerWarningTest(TestCase):
    def test_a_killed_worker_is_a_warning_that_names_its_task(self):
        pool = Pool(PoolSettings(workers=1))
        store.add(record, ("killed",))
        store.claim(pool.worker_name(0, DeadProcess.pid), ["default"])
        pool.processes[0] = DeadProcess()

        with self.assertLogs("api.jobs.pool", "WARNING") as logs:
            pool.replace(0, DeadProcess())

        self.assertEqual(1, len(logs.output))
        self.assertTrue(logs.output[0].startswith("WARNING"))
        self.assertIn("exited with -9", logs.output[0])
        self.assertIn(
            "api.tests.jobs.test_worker_database_errors.record", logs.output[0]
        )
