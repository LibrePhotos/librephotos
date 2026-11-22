from __future__ import annotations

import ctypes
import math
import os
import sys
from dataclasses import dataclass
from pathlib import Path

import psutil

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
