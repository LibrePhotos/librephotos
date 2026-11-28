import threading
from multiprocessing.context import SpawnProcess
from unittest import TestCase as PlainTestCase
from unittest.mock import Mock, patch

from constance import config
from constance.test import override_config
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from api.jobs import parallel
from api.jobs.pool import Pool, PoolSettings
from api.jobs.queue import enqueue_task
from api.jobs.worker import EXIT_PARKED, Worker
from api.jobs.worker_settings import WorkerSettings
from api.models import LongRunningJob, WorkerProcess
from api.runtime import supervisor
from api.runtime.capacity import (
    BALANCED,
    FAST,
    GENTLE,
    MB,
    Capacity,
    low_on_memory,
    plan_workers,
)
from api.tests.utils import create_test_job, create_test_user

GB = 1024 * MB


def machine(cores: int, total_gb: float, available_gb: float) -> Capacity:
    return Capacity(
        cores=cores,
        cpu_source="host",
        ram_total=int(total_gb * GB),
        ram_available=int(available_gb * GB),
        ram_source="host",
    )


class PlanTest(PlainTestCase):
    def plan(self, found, intention=BALANCED, sqlite=False, override=None):
        return plan_workers(found, intention, sqlite=sqlite, override=override)

    def test_the_worked_examples(self):
        cases = [
            ("raspberry pi 4 GB", machine(4, 4, 3), BALANCED, 1, "memory", False),
            ("vps 2 vcpu 8 GB", machine(2, 8, 6), BALANCED, 1, "intention", True),
            ("vps 4 vcpu 8 GB", machine(4, 8, 7), BALANCED, 2, "intention", True),
            ("vps 8 vcpu 16 GB", machine(8, 16, 14), BALANCED, 4, "intention", True),
            (
                "laptop 16 threads 32 GB",
                machine(16, 32, 21),
                BALANCED,
                4,
                "intention",
                True,
            ),
            ("laptop fast", machine(16, 32, 21), FAST, 8, "intention", True),
            ("gentle", machine(16, 32, 21), GENTLE, 1, "intention", True),
            (
                "container 2 GB on a big host",
                machine(32, 2, 1.5),
                FAST,
                1,
                "memory",
                False,
            ),
        ]
        for name, found, intention, workers, limited_by, fits in cases:
            with self.subTest(name):
                planned = self.plan(found, intention)
                self.assertEqual(
                    (workers, limited_by, fits),
                    (planned.workers, planned.limited_by, planned.fits),
                )
                self.assertGreaterEqual(planned.heavy_workers, 1)
                self.assertLessEqual(planned.heavy_workers, planned.workers)

    def test_sqlite_has_one_writer(self):
        planned = self.plan(machine(32, 128, 120), FAST, sqlite=True)

        self.assertEqual((4, "database"), (planned.workers, planned.limited_by))

    def test_worker_concurrency_wins(self):
        planned = self.plan(machine(4, 4, 1), FAST, override=6)

        self.assertEqual((6, "setting"), (planned.workers, planned.limited_by))

    def test_low_memory(self):
        self.assertTrue(low_on_memory(machine(4, 8, 0.4)))
        self.assertTrue(low_on_memory(machine(4, 64, 6)))
        self.assertFalse(low_on_memory(machine(4, 8, 4)))


class SizerTest(TestCase):
    def test_the_width_follows_the_intention_without_a_restart(self):
        sizer = parallel.Sizer(ceiling=8)
        with (
            override_settings(TASK_WORKERS=None),
            patch.object(parallel.capacity, "detect", return_value=machine(16, 32, 21)),
        ):
            with override_config(PARALLEL_WORKERS=GENTLE):
                self.assertEqual((1, 1), sizer())
            with override_config(PARALLEL_WORKERS=BALANCED):
                self.assertEqual(4, sizer()[0])

    def test_low_memory_takes_one_worker_away_a_round(self):
        sizer = parallel.Sizer(ceiling=4)
        tight = machine(16, 32, 1)
        with (
            override_settings(TASK_WORKERS=4),
            patch.object(parallel.capacity, "detect", return_value=tight),
        ):
            widths = [sizer()[0] for _ in range(5)]

        self.assertEqual([3, 2, 1, 1, 1], widths)

    def test_the_pool_hands_the_width_to_its_workers(self):
        pool = Pool(PoolSettings(workers=4, sizer=lambda: (9, 2)))

        pool.resize()

        self.assertEqual([4, 2], list(pool.limits))


class Never:
    def is_set(self) -> bool:
        return False


def gone_process(exitcode: int) -> Mock:
    process = Mock(spec=SpawnProcess, exitcode=exitcode)
    process.is_alive.return_value = False
    return process


class WorkersOutsideTheWidthTest(TestCase):
    def setUp(self):
        self.pool = Pool(PoolSettings(workers=8, sizer=lambda: (4, 1)))
        self.pool.resize()
        self.started: list[int] = []
        starting = patch.object(self.pool, "start_worker", side_effect=self.start)
        starting.start()
        self.addCleanup(starting.stop)

    def start(self, slot: int) -> None:
        self.started.append(slot)
        self.pool.processes[slot] = gone_process(0)

    def test_the_pool_starts_only_the_workers_of_its_width(self):
        self.pool.start_missing()

        self.assertEqual([0, 1, 2, 3], self.started)

    def test_a_worker_outside_the_width_stops_and_says_so(self):
        worker = Worker(5, Never(), [4, 1], WorkerSettings(poll_seconds=0.01))
        worker._register()

        self.assertEqual(EXIT_PARKED, worker._loop())
        self.assertFalse(WorkerProcess.objects.get(slot=5).active)

    def test_a_stopped_worker_starts_again_only_when_the_width_grows(self):
        self.pool.processes[5] = gone_process(EXIT_PARKED)

        self.pool.replace(5, self.pool.processes[5])
        self.pool.start_missing()
        self.assertEqual([0, 1, 2, 3], self.started)

        self.pool.limits[0] = 6
        self.pool.start_missing()
        self.assertEqual([0, 1, 2, 3, 4, 5], self.started)


class FastFirstImportTest(TestCase):
    def setUp(self):
        self.user = create_test_user()

    @override_config(PARALLEL_WORKERS=FAST)
    def test_fast_falls_back_once_the_queue_was_idle_after_a_library_scan(self):
        watcher = parallel.FastFirstImport(idle_seconds=0)
        enqueue_task(print)
        self.assertFalse(watcher())

        from api.models import QueuedTask

        QueuedTask.objects.all().delete()
        self.assertFalse(watcher())
        scan = create_test_job(self.user, LongRunningJob.JOB_SCAN_PHOTOS)
        scan.complete(result={LongRunningJob.LIBRARY_SCAN: True})

        self.assertTrue(watcher())
        self.assertEqual(BALANCED, config.PARALLEL_WORKERS)


class ParallelWorkersEndpointTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = create_test_user(is_admin=True)

    def test_admins_see_what_was_detected_and_what_each_intention_gives(self):
        self.client.force_authenticate(user=self.admin)
        with patch.object(parallel.capacity, "detect", return_value=machine(4, 8, 6)):
            body = self.client.get("/api/parallel-workers/").json()

        self.assertEqual(4, body["capacity"]["cores"])
        self.assertEqual(8192, body["capacity"]["ram_total_mb"])
        self.assertEqual(BALANCED, body["intention"])
        self.assertEqual(
            [GENTLE, BALANCED, FAST], [plan["intention"] for plan in body["plans"]]
        )

    def test_an_admin_picks_an_intention(self):
        self.client.force_authenticate(user=self.admin)

        response = self.client.patch(
            "/api/parallel-workers/", {"intention": FAST}, format="json"
        )
        refused = self.client.patch(
            "/api/parallel-workers/", {"intention": "turbo"}, format="json"
        )

        self.assertEqual(
            (200, FAST), (response.status_code, response.json()["intention"])
        )
        self.assertEqual(400, refused.status_code)
        self.assertEqual(FAST, config.PARALLEL_WORKERS)

    def test_other_users_get_nothing(self):
        self.client.force_authenticate(user=create_test_user())

        self.assertEqual(403, self.client.get("/api/parallel-workers/").status_code)
        self.assertEqual(
            403,
            self.client.patch(
                "/api/parallel-workers/", {"intention": FAST}, format="json"
            ).status_code,
        )


class SidecarWatchdogTest(TestCase):
    def test_the_supervisor_runs_the_watchdog_in_one_thread_at_a_time(self):
        started = threading.Event()
        release = threading.Event()
        runs = []

        def watchdog():
            runs.append(1)
            started.set()
            release.wait(5)

        pool = Pool(PoolSettings(workers=1, watchdog=watchdog))
        pool.watch_sidecars()
        started.wait(5)
        pool.watch_sidecars()
        release.set()
        defined_thread = pool.watching
        self.assertIsNotNone(defined_thread)
        defined_thread.join(5)

        self.assertEqual([1], runs)

    def test_each_host_watches_its_own_sidecars(self):
        with patch.object(
            supervisor.socket, "gethostname", side_effect=["host-a", "host-b"]
        ):
            keys = {supervisor.watch_key("tags"), supervisor.watch_key("tags")}

        self.assertEqual({"host-a:tags", "host-b:tags"}, keys)
