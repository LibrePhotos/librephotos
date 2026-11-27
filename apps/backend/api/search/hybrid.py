from __future__ import annotations

from collections import defaultdict
from collections.abc import Hashable, Sequence
from dataclasses import dataclass


@dataclass(frozen=True)
class FusionSettings:
    rrf_k: int = 60
    lexical_weight: float = 1.0
    semantic_weight: float = 1.0
    semantic_floor: float = 0.0


def cut_semantic[KeyT: Hashable](
    scored: Sequence[tuple[KeyT, float]], floor: float
) -> list[KeyT]:
    return [key for key, score in scored if score >= floor]


def fuse[KeyT: Hashable](
    lexical: Sequence[KeyT],
    semantic: Sequence[KeyT],
    settings: FusionSettings,
) -> list[KeyT]:
    totals: dict[KeyT, float] = defaultdict(float)
    for weight, ranked in (
        (settings.lexical_weight, lexical),
        (settings.semantic_weight, semantic),
    ):
        for rank, key in enumerate(ranked):
            totals[key] += weight / (settings.rrf_k + rank + 1)
    order: dict[KeyT, int] = {}
    for i, key in enumerate([*lexical, *semantic]):
        order.setdefault(key, i)
    return sorted(totals, key=lambda key: (-totals[key], order[key]))
