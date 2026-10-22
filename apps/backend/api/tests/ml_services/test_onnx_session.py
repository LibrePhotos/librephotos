"""service.onnx_session: every ML sidecar's providers and thread count.

The sessions all pinned CPUExecutionProvider, so the GPU image installed
onnxruntime-gpu and never used it. Issue #2445: the WebGPU plugin runs them on
any GPU, selected by device because a session asked for it by name silently
runs on the CPU.
"""

import os
import re
import threading
import types
from pathlib import Path
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from api.tests.stubs import stub_modules
from service import onnx_session
from service.onnx_session import (
    execution_providers,
    inference_session,
    intra_op_threads,
    session_options,
    uses_gpu,
)

SERVICE_DIR = Path(onnx_session.__file__).resolve().parent
CPU = "CPUExecutionProvider"
WEBGPU = "WebGpuExecutionProvider"
CPU_ONLY = [CPU]
WITH_CUDA = ["CUDAExecutionProvider", CPU]
WITH_WEBGPU = [WEBGPU, CPU]


def _available(providers):
    return patch.object(
        onnx_session.ort, "get_available_providers", return_value=providers
    )


def _environ(**values):
    patcher = patch.dict(os.environ)
    patcher.start()
    for name in ("ONNX_PROVIDERS", "ONNX_INTRA_OP_THREADS", "ONNX_CPU_ARENA"):
        os.environ.pop(name, None)
    os.environ.update(values)
    return patcher


def _fresh_webgpu_state(test, device=None, probed=True):
    """A clean per-process WebGPU state: probed and found *device* (or not)."""
    state = onnx_session._WebGpuState()
    state.probed = probed
    state.device = device
    patcher = patch.object(onnx_session, "_webgpu", state)
    patcher.start()
    test.addCleanup(patcher.stop)
    return state


class ExecutionProvidersTest(SimpleTestCase):
    def setUp(self):
        self.addCleanup(_environ().stop)
        # No GPU unless a test says so: the runner may have the plugin installed.
        _fresh_webgpu_state(self)

    def test_cuda_comes_first_when_the_build_has_it(self):
        with _available(["TensorrtExecutionProvider", *WITH_CUDA]):
            self.assertEqual(execution_providers(), WITH_CUDA)

    def test_a_cpu_build_runs_on_the_cpu(self):
        with _available(["AzureExecutionProvider", "CPUExecutionProvider"]):
            self.assertEqual(execution_providers(), CPU_ONLY)

    def test_the_environment_overrides_the_order(self):
        os.environ["ONNX_PROVIDERS"] = " CPUExecutionProvider , "
        with _available(WITH_CUDA):
            self.assertEqual(execution_providers(), CPU_ONLY)

    def test_providers_this_build_lacks_are_skipped(self):
        os.environ["ONNX_PROVIDERS"] = "CUDAExecutionProvider,CPUExecutionProvider"
        with _available(CPU_ONLY):
            self.assertEqual(execution_providers(), CPU_ONLY)

    def test_nothing_usable_falls_back_to_the_cpu(self):
        os.environ["ONNX_PROVIDERS"] = "NoSuchExecutionProvider"
        with _available(CPU_ONLY):
            self.assertEqual(execution_providers(), CPU_ONLY)

    def test_uses_gpu(self):
        with _available(WITH_CUDA):
            self.assertTrue(uses_gpu())
        with _available(CPU_ONLY):
            self.assertFalse(uses_gpu())
        self.assertTrue(uses_gpu(WITH_WEBGPU))
        # The first provider decides: CPU first runs every node on the CPU.
        self.assertFalse(uses_gpu([CPU, WEBGPU]))

    def test_webgpu_comes_before_the_cpu_when_it_found_a_gpu(self):
        _fresh_webgpu_state(self, device=MagicMock())
        with _available([*CPU_ONLY, WEBGPU]):
            self.assertEqual(execution_providers(), WITH_WEBGPU)
            self.assertTrue(uses_gpu())

    def test_webgpu_without_a_gpu_is_the_cpu(self):
        with _available([*CPU_ONLY, WEBGPU]):
            self.assertEqual(execution_providers(), CPU_ONLY)
            self.assertFalse(uses_gpu())

    def test_cuda_wins_and_webgpu_is_not_probed(self):
        state = _fresh_webgpu_state(self, probed=False)
        with (
            _available(WITH_CUDA),
            patch.object(onnx_session, "_find_webgpu_device") as find,
        ):
            self.assertEqual(execution_providers(), WITH_CUDA)
        find.assert_not_called()
        self.assertFalse(state.probed)

    def test_the_environment_keeps_webgpu_unprobed(self):
        os.environ["ONNX_PROVIDERS"] = "CPUExecutionProvider"
        _fresh_webgpu_state(self, probed=False)
        with (
            _available(CPU_ONLY),
            patch.object(onnx_session, "_find_webgpu_device") as find,
        ):
            self.assertEqual(execution_providers(), CPU_ONLY)
        find.assert_not_called()

    def test_the_plugin_is_probed_once_per_process(self):
        _fresh_webgpu_state(self, probed=False)
        device = MagicMock()
        with (
            _available(CPU_ONLY),
            patch.object(
                onnx_session, "_find_webgpu_device", return_value=device
            ) as find,
        ):
            self.assertEqual(execution_providers(), WITH_WEBGPU)
            self.assertEqual(execution_providers(), WITH_WEBGPU)
        find.assert_called_once_with()


def _plugin(path="/plugin/libonnxruntime_providers_webgpu.so"):
    module = types.ModuleType("onnxruntime_ep_webgpu")
    module.get_library_path = lambda: path
    return stub_modules({"onnxruntime_ep_webgpu": module})


def _ep_device(name, description="NVIDIA GeForce GTX 1660 Ti"):
    hardware = MagicMock(vendor="NVIDIA", metadata={"Description": description})
    return MagicMock(ep_name=name, device=hardware)


class FindWebGpuDeviceTest(SimpleTestCase):
    """Registering the plugin, and the one log line when there is no GPU."""

    def test_a_missing_plugin_says_nothing(self):
        with (
            stub_modules({"onnxruntime_ep_webgpu": None}),
            patch.object(
                onnx_session.ort, "register_execution_provider_library"
            ) as reg,
            self.assertNoLogs("onnx_session"),
        ):
            self.assertIsNone(onnx_session._find_webgpu_device())
        reg.assert_not_called()

    def test_the_gpu_device_is_found_and_named(self):
        gpu = _ep_device(WEBGPU)
        with (
            _plugin(),
            patch.object(
                onnx_session.ort, "register_execution_provider_library"
            ) as reg,
            patch.object(
                onnx_session.ort,
                "get_ep_devices",
                return_value=[_ep_device(CPU), gpu],
            ),
            self.assertLogs("onnx_session", "INFO") as logs,
        ):
            self.assertIs(onnx_session._find_webgpu_device(), gpu)
        reg.assert_called_once_with(
            "webgpu", "/plugin/libonnxruntime_providers_webgpu.so"
        )
        self.assertIn("GTX 1660 Ti", logs.output[0])

    def test_no_gpu_is_one_info_line_with_the_fix(self):
        with (
            _plugin(),
            patch.object(onnx_session.ort, "register_execution_provider_library"),
            patch.object(
                onnx_session.ort, "get_ep_devices", return_value=[_ep_device(CPU)]
            ),
            self.assertLogs("onnx_session", "INFO") as logs,
        ):
            self.assertIsNone(onnx_session._find_webgpu_device())
        self.assertEqual(len(logs.records), 1)
        self.assertEqual(logs.records[0].levelname, "INFO")
        self.assertIn("/dev/dri", logs.output[0])
        self.assertIn("NVIDIA_DRIVER_CAPABILITIES", logs.output[0])

    def test_a_plugin_that_fails_to_load_is_an_error_not_a_crash(self):
        fail = onnx_session.ort_state.Fail("libvulkan.so.1: cannot open shared object")
        with (
            _plugin(),
            patch.object(
                onnx_session.ort,
                "register_execution_provider_library",
                side_effect=fail,
            ),
            self.assertLogs("onnx_session", "ERROR") as logs,
        ):
            self.assertIsNone(onnx_session._find_webgpu_device())
        self.assertIn("libvulkan.so.1", logs.output[0])

    def test_every_onnxruntime_error_class_is_caught(self):
        names = {error.__name__ for error in onnx_session.ORT_ERRORS}
        self.assertTrue({"Fail", "EPFail", "RuntimeException"} <= names)


class WebGpuSessionTest(SimpleTestCase):
    """Sessions go on the WebGPU device, never by provider name."""

    def setUp(self):
        self.addCleanup(_environ().stop)
        self.device = MagicMock()
        self.state = _fresh_webgpu_state(self, device=self.device)
        available = _available([*CPU_ONLY, WEBGPU])
        available.start()
        self.addCleanup(available.stop)
        # onnxruntime only takes a real OrtEpDevice, which needs a GPU; the
        # options keep their real thread and arena settings.
        real_options = onnx_session.session_options

        def options(variable_shapes=False):
            real = real_options(variable_shapes)
            return MagicMock(enable_cpu_mem_arena=real.enable_cpu_mem_arena)

        self._patch("session_options", side_effect=options)

    def _patch(self, name, **kwargs):
        patcher = patch.object(onnx_session, name, **kwargs)
        self.addCleanup(patcher.stop)
        return patcher.start()

    def test_the_session_is_created_for_the_device(self):
        webgpu = self._patch("_WebGpuSession")
        webgpu.return_value.get_providers.return_value = WITH_WEBGPU
        by_name = self._patch("ort", wraps=onnx_session.ort)

        session = inference_session("/models/m.onnx", variable_shapes=True)

        self.assertIs(session, webgpu.return_value)
        (path,), kwargs = webgpu.call_args
        self.assertEqual(path, "/models/m.onnx")
        self.assertNotIn("providers", kwargs)
        options = kwargs["sess_options"]
        options.add_provider_for_devices.assert_called_once_with([self.device], {})
        self.assertFalse(options.enable_cpu_mem_arena)
        by_name.InferenceSession.assert_not_called()

    def test_a_failed_session_falls_back_to_the_cpu_for_good(self):
        fail = onnx_session.ort_state.Fail("Failed to get a WebGPU adapter")
        self._patch("_WebGpuSession", side_effect=fail)
        cpu = self._patch("ort", wraps=onnx_session.ort)
        cpu.InferenceSession = MagicMock()

        with self.assertLogs("onnx_session", "ERROR") as logs:
            session = inference_session("/models/m.onnx")

        self.assertIs(session, cpu.InferenceSession.return_value)
        self.assertEqual(cpu.InferenceSession.call_args.kwargs["providers"], CPU_ONLY)
        self.assertIn("WebGPU adapter", logs.output[0])
        self.assertTrue(self.state.failed)
        self.assertEqual(execution_providers(), CPU_ONLY)

    def test_a_session_onnxruntime_quietly_put_on_the_cpu_counts_as_failed(self):
        webgpu = self._patch("_WebGpuSession")
        webgpu.return_value.get_providers.return_value = CPU_ONLY
        cpu = self._patch("ort", wraps=onnx_session.ort)
        cpu.InferenceSession = MagicMock()

        with self.assertLogs("onnx_session", "ERROR"):
            session = inference_session("/models/m.onnx")

        self.assertIs(session, cpu.InferenceSession.return_value)
        self.assertTrue(self.state.failed)

    def test_a_broken_model_keeps_webgpu(self):
        broken = onnx_session.ort_state.InvalidProtobuf("not a model")
        self._patch("_WebGpuSession", side_effect=broken)
        cpu = self._patch("ort", wraps=onnx_session.ort)
        cpu.InferenceSession = MagicMock(side_effect=broken)

        with self.assertRaises(onnx_session.ort_state.InvalidProtobuf):
            inference_session("/models/broken.onnx")
        self.assertFalse(self.state.failed)

    def test_run_holds_the_process_lock(self):
        # microsoft/onnxruntime#32561: two WebGPU sessions running at once crash.
        seen = []

        def run(session, output_names, input_feed, run_options=None):
            seen.append(onnx_session._webgpu_run_lock.locked())
            return ["out"]

        session = onnx_session._WebGpuSession.__new__(onnx_session._WebGpuSession)
        with (
            patch.object(onnx_session, "_webgpu_run_lock", threading.Lock()),
            patch.object(onnx_session.ort.InferenceSession, "run", run),
        ):
            self.assertEqual(session.run(None, {"x": 1}), ["out"])
        self.assertEqual(seen, [True])


class SessionOptionsTest(SimpleTestCase):
    def setUp(self):
        self.addCleanup(_environ().stop)
        _fresh_webgpu_state(self)

    def test_unset_leaves_the_onnxruntime_default(self):
        self.assertIsNone(intra_op_threads())
        self.assertEqual(session_options().intra_op_num_threads, 0)

    def test_a_thread_count_is_applied(self):
        os.environ["ONNX_INTRA_OP_THREADS"] = "3"
        self.assertEqual(session_options().intra_op_num_threads, 3)

    def test_nonsense_is_ignored(self):
        for value in ("zero", "-2", "0", ""):
            with self.subTest(value=value):
                os.environ["ONNX_INTRA_OP_THREADS"] = value
                self.assertIsNone(intra_op_threads())

    def test_the_session_gets_both(self):
        os.environ["ONNX_INTRA_OP_THREADS"] = "2"
        with (
            _available(WITH_CUDA),
            patch.object(onnx_session.ort, "InferenceSession") as session,
        ):
            inference_session("/models/m.onnx")
        args, kwargs = session.call_args
        self.assertEqual(args, ("/models/m.onnx",))
        self.assertEqual(kwargs["providers"], WITH_CUDA)
        self.assertEqual(kwargs["sess_options"].intra_op_num_threads, 2)


class CpuArenaTest(SimpleTestCase):
    """The variable-shape models run without the CPU arena unless told."""

    def setUp(self):
        self.addCleanup(_environ().stop)

    def test_default_follows_the_model(self):
        self.assertTrue(session_options().enable_cpu_mem_arena)
        self.assertFalse(session_options(variable_shapes=True).enable_cpu_mem_arena)

    def test_the_environment_forces_it(self):
        for value, expected in (("1", True), ("on", True), ("0", False)):
            with self.subTest(value=value):
                os.environ["ONNX_CPU_ARENA"] = value
                self.assertEqual(session_options().enable_cpu_mem_arena, expected)
                self.assertEqual(
                    session_options(variable_shapes=True).enable_cpu_mem_arena,
                    expected,
                )

    def test_ocr_and_captions_ask_for_variable_shapes(self):
        for path in ("ocr/ppocr/engine.py", "image_captioning/lfm2_vl.py"):
            with self.subTest(path=path):
                source = (SERVICE_DIR / path).read_text(encoding="utf-8")
                self.assertIn("variable_shapes=True", source)


class NoPinnedProvidersTest(SimpleTestCase):
    """Every sidecar session goes through service.onnx_session."""

    def test_no_sidecar_pins_a_provider_or_builds_its_own_session(self):
        pinned = re.compile(r"CPUExecutionProvider|InferenceSession\(")
        offenders = [
            str(path.relative_to(SERVICE_DIR))
            for path in SERVICE_DIR.rglob("*.py")
            if path.name != "onnx_session.py"
            and pinned.search(path.read_text(encoding="utf-8"))
        ]
        self.assertEqual(offenders, [])
