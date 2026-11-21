from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field

DEFAULT_QUEUE = "default"


@dataclass
class WorkerSettings:
    queues: Sequence[str] = (DEFAULT_QUEUE,)
    caps: Mapping[str, int] = field(default_factory=dict)
    poll_seconds: float = 1.0
    recycle_rss_mb: int = 0
    memory_limit_mb: int = 0
    watchdog_seconds: float = 2.0
