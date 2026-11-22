import sys
import tempfile
import time
from pathlib import Path
from unittest.mock import patch

from django.test import SimpleTestCase, TestCase

from api.runtime import replicas, sidecar_scaler, supervisor
from api.runtime.sidecar_scaler import ReplicaScaler
from api.runtime.sidecars import SERVICES
from api.runtime.supervisor import Probe

FACE = "face_recognition"
BASE = SERVICES[FACE]


class FakeSidecars:
    def __init__(self):
        self.running = {0}
        self.rss = {0: 200}
        self.health = {}
        self.started = []
        self.stopped = []
        self.restarted = []

    def processes(self, service):
        return {index: [object()] for index in self.running}

    def sizes(self):
        return {FACE: {index: self.rss.get(index, 200) for index in self.running}}

    def probe(self, service, index):
        if index not in self.running:
            return Probe.SILENT, None
        body = {
            "service": FACE,
            "replica": index,
            "busy": False,
            "last_request_time": time.time(),
            "device": "cpu",
        }
        body.update(self.health.get(index, {}))
        return Probe.ANSWERED, body

    def start(self, service, indices):
        self.started.extend(indices)
        self.running.update(indices)
        return {}

    def stop(self, service, index, only=None):
        self.stopped.append(index)
        self.running.discard(index)
        return True

    def stop_extras(self, service, only=None):
        for index in sorted(self.running - {0}):
            self.stop(service, index)


class ScalerTestCase(TestCase):
    def setUp(self):
        self.dir = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.enterContext(patch.object(replicas, "runtime_dir", return_value=self.dir))
        self.fake = FakeSidecars()
        self.enabled = True
        for name, new in {
            "replica_processes": self.fake.processes,
            "sidecar_rss_mb": self.fake.sizes,
            "probe_replica": self.fake.probe,
            "start_replicas": self.fake.start,
            "stop_replica": self.fake.stop,
            "stop_extra_replicas": self.fake.stop_extras,
            "restart_service": lambda service: self.fake.restarted.append(0),
            "is_service_enabled": lambda service: self.enabled,
        }.items():
            self.enterContext(patch.object(supervisor, name, new=new))
        self.plan = 4
        self.demand = 10
        self.low = False
        self.now = 1000.0
        self.scaler = ReplicaScaler(
            target=lambda: (self.plan, 500),
            demand=lambda: self.demand,
            memory_low=lambda: self.low,
            clock=lambda: self.now,
        )

    def live(self):
        return replicas.read_live(FACE, BASE).ports


class ScaleUpTest(ScalerTestCase):
    def test_one_replica_per_heavy_lane_up_to_the_plan(self):
        self.scaler(heavy_width=3)

        self.assertEqual([1, 2], self.fake.started)
        self.assertEqual((BASE, BASE + 100, BASE + 200), self.live())

    def test_the_plan_caps_the_lanes(self):
        self.plan = 2
        self.scaler(heavy_width=8)

        self.assertEqual((BASE, BASE + 100), self.live())

    def test_no_work_in_the_heavy_queue_starts_nothing(self):
        self.demand = 0
        self.scaler(heavy_width=4)

        self.assertEqual([], self.fake.started)
        self.assertEqual((BASE,), self.live())

    def test_the_device_the_replicas_report_is_shared(self):
        self.fake.health[0] = {"device": "webgpu"}
        self.scaler(heavy_width=1)

        self.assertEqual("webgpu", replicas.read_live(FACE, BASE).device)


class ScaleDownTest(ScalerTestCase):
    def setUp(self):
        super().setUp()
        self.scaler(heavy_width=4)
        self.fake.started.clear()

    def test_a_replica_without_work_leaves_the_rotation_then_exits_when_idle(self):
        self.demand = 1
        self.fake.health = {
            index: {"last_request_time": time.time()} for index in (1, 2, 3)
        }
        self.scaler(heavy_width=4)

        self.assertEqual((BASE,), self.live())
        self.assertEqual([], self.fake.stopped)

        self.now += sidecar_scaler.IDLE_EXIT_SECONDS
        self.scaler(heavy_width=4)

        self.assertEqual([1, 2, 3], self.fake.stopped)

    def test_a_busy_replica_is_not_stopped(self):
        self.plan = 1
        self.fake.health = {index: {"busy": True} for index in (1, 2, 3)}
        self.scaler(heavy_width=4)

        self.assertEqual([], self.fake.stopped)

    def test_a_replica_the_plan_no_longer_allows_stops_once_idle(self):
        self.plan = 2
        self.fake.health = {
            index: {"last_request_time": time.time()} for index in (1, 2, 3)
        }
        self.scaler(heavy_width=4)

        self.assertEqual([2, 3], self.fake.stopped)
        self.assertEqual((BASE, BASE + 100), self.live())

    def test_low_memory_takes_one_replica_away_a_round(self):
        self.low = True
        counts = []
        for _ in range(4):
            self.scaler(heavy_width=4)
            counts.append(len(self.fake.running))

        self.assertEqual([3, 2, 1, 1], counts)

    def test_a_replica_over_its_limit_is_restarted(self):
        self.fake.rss[2] = 900
        self.scaler(heavy_width=4)

        self.assertIn(2, self.fake.stopped)
        self.assertIn(2, self.fake.started)
        self.assertNotIn(BASE + 200, self.live())

    def test_the_first_replica_over_its_limit_is_restarted_when_idle(self):
        self.fake.rss[0] = 900
        self.scaler(heavy_width=4)

        self.assertEqual([0], self.fake.restarted)

    def test_turning_face_recognition_off_stops_the_replicas(self):
        self.enabled = False
        self.scaler(heavy_width=4)

        self.assertEqual({0}, self.fake.running)
        self.assertEqual((BASE,), self.live())

    def test_stopping_the_workers_stops_the_replicas(self):
        self.scaler.stop()

        self.assertEqual({0}, self.fake.running)
        self.assertFalse(replicas.state_path(FACE, BASE).exists())


class SilentReplicaTest(ScalerTestCase):
    def test_a_replica_that_stays_silent_is_restarted(self):
        self.plan = 2
        self.scaler(heavy_width=2)
        silent = Probe.SILENT, None
        with patch.object(
            supervisor,
            "probe_replica",
            new=lambda s, i: silent if i == 1 else self.fake.probe(s, i),
        ):
            for _ in range(sidecar_scaler.HUNG_ROUNDS):
                self.scaler(heavy_width=2)

        self.assertEqual([1], self.fake.stopped)


class ReplicaCommandTest(SimpleTestCase):
    def test_a_replica_is_started_with_its_index(self):
        with patch("api.runtime.supervisor.named_executable", return_value=None):
            command = supervisor._service_command(FACE, 2)

        self.assertEqual(
            [sys.executable, "service/face_recognition/main.py", "--replica", "2"],
            command,
        )

    def test_the_replica_is_read_back_from_a_command_line(self):
        cases = [
            (["python", "service/face_recognition/main.py"], 0),
            (["python", "service/face_recognition/main.py", "--replica", "3"], 3),
            (["C:/lp/librephotos-faces.exe", "service", FACE, "--replica", "1"], 1),
            (["python", "service/tags/main.py", "--replica", "1"], None),
            (["python", "service/face_recognition/main.py", "--replica", "x"], None),
        ]
        for cmdline, index in cases:
            with self.subTest(cmdline):
                self.assertEqual(index, supervisor.replica_of(cmdline, FACE))

    def test_an_extra_replica_is_not_taken_for_the_first(self):
        cmdline = ["python", "service/face_recognition/main.py", "--replica", "1"]

        self.assertFalse(supervisor._is_service_process(cmdline, FACE))

    def test_a_replica_answering_for_another_index_is_foreign(self):
        response = type(
            "R",
            (),
            {
                "status_code": 200,
                "json": lambda self: {"service": FACE, "replica": 1},
            },
        )()
        with (
            patch("api.runtime.supervisor.requests.get", return_value=response),
            patch("api.runtime.supervisor.port_owner", return_value=None),
        ):
            self.assertIs(Probe.FOREIGN, supervisor.probe_replica(FACE, 2)[0])
            self.assertIs(Probe.ANSWERED, supervisor.probe_replica(FACE, 1)[0])
