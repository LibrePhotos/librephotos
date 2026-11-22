from __future__ import annotations

import importlib.util
import logging
import threading
import time
from dataclasses import asdict, dataclass, field

from constance import config
from django.conf import settings
from django.db import connection

from api.models.long_running_job import LongRunningJob
from api.models.task_queue import (
    HEAVY_QUEUE,
    OPEN_STATUSES,
    QUEUED,
    RUNNING,
    QueuedTask,
    WorkerProcess,
)
from api.runtime import binaries, capacity, replicas, supervisor
from api.runtime.capacity import (
    BALANCED,
    CPU,
    FAST,
    GPU,
    INTENTIONS,
    SIDECAR_MB,
    UNKNOWN,
    Capacity,
    Gpu,
    Load,
    WorkerPlan,
)
from api.runtime.sidecars import SERVICES

logger = logging.getLogger(__name__)

FAST_IDLE_SECONDS = 600.0


def intention() -> str:
    value = str(getattr(config, "PARALLEL_WORKERS", BALANCED))
    return value if value in INTENTIONS else BALANCED


def set_intention(value: str) -> None:
    if value not in INTENTIONS:
        raise ValueError(f"unknown intention {value!r}")
    config.PARALLEL_WORKERS = value


def override() -> int | None:
    workers: int | None = settings.TASK_WORKERS
    return workers


FACE = "face_recognition"
LOAD_CACHE_SECONDS = 10.0
GPU_CACHE_SECONDS = 60.0
NVIDIA_SMI_TIMEOUT = 5
GPU_DEVICES = ("webgpu", "cuda")


def face_override() -> int | None:
    wanted: int | None = settings.FACE_SIDECAR_REPLICAS
    return wanted


def gpu_memory() -> Gpu | None:
    if not binaries.available("nvidia-smi"):
        return None
    try:
        completed = binaries.run_tool(
            "nvidia-smi",
            ["--query-gpu=memory.total,memory.free", "--format=csv,noheader,nounits"],
            timeout=NVIDIA_SMI_TIMEOUT,
            check=False,
            text=True,
        )
    except binaries.ToolError:
        return None
    lines = completed.stdout.strip().splitlines() if completed.returncode == 0 else []
    total, _, free = (lines[0] if lines else "").partition(",")
    try:
        return Gpu(total_mb=int(float(total)), free_mb=int(float(free)))
    except ValueError:
        return None


def face_device(reported: str | None) -> str:
    if reported in GPU_DEVICES:
        return GPU
    if reported == "cpu":
        return CPU
    providers: list[str] = settings.ONNX_PROVIDERS
    if providers and providers[0] == "CPUExecutionProvider":
        return CPU
    if importlib.util.find_spec("onnxruntime_ep_webgpu") is not None:
        return UNKNOWN
    return CPU


def face_model() -> str:
    return str(getattr(config, "FACE_RECOGNITION_MODEL", "buffalo_sc"))


@dataclass
class _Cached:
    lock: threading.Lock = field(default_factory=threading.Lock)
    load: Load | None = None
    load_at: float = 0.0
    gpu: Gpu | None = None
    gpu_at: float = -GPU_CACHE_SECONDS


_cache = _Cached()


def _gpu() -> Gpu | None:
    now = time.monotonic()
    if now - _cache.gpu_at >= GPU_CACHE_SECONDS:
        _cache.gpu, _cache.gpu_at = gpu_memory(), now
    return _cache.gpu


def held_mb() -> tuple[int, int]:
    sidecars = supervisor.sidecar_rss_mb()
    workers = sum(
        WorkerProcess.objects.filter(host=supervisor.socket.gethostname()).values_list(
            "rss_mb", flat=True
        )
    )
    total = sum(sum(sizes.values()) for sizes in sidecars.values())
    return total + workers, len(sidecars.get(FACE, {}))


def current_load(refresh: bool = False) -> Load:
    now = time.monotonic()
    with _cache.lock:
        if not refresh and _cache.load and now - _cache.load_at < LOAD_CACHE_SECONDS:
            return _cache.load
        sidecars_mb = sum(
            cost
            for service, cost in SIDECAR_MB.items()
            if supervisor.is_service_enabled(service)
        )
        live = replicas.read_live(FACE, SERVICES[FACE])
        device = face_device(live.device)
        face = (
            capacity.face_cost(face_model(), device)
            if supervisor.is_service_enabled(FACE)
            else None
        )
        held, face_processes = held_mb()
        gpu = _gpu() if device != CPU else None
        load = Load(
            sidecars_mb=sidecars_mb,
            face=face,
            face_device=device,
            gpu=gpu,
            held_mb=held,
            held_vram_mb=face_processes * face.vram_mb if face and gpu else 0,
            face_override=face_override(),
        )
        _cache.load, _cache.load_at = load, now
        return load


def plan_for(
    chosen: str, found: Capacity | None = None, load: Load | None = None
) -> WorkerPlan:
    return capacity.plan_workers(
        found or capacity.detect(),
        chosen,
        sqlite=connection.vendor == "sqlite",
        override=override(),
        load=load or current_load(),
    )


def heavy_demand() -> int:
    return QueuedTask.objects.filter(
        queue=HEAVY_QUEUE, status__in=(QUEUED, RUNNING)
    ).count()


def face_replica_target() -> tuple[int, int]:
    found = capacity.detect()
    planned = plan_for(intention(), found)
    load = current_load()
    wanted = face_override()
    if wanted and wanted > planned.face_replicas:
        _warn_clamped(wanted, planned)
    limit = load.face.limit_mb if load.face is not None else 0
    return planned.face_replicas, limit


_clamp_warned: set[tuple[int, int, str]] = set()


def _warn_clamped(wanted: int, planned: WorkerPlan) -> None:
    key = (wanted, planned.face_replicas, planned.face_limited_by)
    if key in _clamp_warned:
        return
    _clamp_warned.add(key)
    logger.warning(
        "FACE_SIDECAR_REPLICAS asks for %s face services; %s fit (limited by %s)",
        wanted,
        planned.face_replicas,
        planned.face_limited_by,
    )


def max_workers() -> int:
    return override() or plan_for(FAST).workers


class Sizer:
    def __init__(self, ceiling: int) -> None:
        self.ceiling = ceiling
        self.width = ceiling

    def __call__(self) -> tuple[int, int]:
        found = capacity.detect()
        planned = plan_for(intention(), found)
        width = min(self.ceiling, planned.workers)
        if capacity.low_on_memory(found):
            width = max(1, min(width, self.width - 1))
        if width != self.width:
            logger.info(
                "parallel workers: %s now (%s, %s MB available)",
                width,
                planned.intention,
                found.ram_available // capacity.MB,
            )
        self.width = width
        return width, min(width, planned.heavy_workers)


class FastFirstImport:
    def __init__(self, idle_seconds: float = FAST_IDLE_SECONDS) -> None:
        self.idle_seconds = idle_seconds
        self.idle_since: float | None = None

    def __call__(self) -> bool:
        if intention() != FAST:
            self.idle_since = None
            return False
        if QueuedTask.objects.filter(status__in=OPEN_STATUSES).exists():
            self.idle_since = None
            return False
        now = time.monotonic()
        self.idle_since = self.idle_since or now
        scanned = LongRunningJob.objects.filter(
            job_type=LongRunningJob.JOB_SCAN_PHOTOS, finished=True, failed=False
        ).filter(**{f"result__{LongRunningJob.LIBRARY_SCAN}": True})
        if now - self.idle_since < self.idle_seconds or not scanned.exists():
            return False
        set_intention(BALANCED)
        logger.info("parallel workers: the first import is done, back to balanced")
        return True


def face_services(load: Load) -> dict[str, object]:
    live = replicas.read_live(FACE, SERVICES[FACE])
    sizes = supervisor.sidecar_rss_mb().get(FACE, {})
    return {
        "running": len(sizes),
        "live": len(live.ports) if sizes else 0,
        "device": live.device,
        "rss_mb": [sizes[index] for index in sorted(sizes)],
        "gpu_total_mb": load.gpu.total_mb if load.gpu else None,
        "gpu_free_mb": load.gpu.free_mb if load.gpu else None,
    }


def status() -> dict[str, object]:
    found = capacity.detect()
    load = current_load(refresh=True)
    return {
        "capacity": {
            "cores": found.cores,
            "cpu_source": found.cpu_source,
            "ram_total_mb": found.ram_total // capacity.MB,
            "ram_available_mb": found.ram_available // capacity.MB,
            "ram_source": found.ram_source,
        },
        "intention": intention(),
        "override": override(),
        "face_override": face_override(),
        "plans": [asdict(plan_for(chosen, found, load)) for chosen in INTENTIONS],
        "face_services": face_services(load),
        "workers": list(
            WorkerProcess.objects.order_by("host", "slot").values(
                "name",
                "slot",
                "active",
                "rss_mb",
                "heartbeat_at",
                "memory_recycles",
                "last_recycle",
            )
        ),
    }
