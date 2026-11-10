"""What the server stats say about the CPU, in the keys py-cpuinfo used.

``/api/serverstats/`` reported py-cpuinfo's ``get_cpu_info()``, which starts a
Python subprocess on every call (about 1.8 s). This module reads the same
facts directly and keeps the keys and types of that answer
(``CpuInfoSerializer``):

* Always there: ``python_version``, ``arch`` (py-cpuinfo's names: ``X86_64``,
  ``ARM_8``, ...), ``bits``, ``count``, ``arch_string_raw``, and
  ``cpuinfo_version`` / ``cpuinfo_version_string``, which name no py-cpuinfo
  any more and are ``[]`` and ``""``.
* Where the platform tells, without a subprocess: Linux ``/proc/cpuinfo`` and
  ``/sys/devices/system/cpu/cpu0/cache``, the Windows registry, macOS
  ``sysctlbyname``. A key that cannot be read is left out, as py-cpuinfo did
  (an ARM board names no brand; Windows has no flags list).

Nothing here raises: a platform reader that fails leaves its keys out.
"""

from __future__ import annotations

import logging
import os
import platform
import re
import sys
from collections.abc import Callable, Mapping

logger = logging.getLogger(__name__)

CpuInfo = dict[str, object]

PROC_CPUINFO = "/proc/cpuinfo"
SYS_CACHE = "/sys/devices/system/cpu/cpu0/cache"
WINDOWS_CPU_KEY = r"HARDWARE\DESCRIPTION\System\CentralProcessor\0"

# platform.machine() -> py-cpuinfo's arch name.
_ARCHES = (
    (r"^(x86_64|amd64|x64|i86pc)$", "X86_64"),
    (r"^(i[3-6]86|x86|i86)$", "X86_32"),
    (r"^(aarch64|arm64|armv8.*)$", "ARM_8"),
    (r"^armv7.*$", "ARM_7"),
    (r"^(ppc64|ppc64le)$", "PPC_64"),
    (r"^(ppc|ppc32|powerpc)$", "PPC_32"),
    (r"^s390x$", "S390X"),
    (r"^riscv64$", "RISCV_64"),
    (r"^riscv32$", "RISCV_32"),
    (r"^loongarch64$", "LOONG_64"),
    (r"^mips64.*$", "MIPS_64"),
    (r"^mips.*$", "MIPS_32"),
)


def _arch(machine: str) -> str:
    for pattern, name in _ARCHES:
        if re.match(pattern, machine.lower()):
            return name
    return machine.upper()


def _bits() -> int:
    return 64 if sys.maxsize > 2**32 else 32


def friendly_hz(hz: int) -> str:
    """py-cpuinfo's spelling of a clock: ``3.9000 GHz``."""
    return f"{hz / 1_000_000_000:.4f} GHz"


def _hz(info: CpuInfo, key: str, hz: int | None) -> None:
    if hz:
        info[key] = [hz, 0]
        info[f"{key}_friendly"] = friendly_hz(hz)


def _int(value: object) -> int | None:
    try:
        return int(str(value).strip(), 0)
    except ValueError:
        return None


def _put(info: CpuInfo, key: str, value: object) -> None:
    """Set ``key`` unless ``value`` is empty or 0, which py-cpuinfo left out."""
    if value not in (None, "", 0, []):
        info[key] = value


def _base() -> CpuInfo:
    machine = platform.machine()
    return {
        "python_version": ".".join(str(part) for part in sys.version_info)
        + f" ({_bits()} bit)",
        "cpuinfo_version": [],
        "cpuinfo_version_string": "",
        "arch": _arch(machine),
        "bits": _bits(),
        "count": os.cpu_count() or 0,
        "arch_string_raw": machine,
    }


# ------------------------------------------------------------------ Linux
def _proc_fields(text: str) -> dict[str, str]:
    """The first processor's ``key: value`` lines (and the board-wide ones)."""
    fields: dict[str, str] = {}
    for line in text.splitlines():
        key, sep, value = line.partition(":")
        key = key.strip().lower()
        if sep and key and key not in fields:
            fields[key] = value.strip()
    return fields


_MODEL_HZ = re.compile(r"@\s*([0-9.]+)\s*([GM])Hz", re.IGNORECASE)


def from_proc_cpuinfo(text: str) -> CpuInfo:
    """What ``/proc/cpuinfo`` says (x86 and ARM spell it differently)."""
    fields = _proc_fields(text)
    info: CpuInfo = {}
    _put(info, "vendor_id_raw", fields.get("vendor_id"))
    _put(info, "hardware_raw", fields.get("hardware"))
    _put(info, "brand_raw", fields.get("model name"))
    flags = fields.get("flags") or fields.get("features") or ""
    _put(info, "flags", sorted(flags.split()))
    for key, name in (
        ("stepping", "stepping"),
        ("model", "model"),
        ("cpu family", "family"),
    ):
        _put(info, name, _int(fields.get(key, "")))
    advertised = _MODEL_HZ.search(fields.get("model name", ""))
    if advertised:
        scale = 1_000_000_000 if advertised.group(2).upper() == "G" else 1_000_000
        _hz(info, "hz_advertised", int(float(advertised.group(1)) * scale))
    mhz = fields.get("cpu mhz")
    if mhz:
        try:
            _hz(info, "hz_actual", int(float(mhz) * 1_000_000))
        except ValueError:
            pass
    return info


_SIZE = re.compile(r"^\s*(\d+)\s*([KMG]?)", re.IGNORECASE)


def _size_bytes(text: str) -> int | None:
    match = _SIZE.match(text)
    if not match:
        return None
    return (
        int(match.group(1))
        * {"": 1, "K": 1024, "M": 1024**2, "G": 1024**3}[match.group(2).upper()]
    )


def from_sys_cache(read: Callable[[str], str | None]) -> CpuInfo:
    """Cache sizes from ``/sys/devices/system/cpu/cpu0/cache/index*``.

    ``read(name)`` answers the content of ``index<N>/<file>`` or None.
    """
    info: CpuInfo = {}
    for index in range(8):
        level = read(f"index{index}/level")
        kind = read(f"index{index}/type")
        size = read(f"index{index}/size")
        if level is None or kind is None or size is None:
            continue
        key = {
            ("1", "data"): "l1_data_cache_size",
            ("1", "instruction"): "l1_instruction_cache_size",
            ("2", "unified"): "l2_cache_size",
            ("3", "unified"): "l3_cache_size",
        }.get((level.strip(), kind.strip().lower()))
        bytes_ = _size_bytes(size)
        if key and bytes_:
            info[key] = bytes_
        if key == "l2_cache_size":
            _put(
                info,
                "l2_cache_line_size",
                _int(read(f"index{index}/coherency_line_size") or ""),
            )
            _put(
                info,
                "l2_cache_associativity",
                _int(read(f"index{index}/ways_of_associativity") or ""),
            )
    return info


def _read_text(path: str) -> str | None:
    try:
        with open(path, encoding="utf-8", errors="replace") as handle:
            return handle.read()
    except OSError:
        return None


def _linux() -> CpuInfo:
    info = from_proc_cpuinfo(_read_text(PROC_CPUINFO) or "")
    info.update(from_sys_cache(lambda name: _read_text(os.path.join(SYS_CACHE, name))))
    return info


# ---------------------------------------------------------------- Windows
_IDENTIFIER = re.compile(r"Family (\d+) Model (\d+) Stepping (\d+)", re.IGNORECASE)


def from_windows_registry(values: Mapping[str, object]) -> CpuInfo:
    """What ``HKLM\\...\\CentralProcessor\\0`` says."""
    info: CpuInfo = {}
    _put(info, "brand_raw", str(values.get("ProcessorNameString") or "").strip())
    _put(info, "vendor_id_raw", str(values.get("VendorIdentifier") or "").strip())
    identifier = _IDENTIFIER.search(str(values.get("Identifier") or ""))
    if identifier:
        family, model, stepping = (int(group) for group in identifier.groups())
        _put(info, "family", family)
        _put(info, "model", model)
        _put(info, "stepping", stepping)
    mhz = _int(values.get("~MHz", ""))
    if mhz:
        _hz(info, "hz_advertised", mhz * 1_000_000)
        _hz(info, "hz_actual", mhz * 1_000_000)
    return info


def _windows() -> CpuInfo:
    if sys.platform != "win32":  # winreg exists on Windows only
        return {}
    import winreg

    values: dict[str, object] = {}
    with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, WINDOWS_CPU_KEY) as key:
        for name in ("ProcessorNameString", "VendorIdentifier", "Identifier", "~MHz"):
            try:
                values[name] = winreg.QueryValueEx(key, name)[0]
            except OSError:
                continue
    return from_windows_registry(values)


# ------------------------------------------------------------------ macOS
def from_sysctl(get: Callable[[str], str | int | None]) -> CpuInfo:
    """What ``sysctlbyname`` says; ``get(name)`` answers a value or None."""
    info: CpuInfo = {}
    _put(info, "brand_raw", str(get("machdep.cpu.brand_string") or "").strip())
    _put(info, "vendor_id_raw", str(get("machdep.cpu.vendor") or "").strip())
    features = (
        f"{get('machdep.cpu.features') or ''} {get('machdep.cpu.leaf7_features') or ''}"
    )
    _put(info, "flags", sorted({flag.lower() for flag in features.split()}))
    for name, key in (
        ("machdep.cpu.stepping", "stepping"),
        ("machdep.cpu.model", "model"),
        ("machdep.cpu.family", "family"),
        ("hw.l2cachesize", "l2_cache_size"),
        ("hw.l3cachesize", "l3_cache_size"),
        ("hw.l1dcachesize", "l1_data_cache_size"),
        ("hw.l1icachesize", "l1_instruction_cache_size"),
    ):
        _put(info, key, _int(get(name) or ""))
    hz = _int(get("hw.cpufrequency") or "")  # Intel Macs only
    _hz(info, "hz_advertised", hz)
    _hz(info, "hz_actual", hz)
    return info


def _sysctl_reader() -> Callable[[str], str | int | None]:
    import ctypes
    import ctypes.util

    libc = ctypes.CDLL(ctypes.util.find_library("c"), use_errno=True)

    def get(name: str) -> str | int | None:
        size = ctypes.c_size_t(0)
        if libc.sysctlbyname(name.encode(), None, ctypes.byref(size), None, 0) != 0:
            return None
        buffer = ctypes.create_string_buffer(size.value)
        if libc.sysctlbyname(name.encode(), buffer, ctypes.byref(size), None, 0) != 0:
            return None
        raw = buffer.raw[: size.value]
        if name in _SYSCTL_NUMBERS:
            return int.from_bytes(raw, sys.byteorder)
        return raw.rstrip(b"\0").decode(errors="replace")

    return get


# The sysctl values ``from_sysctl`` reads as integers; the rest are strings.
_SYSCTL_NUMBERS = frozenset(
    {
        "machdep.cpu.stepping",
        "machdep.cpu.model",
        "machdep.cpu.family",
        "hw.l2cachesize",
        "hw.l3cachesize",
        "hw.l1dcachesize",
        "hw.l1icachesize",
        "hw.cpufrequency",
    }
)


def _macos() -> CpuInfo:
    return from_sysctl(_sysctl_reader())


_READERS: dict[str, Callable[[], CpuInfo]] = {
    "linux": _linux,
    "win32": _windows,
    "darwin": _macos,
}


def get_cpu_info() -> CpuInfo:
    """The CPU, in py-cpuinfo's keys; never raises."""
    info = _base()
    reader = next(
        (read for prefix, read in _READERS.items() if sys.platform.startswith(prefix)),
        None,
    )
    if reader is not None:
        try:
            info.update(reader())
        # What a missing file, registry key or library, or an unexpected
        # value in one, raises; the base keys still answer.
        except OSError, ValueError, TypeError, LookupError, AttributeError:
            logger.debug("could not read the CPU details", exc_info=True)
    return info
