"""service.onnx_session: every ML sidecar's providers and thread count.

The sessions all pinned CPUExecutionProvider, so the GPU image installed
onnxruntime-gpu and never used it.
"""

import os
import re
from pathlib import Path
from unittest.mock import patch

from django.test import SimpleTestCase

from service import onnx_session
from service.onnx_session import (
    execution_providers,
    inference_session,
    intra_op_threads,
    session_options,
    uses_gpu,
)

SERVICE_DIR = Path(onnx_session.__file__).resolve().parent
CPU_ONLY = ["CPUExecutionProvider"]
WITH_CUDA = ["CUDAExecutionProvider", "CPUExecutionProvider"]


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


class ExecutionProvidersTest(SimpleTestCase):
    def setUp(self):
        self.addCleanup(_environ().stop)

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


class SessionOptionsTest(SimpleTestCase):
    def setUp(self):
        self.addCleanup(_environ().stop)

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
