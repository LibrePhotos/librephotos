from __future__ import annotations

import json
import os
import sys
import tempfile
import threading
import time
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import IO

REPLICA_KINDS = frozenset({"face_recognition"})
MAX_REPLICAS = 8
PORT_STRIDE = 100
REPLICA_FLAG = "--replica"
STATE_TTL_SECONDS = 120.0
STATE_CACHE_SECONDS = 1.0
DOWN_SECONDS = 10.0


def replica_port(base_port: int, index: int) -> int:
    return base_port + index * PORT_STRIDE


def replica_arguments(index: int) -> list[str]:
    return [] if index == 0 else [REPLICA_FLAG, str(index)]


def replica_argument(argv: Sequence[str]) -> int:
    for position, value in enumerate(argv[:-1]):
        if value == REPLICA_FLAG:
            try:
                index = int(argv[position + 1])
            except ValueError:
                return 0
            return index if 0 <= index < MAX_REPLICAS else 0
    return 0


def all_ports(services: dict[str, int]) -> dict[int, str]:
    taken: dict[int, str] = {}
    for service, port in services.items():
        indices = range(MAX_REPLICAS) if service in REPLICA_KINDS else range(1)
        for index in indices:
            replica = replica_port(port, index)
            name = service if index == 0 else f"{service} replica {index}"
            if replica in taken:
                raise ValueError(
                    f"port {replica} is used by both {taken[replica]} and {name}"
                )
            taken[replica] = name
    return taken


def runtime_dir() -> Path:
    return Path(tempfile.gettempdir()) / "librephotos-sidecars"


def state_path(service: str, base_port: int) -> Path:
    return runtime_dir() / f"{service}-{base_port}.json"


@dataclass(frozen=True)
class LiveReplicas:
    ports: tuple[int, ...]
    device: str | None = None


def write_live(
    service: str, base_port: int, ports: Sequence[int], device: str | None
) -> None:
    path = state_path(service, base_port)
    path.parent.mkdir(parents=True, exist_ok=True)
    body = json.dumps({"ports": list(ports), "device": device, "at": time.time()})
    staging = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    staging.write_text(body, encoding="utf-8")
    for _ in range(3):
        try:
            os.replace(staging, path)
            return
        except PermissionError:
            time.sleep(0.05)
    staging.unlink(missing_ok=True)


def clear_live(service: str, base_port: int) -> None:
    try:
        state_path(service, base_port).unlink(missing_ok=True)
    except OSError:
        pass


def read_live(service: str, base_port: int, now: float | None = None) -> LiveReplicas:
    primary = LiveReplicas((base_port,))
    try:
        body = json.loads(state_path(service, base_port).read_text(encoding="utf-8"))
    except OSError, ValueError:
        return primary
    if not isinstance(body, dict):
        return primary
    at = body.get("at")
    current = time.time() if now is None else now
    if not isinstance(at, int | float) or current - at > STATE_TTL_SECONDS:
        return primary
    ports = body.get("ports")
    if not isinstance(ports, list):
        return primary
    valid = tuple(
        port
        for port in ports
        if isinstance(port, int)
        and any(port == replica_port(base_port, i) for i in range(MAX_REPLICAS))
    )
    device = body.get("device")
    return LiveReplicas(
        valid or (base_port,), device if isinstance(device, str) else None
    )


class Router:
    def __init__(self) -> None:
        self.lane: int | None = None
        self.lock = threading.Lock()
        self.cache: dict[str, tuple[float, LiveReplicas]] = {}
        self.down: dict[int, float] = {}

    def live(self, service: str, base_port: int) -> LiveReplicas:
        now = time.monotonic()
        with self.lock:
            cached = self.cache.get(service)
            if cached is not None and now - cached[0] < STATE_CACHE_SECONDS:
                return cached[1]
        found = read_live(service, base_port)
        with self.lock:
            self.cache[service] = (now, found)
        return found

    def order(self, service: str, base_port: int) -> list[int]:
        ports = list(self.live(service, base_port).ports)
        now = time.monotonic()
        with self.lock:
            up = [port for port in ports if self.down.get(port, 0.0) <= now]
        ports = up or ports
        start = (os.getpid() if self.lane is None else self.lane) % len(ports)
        return ports[start:] + ports[:start]

    def mark_down(self, port: int) -> None:
        with self.lock:
            self.down[port] = time.monotonic() + DOWN_SECONDS


router = Router()


def set_lane(lane: int) -> None:
    router.lane = lane


def lock_path(port: int) -> Path:
    return runtime_dir() / f"port-{port}.lock"


def _try_lock(handle: IO[bytes]) -> bool:
    try:
        if sys.platform == "win32":
            import msvcrt

            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl

            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        return False
    return True


def _unlock(handle: IO[bytes]) -> None:
    try:
        if sys.platform == "win32":
            import msvcrt

            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl

            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
    except OSError:
        pass


def _open_lock(port: int) -> IO[bytes] | None:
    path = lock_path(port)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        return open(path, "a+b")
    except OSError:
        return None


@contextmanager
def claim(ports: Sequence[int]) -> Iterator[list[int]]:
    held: IO[bytes] | None = None
    chosen: int | None = None
    for port in ports:
        handle = _open_lock(port)
        if handle is None:
            continue
        if _try_lock(handle):
            held, chosen = handle, port
            break
        handle.close()
    try:
        if chosen is None:
            yield list(ports)
        else:
            yield [chosen, *(port for port in ports if port != chosen)]
    finally:
        if held is not None:
            _unlock(held)
            held.close()

