"""Parse ``docker stats --no-stream --format '{{json .}}'`` samples written by sample_stats.sh."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

_UNITS = {
    "b": 1, "kb": 1000, "mb": 1000**2, "gb": 1000**3, "tb": 1000**4,
    "kib": 1024, "mib": 1024**2, "gib": 1024**3, "tib": 1024**4,
}
_SIZE = re.compile(r"^\s*([0-9.]+)\s*([A-Za-z]*)\s*$")


def parse_size(text: str) -> int:
    """``"1.5GiB"`` -> bytes. Unknown or empty -> 0."""
    match = _SIZE.match(text or "")
    if not match:
        return 0
    number, unit = match.groups()
    return int(float(number) * _UNITS.get(unit.lower() or "b", 1))


def parse_percent(text: str) -> float:
    try:
        return float((text or "").strip().rstrip("%") or 0)
    except ValueError:
        return 0.0


def load(path: Path) -> list[dict[str, Any]]:
    """One record per container sample: ``{t, name, cpu, mem}`` (cpu in % of one core, mem in bytes)."""
    records: list[dict[str, Any]] = []
    if not path.exists():
        return records
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        try:
            row = json.loads(line)
        except ValueError:
            continue
        sample = row.get("s") or {}
        records.append({
            "t": float(row.get("t", 0)),
            "name": sample.get("Name", "?"),
            "cpu": parse_percent(sample.get("CPUPerc", "")),
            "mem": parse_size((sample.get("MemUsage", "") or "").split("/")[0]),
        })
    return records


def summarise(records: list[dict[str, Any]], start: float, end: float) -> dict[str, Any]:
    """Peak and mean of the summed CPU/RAM of all containers between two timestamps.

    sample_stats.sh takes one ``docker stats`` snapshot per round; the rows of a
    round share its timestamp, so summing per timestamp gives the whole stack.
    """
    window = [r for r in records if start <= r["t"] <= end]
    rounds: dict[float, dict[str, float]] = {}
    per_container: dict[str, dict[str, float]] = {}
    for record in window:
        total = rounds.setdefault(record["t"], {"cpu": 0.0, "mem": 0.0})
        total["cpu"] += record["cpu"]
        total["mem"] += record["mem"]
        container = per_container.setdefault(record["name"], {"cpu_peak": 0.0, "mem_peak": 0.0})
        container["cpu_peak"] = max(container["cpu_peak"], record["cpu"])
        container["mem_peak"] = max(container["mem_peak"], record["mem"])
    if not rounds:
        return {"samples": 0}
    cpus = [r["cpu"] for r in rounds.values()]
    mems = [r["mem"] for r in rounds.values()]
    return {
        "samples": len(rounds),
        "seconds": round(end - start, 1),
        "cpu_percent_mean": round(sum(cpus) / len(cpus), 1),
        "cpu_percent_peak": round(max(cpus), 1),
        "mem_mib_mean": round(sum(mems) / len(mems) / 2**20, 1),
        "mem_mib_peak": round(max(mems) / 2**20, 1),
        "per_container_peak": {
            name: {"cpu_percent": round(v["cpu_peak"], 1), "mem_mib": round(v["mem_peak"] / 2**20, 1)}
            for name, v in sorted(per_container.items())
        },
    }


def quiet(records: list[dict[str, Any]], since: float, cpu_below: float, rounds_needed: int) -> bool:
    """Has the summed CPU stayed under ``cpu_below`` for the last ``rounds_needed`` rounds after ``since``?"""
    rounds: dict[float, float] = {}
    for record in records:
        if record["t"] >= since:
            rounds[record["t"]] = rounds.get(record["t"], 0.0) + record["cpu"]
    recent = [rounds[t] for t in sorted(rounds)[-rounds_needed:]]
    return len(recent) == rounds_needed and all(cpu < cpu_below for cpu in recent)
