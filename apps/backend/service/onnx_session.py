"""ONNX Runtime sessions for the ML sidecars: which device, how many threads.

Every model the sidecars run (OpenCLIP, LFM2-VL, PP-OCR, InsightFace) gets
its session here. The device is the first of these that works:

CUDA
    When the installed onnxruntime is a CUDA build (``onnxruntime-gpu``). The
    images ship the regular ``onnxruntime``, so this is for custom installs.
WebGPU
    The ``onnxruntime-ep-webgpu`` plugin, which the images ship: any GPU with
    a Vulkan driver on Linux (Intel and AMD through Mesa, NVIDIA through its
    own driver), Direct3D 12 on Windows, Metal on macOS. Selecting it by
    provider name gives a session that silently runs on the CPU, so it is
    selected by device (``SessionOptions.add_provider_for_devices``).
CPU
    Always. When WebGPU finds no GPU, or a session cannot start on it, the
    process says so once in the log and stays on the CPU.

ONNX Runtime offers the WebGPU device for any GPU it sees in sysfs, and a
container sees the host's GPUs there even when it cannot use them. Vulkan
then has only Mesa's software driver left (lavapipe, which the image ships
with the Intel and AMD drivers), and WebGPU ran every model on it with no
error: on the CPU, about 20 times slower than the CPU provider (#2445). So
api.runtime.supervisor starts the sidecars with the Vulkan loader skipping
lavapipe (``VK_LOADER_DRIVERS_DISABLE``); without a GPU driver the session
fails and the process falls back to the CPU provider. The log names the GPU
once the first session started on it, not when the device is found.

``ONNX_PROVIDERS``
    Comma-separated execution providers in order of preference, e.g.
    ``CPUExecutionProvider`` to keep a GPU off, or
    ``WebGpuExecutionProvider,CPUExecutionProvider``. Names this onnxruntime
    build does not offer are skipped. Unset: CUDA, WebGPU, CPU. The first one
    decides the device; the CPU runs whatever nodes the GPU provider leaves.
``ONNX_INTRA_OP_THREADS``
    Threads one session may use inside an operator. Unset or 0: onnxruntime's
    default, one per physical core.
``ONNX_CPU_ARENA``
    ``1`` / ``0`` force ONNX Runtime's CPU memory arena on or off for every
    session. Unset: off for the models whose input size changes from call to
    call (OCR, captions), on for the rest. The arena keeps the largest
    activations a session ever needed for as long as it lives, which for the
    variable-shape models is hundreds of MB more than their next request
    needs (the Rust and TypeScript experiments measured -400 MB resident for
    OCR and -200 MB for captions for a few % more time).

WebGPU sessions run one call at a time per process: two sessions running at
once crash on Linux with Vulkan (microsoft/onnxruntime#32561).

The sidecars are scripts started as ``python service/<name>/main.py``;
api.runtime.supervisor puts the backend root on their PYTHONPATH so this module imports
as ``service.onnx_session`` there as in the tests and the standalone build.
"""

from __future__ import annotations

import threading
from collections.abc import Mapping, Sequence

import numpy as np
import onnxruntime as ort
from onnxruntime.capi import onnxruntime_pybind11_state as ort_state

from librephotos.env import env_int, env_list, env_optional_flag
from service._common import logger

CPU = "CPUExecutionProvider"
CUDA = "CUDAExecutionProvider"
WEBGPU = "WebGpuExecutionProvider"
DEFAULT_PROVIDERS = (CUDA, WEBGPU, CPU)
GPU_PROVIDERS = frozenset({CUDA, WEBGPU})
# The name the plugin library is registered under; any name works.
WEBGPU_PLUGIN = "webgpu"
# On Linux ONNX Runtime reports PCI ids but no GPU name.
PCI_VENDORS = {0x10DE: "NVIDIA", 0x1002: "AMD", 0x8086: "Intel", 0x1414: "Microsoft"}
# The errors ONNX Runtime raises (Fail, EPFail, NoSuchFile, ...): they share no
# base class but Exception.
ORT_ERRORS: tuple[type[Exception], ...] = tuple(
    error
    for error in vars(ort_state).values()
    if isinstance(error, type) and issubclass(error, Exception)
)
# Loading the plugin also fails with get_library_path's RuntimeError (no
# library in the package) and OSError.
PLUGIN_LOAD_ERRORS: tuple[type[Exception], ...] = (*ORT_ERRORS, RuntimeError, OSError)
NO_GPU_HINT = (
    "Docker: pass /dev/dri to the container for Intel and AMD GPUs, or set "
    "NVIDIA_DRIVER_CAPABILITIES=compute,utility,graphics for NVIDIA, which "
    "mounts the host's Vulkan driver (nvidia_icd.json) if the host has one. "
    "ONNX_PROVIDERS=CPUExecutionProvider skips the GPU check."
)

log = logger("onnx_session")


class _WebGpuState:
    """The WebGPU plugin in this process: probed once, given up on once."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.probed = False
        self.device: ort.OrtEpDevice | None = None
        self.failed = False
        self.announced = False


_webgpu = _WebGpuState()
# microsoft/onnxruntime#32561: concurrent Run() on two WebGPU sessions
# segfaults on Linux/Vulkan. One lock for every WebGPU session in the process.
_webgpu_run_lock = threading.Lock()


class _WebGpuSession(ort.InferenceSession):
    """An InferenceSession whose run() holds the process-wide WebGPU lock."""

    def run(
        self,
        output_names: Sequence[str] | None,
        input_feed: Mapping[str, object],
        run_options: ort.RunOptions | None = None,
    ) -> list[np.ndarray]:
        with _webgpu_run_lock:
            return super().run(output_names, input_feed, run_options)


def _find_webgpu_device() -> ort.OrtEpDevice | None:
    """Register the plugin and return its device; None when there is no GPU."""
    try:
        import onnxruntime_ep_webgpu
    except ImportError:
        return None  # not installed: nothing to say
    try:
        ort.register_execution_provider_library(
            WEBGPU_PLUGIN, onnxruntime_ep_webgpu.get_library_path()
        )
    except PLUGIN_LOAD_ERRORS as error:
        # A missing libvulkan.so.1, an onnxruntime older than the plugin needs,
        # or the plugin's library left out of a build.
        log.error(
            "WebGPU plugin failed to load, ML models run on the CPU: %s. %s",
            error,
            NO_GPU_HINT,
        )
        return None
    device = next((d for d in ort.get_ep_devices() if d.ep_name == WEBGPU), None)
    if device is None:
        log.info("No GPU found for WebGPU, ML models run on the CPU. %s", NO_GPU_HINT)
        return None
    # Not "runs on the GPU" yet: a container sees the host's GPUs here even
    # without their driver. inference_session says it once a session started.
    return device


def gpu_name(device: ort.OrtEpDevice) -> str:
    """The GPU's name, or on Linux (no name there) its vendor, PCI ids and slot."""
    hardware = device.device
    name = hardware.metadata.get("Description") or hardware.vendor
    if name:
        return name
    vendor = PCI_VENDORS.get(hardware.vendor_id, "GPU")
    ids = f"{hardware.vendor_id:04x}:{hardware.device_id:04x}"
    slot = hardware.metadata.get("pci_bus_id")
    return f"{vendor} {ids} at {slot}" if slot else f"{vendor} {ids}"


def webgpu_device() -> ort.OrtEpDevice | None:
    """The WebGPU device to put sessions on, or None to stay off it.

    The plugin is registered on the first call. None when it is not installed,
    fails to load, finds no GPU, or a session on it failed before.
    """
    with _webgpu.lock:
        if not _webgpu.probed:
            _webgpu.probed = True
            _webgpu.device = _find_webgpu_device()
        return None if _webgpu.failed else _webgpu.device


def _requested_providers() -> list[str]:
    return env_list("ONNX_PROVIDERS")


def execution_providers() -> list[str]:
    """The providers to create sessions with, most preferred first.

    WebGPU counts only when its plugin found a GPU. It is not probed when a
    provider before it already is a GPU, nor when ONNX_PROVIDERS leaves it out.
    """
    available = ort.get_available_providers()
    providers: list[str] = []
    for name in _requested_providers() or DEFAULT_PROVIDERS:
        if name in providers:
            continue
        if name == WEBGPU:
            usable = not uses_gpu(providers) and webgpu_device() is not None
        else:
            usable = name in available
        if usable:
            providers.append(name)
    return providers or [CPU]


def uses_gpu(providers: list[str] | None = None) -> bool:
    """Whether sessions run on a GPU (CUDA or WebGPU): the first provider decides."""
    providers = execution_providers() if providers is None else providers
    return bool(providers) and providers[0] in GPU_PROVIDERS


def intra_op_threads() -> int | None:
    """ONNX_INTRA_OP_THREADS as a positive int, or None for the ORT default."""
    try:
        threads = env_int("ONNX_INTRA_OP_THREADS", 0)
    except ValueError:
        return None
    return threads if threads > 0 else None


def cpu_arena(variable_shapes: bool = False) -> bool:
    """Whether a session gets ONNX Runtime's CPU arena (see ONNX_CPU_ARENA)."""
    value = env_optional_flag("ONNX_CPU_ARENA")
    return (not variable_shapes) if value is None else value


def session_options(variable_shapes: bool = False) -> ort.SessionOptions:
    options = ort.SessionOptions()
    threads = intra_op_threads()
    if threads is not None:
        options.intra_op_num_threads = threads
    options.enable_cpu_mem_arena = cpu_arena(variable_shapes)
    return options


def _session_by_name(
    path: str, variable_shapes: bool, providers: list[str]
) -> ort.InferenceSession:
    # By name WebGPU would silently be the CPU anyway; leave it out.
    return ort.InferenceSession(
        path,
        sess_options=session_options(variable_shapes),
        providers=[name for name in providers if name != WEBGPU] or [CPU],
    )


def _webgpu_session(
    path: str, variable_shapes: bool, device: ort.OrtEpDevice
) -> tuple[ort.InferenceSession | None, str]:
    """A session on the WebGPU device, or None and why it is not there."""
    options = session_options(variable_shapes)
    options.add_provider_for_devices([device], {})
    try:
        session = _WebGpuSession(path, sess_options=options)
    except ORT_ERRORS as error:
        return None, f"no session on it ({error})"
    if WEBGPU not in session.get_providers():
        return None, f"ONNX Runtime put the session on {session.get_providers()}"
    return session, ""


def inference_session(path: str, variable_shapes: bool = False) -> ort.InferenceSession:
    """An InferenceSession for *path* on the configured providers.

    ``variable_shapes``: the model is fed inputs of changing sizes (text boxes,
    image tiles, a growing token sequence), so it runs without the CPU arena
    unless ONNX_CPU_ARENA says otherwise.

    A model that does not start on WebGPU starts on the CPU instead, and the
    process stops trying WebGPU. When the CPU fails too, the model is at fault
    and the error goes to the caller with WebGPU left on.
    """
    providers = execution_providers()
    device = webgpu_device() if providers[0] == WEBGPU else None
    if device is None:
        return _session_by_name(path, variable_shapes, providers)
    session, reason = _webgpu_session(path, variable_shapes, device)
    if session is not None:
        with _webgpu.lock:
            announce, _webgpu.announced = not _webgpu.announced, True
        if announce:
            log.info("ML models run on the GPU through WebGPU: %s", gpu_name(device))
        return session
    fallback = _session_by_name(path, variable_shapes, providers)
    with _webgpu.lock:
        _webgpu.failed = True
    log.error(
        "WebGPU failed, ML models run on the CPU from now on: %s. %s",
        reason,
        NO_GPU_HINT,
    )
    return fallback
