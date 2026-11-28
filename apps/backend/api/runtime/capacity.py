from __future__ import annotations

import ctypes
import math
import os
import sys
from dataclasses import dataclass
from pathlib import Path

import psutil

MB = 1024 * 1024
CGROUP_ROOT = Path("/sys/fs/cgroup")
PROC_SELF_CGROUP = Path("/proc/self/cgroup")
UNLIMITED_V1 = 1 << 60

HOST = "host"
CGROUP_V2 = "cgroup v2"
CGROUP_V1 = "cgroup v1"
JOB_OBJECT = "job object"
AFFINITY = "affinity"

_JOB_OBJECT_EXTENDED_LIMIT_INFORMATION = 9
_JOB_OBJECT_LIMIT_PROCESS_MEMORY = 0x100
_JOB_OBJECT_LIMIT_JOB_MEMORY = 0x200


@dataclass(frozen=True)
class MemoryReading:
    limit: int | None
    usage: int | None
    source: str


@dataclass(frozen=True)
class Capacity:
    cores: int
    cpu_source: str
    ram_total: int
    ram_available: int
    ram_source: str


def _read(path: Path) -> str | None:
    try:
        return path.read_text(encoding="ascii").strip()
    except OSError, UnicodeDecodeError:
        return None


def _read_int(path: Path) -> int | None:
    text = _read(path)
    if text is None:
        return None
    try:
        return int(text)
    except ValueError:
        return None


def _stat_value(path: Path, key: str) -> int:
    text = _read(path) or ""
    for line in text.splitlines():
        name, _, value = line.partition(" ")
        if name == key:
            try:
                return int(value)
            except ValueError:
                return 0
    return 0


def own_cgroup_v2(root: Path, proc_cgroup: Path = PROC_SELF_CGROUP) -> Path:
    text = _read(proc_cgroup) or ""
    for line in text.splitlines():
        hierarchy, _, path = line.partition("::")
        if hierarchy == "0" and path.startswith("/"):
            candidate = root / path.lstrip("/")
            if (candidate / "memory.max").exists() or (candidate / "cpu.max").exists():
                return candidate
    return root


def cgroup_memory(root: Path, proc_cgroup: Path = PROC_SELF_CGROUP) -> MemoryReading:
    v2 = own_cgroup_v2(root, proc_cgroup)
    max_text = _read(v2 / "memory.max")
    if max_text is not None:
        limit = None if max_text == "max" else _read_int(v2 / "memory.max")
        usage = _read_int(v2 / "memory.current")
        if usage is not None:
            usage = max(0, usage - _stat_value(v2 / "memory.stat", "inactive_file"))
        return MemoryReading(limit, usage, CGROUP_V2)
    v1 = root / "memory"
    limit = _read_int(v1 / "memory.limit_in_bytes")
    if limit is None:
        return MemoryReading(None, None, HOST)
    usage = _read_int(v1 / "memory.usage_in_bytes")
    if usage is not None:
        usage = max(0, usage - _stat_value(v1 / "memory.stat", "total_inactive_file"))
    return MemoryReading(limit if limit < UNLIMITED_V1 else None, usage, CGROUP_V1)


def cgroup_cpu_limit(
    root: Path, proc_cgroup: Path = PROC_SELF_CGROUP
) -> tuple[float | None, str]:
    text = _read(own_cgroup_v2(root, proc_cgroup) / "cpu.max")
    if text is not None:
        quota, _, period = text.partition(" ")
        if quota == "max":
            return None, CGROUP_V2
        try:
            return int(quota) / int(period), CGROUP_V2
        except ValueError, ZeroDivisionError:
            return None, CGROUP_V2
    quota_us = _read_int(root / "cpu" / "cpu.cfs_quota_us")
    period_us = _read_int(root / "cpu" / "cpu.cfs_period_us")
    if quota_us is None or period_us is None:
        return None, HOST
    if quota_us <= 0 or period_us <= 0:
        return None, CGROUP_V1
    return quota_us / period_us, CGROUP_V1


def _visible_cores() -> int:
    process_count = getattr(os, "process_cpu_count", os.cpu_count)()
    return max(1, process_count or 1)


def windows_job_memory_limit() -> int | None:
    if sys.platform != "win32":
        return None
    from ctypes import wintypes

    class BasicLimits(ctypes.Structure):
        _fields_ = [
            ("PerProcessUserTimeLimit", ctypes.c_int64),
            ("PerJobUserTimeLimit", ctypes.c_int64),
            ("LimitFlags", wintypes.DWORD),
            ("MinimumWorkingSetSize", ctypes.c_size_t),
            ("MaximumWorkingSetSize", ctypes.c_size_t),
            ("ActiveProcessLimit", wintypes.DWORD),
            ("Affinity", ctypes.c_size_t),
            ("PriorityClass", wintypes.DWORD),
            ("SchedulingClass", wintypes.DWORD),
        ]

    class IoCounters(ctypes.Structure):
        _fields_ = [(f"Count{index}", ctypes.c_uint64) for index in range(6)]

    class ExtendedLimits(ctypes.Structure):
        _fields_ = [
            ("BasicLimitInformation", BasicLimits),
            ("IoInfo", IoCounters),
            ("ProcessMemoryLimit", ctypes.c_size_t),
            ("JobMemoryLimit", ctypes.c_size_t),
            ("PeakProcessMemoryUsed", ctypes.c_size_t),
            ("PeakJobMemoryUsed", ctypes.c_size_t),
        ]

    info = ExtendedLimits()
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    if not kernel32.QueryInformationJobObject(
        None,
        _JOB_OBJECT_EXTENDED_LIMIT_INFORMATION,
        ctypes.byref(info),
        ctypes.sizeof(info),
        None,
    ):
        return None
    flags = info.BasicLimitInformation.LimitFlags
    limits = []
    if flags & _JOB_OBJECT_LIMIT_JOB_MEMORY:
        limits.append(int(info.JobMemoryLimit))
    if flags & _JOB_OBJECT_LIMIT_PROCESS_MEMORY:
        limits.append(int(info.ProcessMemoryLimit))
    return min(limits) if limits else None


def detect(root: Path = CGROUP_ROOT, proc_cgroup: Path = PROC_SELF_CGROUP) -> Capacity:
    memory = psutil.virtual_memory()
    ram_total = int(memory.total)
    ram_available = int(memory.available)
    ram_source = HOST
    if sys.platform == "win32":
        job_limit = windows_job_memory_limit()
        if job_limit is not None and job_limit < ram_total:
            ram_total, ram_source = job_limit, JOB_OBJECT
            ram_available = min(ram_available, job_limit)
    else:
        reading = cgroup_memory(root, proc_cgroup)
        if reading.limit is not None and reading.limit < ram_total:
            ram_total, ram_source = reading.limit, reading.source
            if reading.usage is not None:
                ram_available = min(
                    ram_available, max(0, reading.limit - reading.usage)
                )

    cores = _visible_cores()
    cpu_source = AFFINITY if cores < (os.cpu_count() or cores) else HOST
    if sys.platform != "win32":
        quota, source = cgroup_cpu_limit(root, proc_cgroup)
        if quota is not None and math.floor(quota) < cores:
            cores, cpu_source = max(1, math.floor(quota)), source
    return Capacity(
        cores=cores,
        cpu_source=cpu_source,
        ram_total=ram_total,
        ram_available=ram_available,
        ram_source=ram_source,
    )


GENTLE = "gentle"
BALANCED = "balanced"
FAST = "fast"
INTENTIONS = (GENTLE, BALANCED, FAST)
LIGHT_LANE_MB = 600
HEAVY_LANE_MB = 750
SQLITE_MAX_WORKERS = 4
LOW_WATER_MB = 512
MAX_REPLICAS = 8
GPU_SHARE = 2
VRAM_SHARE = 0.8

CPU = "cpu"
GPU = "gpu"
UNKNOWN = "unknown"

WEB_MB = 300
SIDECAR_MB = {
    "image_similarity": 120,
    "thumbnail": 150,
    "exif": 150,
    "tags": 700,
    "image_captioning": 1100,
    "ocr": 600,
}
CORE_SIDECARS = ("image_similarity", "thumbnail", "exif", "tags")


@dataclass(frozen=True)
class ReplicaCost:
    ram_mb: int
    vram_mb: int = 0

    @property
    def limit_mb(self) -> int:
        return max(2 * self.ram_mb, self.ram_mb + 500)


FACE_COSTS: dict[tuple[str, str], ReplicaCost] = {
    ("buffalo_sc", CPU): ReplicaCost(250),
    ("buffalo_s", CPU): ReplicaCost(350),
    ("buffalo_m", CPU): ReplicaCost(450),
    ("buffalo_l", CPU): ReplicaCost(600),
    ("antelopev2", CPU): ReplicaCost(650),
    ("buffalo_sc", GPU): ReplicaCost(450, 150),
    ("buffalo_s", GPU): ReplicaCost(550, 200),
    ("buffalo_m", GPU): ReplicaCost(750, 450),
    ("buffalo_l", GPU): ReplicaCost(1100, 550),
    ("antelopev2", GPU): ReplicaCost(1250, 700),
}


def face_cost(pack: str, device: str) -> ReplicaCost:
    kind = CPU if device == CPU else GPU
    return FACE_COSTS.get((pack, kind)) or FACE_COSTS[("buffalo_l", kind)]


@dataclass(frozen=True)
class Gpu:
    total_mb: int
    free_mb: int


@dataclass(frozen=True)
class Load:
    sidecars_mb: int = sum(SIDECAR_MB[name] for name in CORE_SIDECARS)
    face: ReplicaCost | None = FACE_COSTS[("buffalo_sc", CPU)]
    face_device: str = CPU
    gpu: Gpu | None = None
    held_mb: int = 0
    held_vram_mb: int = 0
    face_override: int | None = None


DEFAULT_LOAD = Load()


@dataclass(frozen=True)
class WorkerPlan:
    intention: str
    workers: int
    heavy_workers: int
    budget_mb: int
    needed_mb: int
    limited_by: str
    fits: bool
    web_mb: int = WEB_MB
    sidecars_mb: int = 0
    face_replicas: int = 0
    face_replica_mb: int = 0
    face_vram_mb: int = 0
    face_device: str = CPU
    face_limited_by: str = "off"
    vram_budget_mb: int | None = None


def cores_for(intention: str, cores: int) -> int:
    if intention == GENTLE:
        return 1
    if intention == FAST:
        return min(8, max(1, cores - 1))
    return min(4, max(1, cores // 2))


def _vram_budget(load: Load) -> int | None:
    if load.gpu is None:
        return None
    return int(VRAM_SHARE * (load.gpu.free_mb + load.held_vram_mb))


def plan_face_replicas(
    load: Load, heavy: int, spare_mb: int
) -> tuple[int, str, int | None]:
    face = load.face
    vram_budget = _vram_budget(load)
    if face is None:
        return 0, "off", vram_budget
    limits = {"lanes": heavy}
    if load.face_device != CPU:
        if vram_budget is not None and face.vram_mb:
            limits["vram"] = vram_budget // face.vram_mb
            limits["gpu_share"] = GPU_SHARE
        else:
            limits["gpu"] = 1
    limits["memory"] = 1 + max(0, spare_mb) // face.ram_mb
    if load.face_override:
        limits["setting"] = load.face_override
    limited_by = min(limits, key=lambda key: limits[key])
    replicas = max(1, min(MAX_REPLICAS, limits[limited_by]))
    if replicas == MAX_REPLICAS and limits[limited_by] > MAX_REPLICAS:
        limited_by = "maximum"
    return replicas, limited_by, vram_budget


def plan_workers(
    found: Capacity,
    intention: str,
    *,
    sqlite: bool,
    override: int | None = None,
    load: Load = DEFAULT_LOAD,
) -> WorkerPlan:
    share = 0.8 if intention == FAST else 0.6
    available = found.ram_available / MB + load.held_mb
    budget = min(int(share * available), int(0.8 * found.ram_total / MB))
    face_mb = load.face.ram_mb if load.face is not None else 0
    base = WEB_MB + load.sidecars_mb + face_mb
    room = budget - base
    limits = {
        "intention": cores_for(intention, found.cores),
        "memory": room // LIGHT_LANE_MB,
    }
    if intention != GENTLE:
        limits["cores"] = found.cores
    if sqlite:
        limits["database"] = SQLITE_MAX_WORKERS
    if override:
        limits = {"setting": override}
    limited_by = min(limits, key=lambda key: limits[key])
    workers = max(1, limits[limited_by])
    heavy = max(1, min(workers, room // HEAVY_LANE_MB))
    spare = room - workers * LIGHT_LANE_MB - heavy * (HEAVY_LANE_MB - LIGHT_LANE_MB)
    replicas, face_limited_by, vram_budget = plan_face_replicas(load, heavy, spare)
    extra_face_mb = max(0, replicas - 1) * face_mb
    return WorkerPlan(
        intention=intention,
        workers=workers,
        heavy_workers=heavy,
        budget_mb=max(0, budget),
        needed_mb=base + extra_face_mb + workers * LIGHT_LANE_MB,
        limited_by=limited_by,
        fits=room >= LIGHT_LANE_MB,
        sidecars_mb=load.sidecars_mb,
        face_replicas=replicas,
        face_replica_mb=face_mb,
        face_vram_mb=load.face.vram_mb if load.face is not None else 0,
        face_device=load.face_device,
        face_limited_by=face_limited_by,
        vram_budget_mb=vram_budget,
    )


@dataclass(frozen=True)
class ReplicaTarget:
    replicas: int
    limit_mb: int
    threads: int = 0


def face_threads(cores: int, physical: int | None, replicas: int) -> int:
    usable = min(cores, physical or cores)
    return max(1, usable // max(1, replicas))


def low_water_mb(found: Capacity) -> float:
    return max(LOW_WATER_MB, 0.1 * found.ram_total / MB)


def low_on_memory(found: Capacity) -> bool:
    return found.ram_available / MB < low_water_mb(found)


def room_for_another_worker(found: Capacity) -> bool:
    return found.ram_available / MB >= low_water_mb(found) + LIGHT_LANE_MB
