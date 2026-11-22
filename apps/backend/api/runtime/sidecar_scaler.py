from __future__ import annotations

import logging
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from django.db import DatabaseError

from api.runtime import replicas, supervisor
from api.runtime.replicas import MAX_REPLICAS, REPLICA_KINDS, replica_port
from api.runtime.sidecars import SERVICES

logger = logging.getLogger(__name__)

IDLE_EXIT_SECONDS = 120.0
HUNG_ROUNDS = 12
LEASE_SECONDS = 120.0


@dataclass
class _Replica:
    silent_rounds: int = 0
    unwanted_since: float | None = None


@dataclass
class _Kind:
    ceiling: int = MAX_REPLICAS
    device: str | None = None
    replicas: dict[int, _Replica] = field(default_factory=dict)
    wanted: int = 1


class ReplicaScaler:
    def __init__(
        self,
        target: Callable[[], tuple[int, int]],
        demand: Callable[[], int],
        memory_low: Callable[[], bool],
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.target = target
        self.demand = demand
        self.memory_low = memory_low
        self.clock = clock
        self.kinds: dict[str, _Kind] = {service: _Kind() for service in REPLICA_KINDS}
        self.holder = uuid.uuid4().hex

    def __call__(self, heavy_width: int) -> None:
        for service in sorted(REPLICA_KINDS):
            try:
                self.scale(service, heavy_width)
            except DatabaseError as error:
                logger.warning("Could not scale %s: %s", service, error)

    def scale(self, service: str, heavy_width: int) -> None:
        kind = self.kinds[service]
        base = SERVICES[service]
        if not supervisor.is_service_enabled(service):
            supervisor.stop_extra_replicas(service)
            replicas.write_live(service, base, [base], kind.device)
            kind.replicas.clear()
            return
        planned, limit_mb = self.target()
        allowed = max(1, min(planned, heavy_width))
        low = self.memory_low()
        running = supervisor.replica_processes(service)
        if low:
            kind.ceiling = max(1, min(kind.ceiling, len(running)) - 1)
        else:
            kind.ceiling = MAX_REPLICAS
        allowed = min(allowed, kind.ceiling)
        wanted = max(1, min(allowed, self.demand()))
        if wanted != kind.wanted:
            logger.info(
                "%s: %s of %s allowed replicas wanted (%s heavy lanes)",
                service,
                wanted,
                allowed,
                heavy_width,
            )
        kind.wanted = wanted
        sizes = supervisor.sidecar_rss_mb().get(service, {})
        self._watch_primary(service, sizes.get(0, 0), limit_mb, kind)
        missing = [index for index in range(1, wanted) if index not in running]
        if missing:
            self._start(service, missing)
            running = supervisor.replica_processes(service)
        live = [base]
        for index in range(1, MAX_REPLICAS):
            if index not in running:
                kind.replicas.pop(index, None)
                continue
            state = kind.replicas.setdefault(index, _Replica())
            if index < wanted:
                state.unwanted_since = None
                if self._serves(service, index, state, sizes.get(index, 0), limit_mb):
                    live.append(replica_port(base, index))
            else:
                self._retire(service, index, state, index >= allowed or low)
        replicas.write_live(service, base, live, kind.device)

    def _watch_primary(
        self, service: str, rss_mb: int, limit_mb: int, kind: _Kind
    ) -> None:
        probe, health = supervisor.probe_replica(service, 0)
        if probe is not supervisor.Probe.ANSWERED or health is None:
            return
        self._learn_device(kind, health)
        if limit_mb and rss_mb > limit_mb and not health.get("busy"):
            logger.warning(
                "%s at %s MB, over its limit of %s MB: restarting it",
                service,
                rss_mb,
                limit_mb,
            )
            self._leased(service, 0, lambda: supervisor.restart_service(service))

    def _learn_device(self, kind: _Kind, health: dict[str, Any]) -> None:
        device = health.get("device")
        if isinstance(device, str):
            kind.device = device

    def _start(self, service: str, indices: list[int]) -> None:
        def start() -> None:
            supervisor.start_replicas(service, indices)

        self._leased(service, -1, start)

    def _serves(
        self, service: str, index: int, state: _Replica, rss_mb: int, limit_mb: int
    ) -> bool:
        probe, health = supervisor.probe_replica(service, index)
        if probe is supervisor.Probe.ANSWERED and health is not None:
            state.silent_rounds = 0
            self._learn_device(self.kinds[service], health)
            if limit_mb and rss_mb > limit_mb:
                logger.warning(
                    "Replica %s of %s at %s MB, over its limit of %s MB: restarting it",
                    index,
                    service,
                    rss_mb,
                    limit_mb,
                )
                self._restart(service, index)
                return False
            return True
        if probe is supervisor.Probe.FOREIGN:
            return False
        state.silent_rounds += 1
        if state.silent_rounds >= HUNG_ROUNDS:
            logger.warning(
                "Replica %s of %s does not answer: restarting it", index, service
            )
            state.silent_rounds = 0
            self._restart(service, index)
        return False

    def _restart(self, service: str, index: int) -> None:
        def restart() -> None:
            supervisor.stop_replica(service, index)
            supervisor.start_replicas(service, [index])

        self._leased(service, index, restart)

    def _retire(self, service: str, index: int, state: _Replica, at_once: bool) -> None:
        now = self.clock()
        if state.unwanted_since is None:
            state.unwanted_since = now
        probe, health = supervisor.probe_replica(service, index)
        busy = bool(health and health.get("busy"))
        if busy:
            return
        last = health.get("last_request_time") if health else None
        idle = (
            probe is not supervisor.Probe.ANSWERED
            or last is None
            or time.time() - last >= IDLE_EXIT_SECONDS
        )
        waited = now - state.unwanted_since >= IDLE_EXIT_SECONDS
        if at_once or idle or waited:
            self._leased(
                service, index, lambda: supervisor.stop_replica(service, index)
            )

    def _leased(self, service: str, index: int, action: Callable[[], object]) -> None:
        from api.models.sidecar_watch_lease import SidecarWatchLease

        key = supervisor.watch_key(service if index == 0 else f"{service}#{index}")
        try:
            taken = SidecarWatchLease.objects.take(key, self.holder, LEASE_SECONDS)
        except DatabaseError as error:
            logger.warning("Scaling %s without a lease: %s", service, error)
            taken = True
        if not taken:
            return
        try:
            action()
        finally:
            try:
                SidecarWatchLease.objects.give_back(key, self.holder)
            except DatabaseError as error:
                logger.warning("Could not give back the lease of %s: %s", key, error)

    def stop(self) -> None:
        for service in REPLICA_KINDS:
            supervisor.stop_extra_replicas(service)
            replicas.clear_live(service, SERVICES[service])
