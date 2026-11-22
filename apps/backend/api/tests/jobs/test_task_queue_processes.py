import multiprocessing
import subprocess
import sys
import tempfile
from collections import Counter
from pathlib import Path

from django.db import connection
from django.test import TestCase, TransactionTestCase

import api
from api.tests.jobs import multiprocess_queue
from librephotos.settings._sqlite import sqlite_database

WORKERS = 4
TASKS = 1000
LEASE_SECONDS = 2.0


class RealProcessesClaimTest(TransactionTestCase):
    def setUp(self):
        self.context = multiprocessing.get_context("spawn")
        self.out_dir = tempfile.mkdtemp()
        if connection.vendor == "sqlite":
            self.database = sqlite_database(str(Path(self.out_dir) / "queue.sqlite3"))
        else:
            self.database = {"NAME": connection.settings_dict["NAME"]}

    def _start(self, target, *args):
        process = self.context.Process(target=target, args=(self.database, *args))
        process.start()
        return process

    def _enqueue(self, tasks: int) -> None:
        if connection.vendor == "sqlite":
            setup = self._start(multiprocess_queue.prepare_sqlite, tasks, self.out_dir)
            setup.join(120)
            self.assertEqual(0, setup.exitcode)
        else:
            multiprocess_queue.enqueue(tasks, self.out_dir)

    def _runs(self) -> tuple[Counter[int], int]:
        runs: Counter[int] = Counter()
        files = list(Path(self.out_dir).glob("runs-*.txt"))
        for path in files:
            runs.update(int(line) for line in path.read_text(encoding="ascii").split())
        return runs, len(files)

    def _workers(self, count: int, seconds: float):
        return [
            self._start(multiprocess_queue.run_worker, slot, seconds, LEASE_SECONDS)
            for slot in range(count)
        ]

    def test_every_task_runs_once_across_processes(self):
        self._enqueue(TASKS)

        workers = self._workers(WORKERS, 240)
        for worker in workers:
            worker.join(300)

        runs, processes = self._runs()
        self.assertEqual([0] * WORKERS, [worker.exitcode for worker in workers])
        self.assertEqual(set(range(TASKS)), set(runs))
        self.assertEqual({1}, set(runs.values()))
        self.assertGreater(processes, 1)

    def test_a_task_whose_worker_died_runs_again_once(self):
        self._enqueue(0)
        if connection.vendor == "sqlite":
            enqueue = self._start(_enqueue_crash_sqlite, self.out_dir)
            enqueue.join(60)
        else:
            multiprocess_queue.enqueue_crash(self.out_dir)

        crashing = self._start(multiprocess_queue.run_worker, 0, 60, LEASE_SECONDS)
        crashing.join(90)
        survivor = self._start(multiprocess_queue.run_worker, 1, 60, LEASE_SECONDS)
        survivor.join(90)

        runs, _ = self._runs()
        self.assertTrue((Path(self.out_dir) / "crashed").exists())
        self.assertEqual((9, 0), (crashing.exitcode, survivor.exitcode))
        self.assertEqual(1, runs[-1])


def _enqueue_crash_sqlite(database, out_dir):
    multiprocess_queue.configure(database, 600)
    multiprocess_queue.enqueue_crash(out_dir)


class SpawnEntryTest(TestCase):
    def test_the_worker_entry_loads_no_model_before_django_is_set_up(self):
        script = (
            "import sys, api.jobs.worker_entry; sys.exit('api.models' in sys.modules)"
        )
        backend = Path(api.__file__).resolve().parent.parent
        completed = subprocess.run(
            [sys.executable, "-c", script], cwd=backend, check=False
        )

        self.assertEqual(0, completed.returncode)
