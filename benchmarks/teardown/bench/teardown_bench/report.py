"""Combine per-run results into results.json and markdown tables.

    python3 -m teardown_bench.report --results results --tools ../tools.json
"""

from __future__ import annotations

import argparse
import json
import platform
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

FIELDS = ("rating", "description", "keyword")
INTEROP_FIELDS = ("people_names", "face_boxes", "keywords_flat", "keywords_hierarchical", "hierarchy_kept",
                  "rating", "caption")


def get(data: Any, *keys: str, default: Any = None) -> Any:
    for key in keys:
        if not isinstance(data, dict) or key not in data:
            return default
        data = data[key]
    return data


def fmt(value: Any, unit: str = "") -> str:
    if value is None:
        return "n/a"
    if isinstance(value, float):
        value = f"{value:.0f}" if abs(value) >= 100 else f"{value:.1f}"
    return f"{value}{unit}"


def verdict(trip: dict | None) -> str:
    if not trip:
        return "n/a"
    if "error" in trip:
        return "error"
    places = trip.get("verdict", {})
    short = {"original": "file", "xmp-sidecar": "xmp", "app-sidecar": "app", "none": "-"}
    return " / ".join(short.get(places.get(f, "none"), "?") for f in FIELDS)


def exported(result: dict) -> str:
    found = get(result, "export", "metadata_in_export") or {}
    if not found:
        return "n/a"
    best = {f: any(v.get(f) for v in found.values()) for f in FIELDS}
    sidecars = len(get(result, "export", "sidecars_in_zip", default=[]) or [])
    return " / ".join("yes" if best[f] else "-" for f in best) + f" ({sidecars} sidecar files)"


def label(result: dict, tools: dict) -> str:
    tool = tools.get(result["tool"], {})
    return f"{tool.get('name', result['tool'])} {tool.get('version', '?')} ({result.get('mode', 'rw')})"


def table(header: list[str], rows: list[list[str]]) -> str:
    lines = ["| " + " | ".join(header) + " |", "|" + "---|" * len(header)]
    lines += ["| " + " | ".join(row) + " |" for row in rows]
    return "\n".join(lines)


def main_table(results: list[dict], tools: dict) -> str:
    rows = []
    for result in results:
        tool = tools.get(result["tool"], {})
        index_cell = (fmt(get(result, "index", "seconds")) if get(result, "index", "complete")
                      else f"> {fmt(get(result, 'index', 'timed_out_after'))}")
        rows.append([
            label(result, tools), str(len(tool.get("documented_setup_steps", []))),
            fmt(result.get("startup_seconds")), index_cell,
            f"{fmt(get(result, 'counts', 'found'))} / {fmt(get(result, 'counts', 'expected_media_files'))}",
            fmt(get(result, "resources", "idle_after_index", "mem_mib_mean")),
            fmt(get(result, "resources", "indexing", "mem_mib_peak")),
            fmt(get(result, "resources", "indexing", "cpu_percent_peak")),
            exported(result), "yes" if result.get("within_budget") else "no",
        ])
    return table(["Run", "Documented setup steps", "Startup (s)", "Index (s)", "Found / expected",
                  "Idle RAM (MiB)", "Peak RAM (MiB)", "Peak CPU (%)", "Edits in export (r/d/k)",
                  "Within 10 min"], rows)


def writeback_table(results: list[dict], tools: dict) -> str:
    rows = []
    for result in results:
        trips = result.get("roundtrip") or {}
        for name, trip in trips.items():
            faces = trip.get("face_regions") or {}
            face_cell = (f"{faces.get('photos_with_regions_on_disk')}/{faces.get('photos_with_faces')}"
                         if faces else "n/a")
            rows.append([label(result, tools), name, trip.get("setting", "defaults"), verdict(trip),
                         "yes" if trip.get("original_modified") else "no", face_cell])
        if not trips:
            rows.append([label(result, tools), "-", "-", "n/a", "n/a", "n/a"])
    return table(["Run", "Round-trip", "Setting", "rating / description / keyword", "Original rewritten",
                  "Face regions on disk (photos)"], rows)


def interop_table(results: list[dict], tools: dict) -> str:
    rows = []
    for result in results:
        for convention, scores in sorted((get(result, "interop", "by_convention") or {}).items()):
            rows.append([label(result, tools), convention, fmt(scores.get("found"))]
                        + [fmt(scores.get(f)) for f in INTEROP_FIELDS])
    return table(["Run", "Convention", "Found"] + [f.replace("_", " ") for f in INTEROP_FIELDS], rows)


def safety_table(results: list[dict], tools: dict) -> str:
    rows = []
    for result in results:
        diff = result.get("file_safety") or {}
        delete = result.get("delete") or {}
        policy = delete.get("trash_policy") or {}
        expiry = (f"{policy.get('days')} days" if policy.get("auto_expiry")
                  else "off" if policy.get("auto_expiry") is False else "n/a")
        rows.append([
            label(result, tools),
            str(len(diff.get("moved_or_renamed", []))), str(len(diff.get("deleted", []))),
            str(len(diff.get("rewritten_unexpected", []))), str(len(diff.get("created_unexpected", []))),
            "yes" if delete.get("original_removed_from_disk") else "no" if delete else "n/a",
            ", ".join(delete.get("sidecars_removed_from_disk") or []) or "-",
            expiry,
        ])
    return table(["Run", "Moved/renamed", "Deleted", "Rewritten (unasked)", "Created (unasked)",
                  "Permanent delete removes original", "Sidecars removed", "Auto trash expiry"], rows)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--results", type=Path, required=True)
    parser.add_argument("--tools", type=Path, required=True)
    args = parser.parse_args()

    tools = json.loads(args.tools.read_text(encoding="utf-8"))["tools"]
    results = []
    for path in sorted(args.results.glob("*.json")):
        if path.name == "results.json" or path.name.endswith(".images.json"):
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        images = path.with_name(path.stem + ".images.json")
        if images.exists():
            data["images"] = json.loads(images.read_text(encoding="utf-8"))
        results.append(data)
    combined = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "runner": {"platform": platform.platform(), "machine": platform.machine(),
                   "python": platform.python_version()},
        "tools": tools,
        "results": results,
    }
    (args.results / "results.json").write_text(json.dumps(combined, indent=1, default=str) + "\n",
                                               encoding="utf-8")
    errors = "; ".join(f"{r['tool']}-{r.get('mode', 'rw')}: {e['phase']}" for r in results
                       for e in r.get("errors", []))
    markdown = [
        "# Teardown benchmark results",
        "",
        f"Generated {combined['generated']} on `{combined['runner']['platform']}`. `rw` / `ro` = library "
        "mounted read-write / read-only. Write-back cells read `rating / description / keyword`: `file` = "
        "written into the original, `xmp` = XMP sidecar, `app` = the app's own sidecar format, `-` = not "
        "written anywhere. Interop scores are the share of fixtures (0 to 1) whose value the app shows "
        "after indexing; `n/a` = the convention carries no such field.",
        "",
        "## Indexing, resources, export",
        "",
        main_table(results, tools),
        "",
        "## Metadata write-back (defaults, then each write-back switch)",
        "",
        writeback_table(results, tools),
        "",
        "## Interop: curation from other tools visible after indexing",
        "",
        interop_table(results, tools),
        "",
        "## File safety and delete",
        "",
        safety_table(results, tools),
        "",
        f"Errors: {errors or 'none'}",
        "",
    ]
    (args.results / "results.md").write_text("\n".join(markdown), encoding="utf-8")
    print("\n".join(markdown))
    return 0


if __name__ == "__main__":
    sys.exit(main())
