from unittest import TestCase as PlainTestCase
from unittest.mock import patch

from django.test import TestCase, override_settings

from api.jobs import parallel
from api.jobs.pool import Pool, PoolSettings
from api.runtime import replicas
from api.runtime.capacity import (
    BALANCED,
    CPU,
    FAST,
    GENTLE,
    GPU,
    MB,
    UNKNOWN,
    Capacity,
    Gpu,
    Load,
    face_cost,
    face_threads,
    plan_workers,
)
from api.runtime.sidecars import SERVICES

GB = 1024 * MB


def machine(cores, total_gb, available_gb):
    return Capacity(
        cores=cores,
        cpu_source="host",
        ram_total=int(total_gb * GB),
        ram_available=int(available_gb * GB),
        ram_source="host",
    )


LAPTOP = machine(16, 32, 21)


def plan(found=LAPTOP, intention=BALANCED, **load):
    return plan_workers(found, intention, sqlite=False, load=Load(**load))


class FaceReplicaPlanTest(PlainTestCase):
    def test_one_face_service_per_heavy_lane_when_it_fits(self):
        planned = plan()

        self.assertEqual(
            (4, 4, "lanes"),
            (planned.heavy_workers, planned.face_replicas, planned.face_limited_by),
        )

    def test_gentle_has_one_face_service(self):
        self.assertEqual(1, plan(intention=GENTLE).face_replicas)

    def test_memory_caps_the_face_services(self):
        planned = plan(
            machine(8, 8, 6), FAST, face=face_cost("buffalo_l", CPU), face_device=CPU
        )

        self.assertEqual(
            ("memory", 1), (planned.face_limited_by, planned.face_replicas)
        )
        self.assertGreater(planned.heavy_workers, planned.face_replicas)

    def test_a_gpu_whose_memory_is_unknown_gets_one(self):
        planned = plan(
            intention=FAST, face=face_cost("buffalo_l", GPU), face_device=UNKNOWN
        )

        self.assertEqual(("gpu", 1), (planned.face_limited_by, planned.face_replicas))

    def test_gpu_memory_caps_the_face_services(self):
        planned = plan(
            intention=FAST,
            face=face_cost("buffalo_l", GPU),
            face_device=GPU,
            gpu=Gpu(total_mb=6144, free_mb=2048),
        )

        self.assertEqual(
            ("vram", 2, 1638),
            (planned.face_limited_by, planned.face_replicas, planned.vram_budget_mb),
        )

    def test_the_gpu_memory_our_face_services_hold_counts_as_free(self):
        gpu = {
            "face": face_cost("buffalo_l", GPU),
            "face_device": GPU,
            "gpu": Gpu(total_mb=6144, free_mb=1000),
        }

        self.assertEqual(1, plan(intention=FAST, **gpu).face_replicas)
        self.assertEqual(
            2, plan(intention=FAST, held_vram_mb=1100, **gpu).face_replicas
        )

    def test_two_face_services_share_a_gpu_at_most(self):
        planned = plan(
            intention=FAST,
            face=face_cost("buffalo_sc", GPU),
            face_device=GPU,
            gpu=Gpu(total_mb=24576, free_mb=20000),
        )

        self.assertEqual(
            ("gpu_share", 2), (planned.face_limited_by, planned.face_replicas)
        )

    def test_the_setting_only_lowers_the_plan(self):
        self.assertEqual(
            ("setting", 2), _replicas(plan(intention=FAST, face_override=2))
        )
        self.assertEqual(
            ("lanes", 4), _replicas(plan(intention=BALANCED, face_override=6))
        )
        tight = plan(
            machine(8, 8, 6),
            FAST,
            face=face_cost("buffalo_l", CPU),
            face_override=8,
        )
        self.assertEqual(("memory", 1), _replicas(tight))

    def test_face_recognition_off_has_none(self):
        planned = plan(face=None)

        self.assertEqual(("off", 0), (planned.face_limited_by, planned.face_replicas))

    def test_the_budget_counts_each_part(self):
        planned = plan(sidecars_mb=1000, face=face_cost("buffalo_sc", CPU))

        self.assertEqual(300 + 1000 + 4 * 250 + 4 * 600, planned.needed_mb)

    def test_what_librephotos_holds_counts_as_available(self):
        tight = machine(8, 16, 3)

        self.assertGreater(
            plan(tight, held_mb=4000).workers, plan(tight, held_mb=0).workers
        )

    def test_never_more_than_eight(self):
        huge = machine(64, 256, 250)

        self.assertEqual(8, plan(huge, FAST).face_replicas)


def _replicas(planned):
    return planned.face_limited_by, planned.face_replicas


class FaceThreadsTest(PlainTestCase):
    def test_each_face_service_gets_its_share_of_the_cores(self):
        self.assertEqual(
            [6, 3, 1, 1],
            [face_threads(12, 6, replicas) for replicas in (1, 2, 4, 8)],
        )

    def test_a_container_quota_counts_before_the_host_cores(self):
        self.assertEqual(2, face_threads(4, 16, 2))
        self.assertEqual(4, face_threads(4, None, 1))


class FaceDeviceTest(PlainTestCase):
    def test_the_device_a_face_service_reports_wins(self):
        self.assertEqual(GPU, parallel.face_device("webgpu"))
        self.assertEqual(GPU, parallel.face_device("cuda"))
        self.assertEqual(CPU, parallel.face_device("cpu"))

    def test_before_a_model_loads_the_providers_decide(self):
        with override_settings(ONNX_PROVIDERS=["CPUExecutionProvider"]):
            self.assertEqual(CPU, parallel.face_device(None))
        with (
            override_settings(ONNX_PROVIDERS=[]),
            patch.object(parallel.importlib.util, "find_spec", return_value=object()),
        ):
            self.assertEqual(UNKNOWN, parallel.face_device(None))
        with (
            override_settings(ONNX_PROVIDERS=[]),
            patch.object(parallel.importlib.util, "find_spec", return_value=None),
        ):
            self.assertEqual(CPU, parallel.face_device(None))


class GpuMemoryTest(PlainTestCase):
    def test_nvidia_smi_gives_the_first_gpu(self):
        done = type("Done", (), {"returncode": 0, "stdout": "6144, 4072\n8192, 1\n"})()
        with (
            patch.object(parallel.binaries, "available", return_value=True),
            patch.object(parallel.binaries, "run_tool", return_value=done),
        ):
            self.assertEqual(Gpu(6144, 4072), parallel.gpu_memory())

    def test_without_nvidia_smi_it_is_unknown(self):
        with patch.object(parallel.binaries, "available", return_value=False):
            self.assertIsNone(parallel.gpu_memory())


@override_settings(TASK_WORKERS=None, FACE_SIDECAR_REPLICAS=6)
class FaceReplicaTargetTest(TestCase):
    def test_an_override_above_the_plan_is_capped_and_logged(self):
        parallel._clamp_warned.clear()
        load = Load(face=face_cost("buffalo_l", GPU), face_device=UNKNOWN)
        with (
            patch.object(parallel.capacity, "detect", return_value=LAPTOP),
            patch.object(parallel, "current_load", return_value=load),
            self.assertLogs(parallel.logger, "WARNING") as logs,
        ):
            target = parallel.face_replica_target()

        self.assertEqual(
            (1, 2200, 0), (target.replicas, target.limit_mb, target.threads)
        )
        self.assertIn("FACE_SIDECAR_REPLICAS asks for 6", logs.output[0])

    def test_the_status_shows_the_face_services(self):
        load = Load(face=face_cost("buffalo_sc", CPU), face_device=CPU)
        with (
            patch.object(parallel.capacity, "detect", return_value=LAPTOP),
            patch.object(parallel, "current_load", return_value=load),
            patch.object(
                parallel.supervisor,
                "sidecar_rss_mb",
                return_value={"face_recognition": {0: 180, 1: 170}},
            ),
            patch.object(
                parallel.replicas,
                "read_live",
                return_value=replicas.LiveReplicas(
                    (SERVICES["face_recognition"],), "cpu"
                ),
            ),
        ):
            status = parallel.status()

        self.assertEqual(6, status["face_override"])
        self.assertEqual(
            {"running": 2, "live": 1, "rss_mb": [180, 170], "device": "cpu"},
            {
                key: status["face_services"][key]
                for key in ("running", "live", "rss_mb", "device")
            },
        )
        balanced = next(p for p in status["plans"] if p["intention"] == BALANCED)
        self.assertEqual(4, balanced["face_replicas"])


@override_settings(
    TASK_WORKERS=None, FACE_SIDECAR_REPLICAS=None, ONNX_INTRA_OP_THREADS=""
)
class CpuThreadsTargetTest(TestCase):
    def test_cpu_face_services_split_the_cores(self):
        load = Load(face=face_cost("buffalo_sc", CPU), face_device=CPU)
        with (
            patch.object(parallel.capacity, "detect", return_value=LAPTOP),
            patch.object(parallel, "current_load", return_value=load),
            patch.object(parallel.psutil, "cpu_count", return_value=8),
        ):
            target = parallel.face_replica_target()

        self.assertEqual((4, 2), (target.replicas, target.threads))

    def test_a_threads_setting_is_left_alone(self):
        load = Load(face=face_cost("buffalo_sc", CPU), face_device=CPU)
        with (
            override_settings(ONNX_INTRA_OP_THREADS="4"),
            patch.object(parallel.capacity, "detect", return_value=LAPTOP),
            patch.object(parallel, "current_load", return_value=load),
        ):
            self.assertEqual(0, parallel.face_replica_target().threads)


class PoolScalerTest(PlainTestCase):
    def test_the_pool_hands_the_heavy_width_to_the_scaler_and_stops_it(self):
        calls = []

        class Scaler:
            def __call__(self, heavy_width):
                calls.append(heavy_width)

            def stop(self):
                calls.append("stop")

        pool = Pool(PoolSettings(workers=4, scaler=Scaler()))
        pool.limits[1] = 3
        pool.scale_sidecars()
        pool.scaling.join(5)
        pool.stop_sidecars()

        self.assertEqual([3, "stop"], calls)
