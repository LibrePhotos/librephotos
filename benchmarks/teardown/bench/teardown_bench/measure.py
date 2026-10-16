"""Measure one running app: ready, index, resources, counts, interop, round-trips, export, file safety, delete.

Called by run_tool.sh after ``docker compose up -d``; it never starts or stops
containers itself. Writes one JSON result even when a phase fails, so a broken
app shows up as a broken row instead of a missing one.

    python3 -m teardown_bench.measure --tool immich --work /tmp/teardown/immich \\
        --lock data/meta/dataset.lock.json --stats /tmp/teardown/immich/stats.jsonl \\
        --t0 1760000000.0 --out results/immich.json
"""

from __future__ import annotations

import argparse
import io
import json
import secrets
import sys
import tempfile
import time
import traceback
import zipfile
from pathlib import Path
from typing import Any

from . import checks, exif, stats
from .adapters import ADAPTERS, Adapter, PhotoRef

RATING = 4
POLL = 5.0
STABLE_POLLS = 3  # idle this many polls in a row (15 s) before indexing counts as done
QUIET_CPU = 15.0  # summed % of one core across the stack: "nothing is working any more"


def now() -> float:
    return time.time()


class Budget:
    """The whole run (startup to export) must stay under ``total`` seconds."""

    def __init__(self, t0: float, total: float) -> None:
        self.t0, self.total = t0, total

    def left(self) -> float:
        return self.total - (now() - self.t0)


def wait_ready(app: Adapter, deadline: float) -> bool:
    while now() < deadline:
        try:
            if app.ready():
                return True
        except Exception:  # noqa: BLE001 - not up yet
            pass
        time.sleep(3)
    return False


def index(app: Adapter, stats_path: Path, deadline: float) -> dict[str, Any]:
    """Start indexing and poll until the app's queues and the CPU are idle, or the deadline."""
    started = now()
    app.start_index()
    polls: list[dict[str, Any]] = []
    idle_streak, first_idle = 0, None
    api_streak, api_first_idle = 0, None
    while now() < deadline:
        time.sleep(POLL)
        try:
            busy, detail = app.busy()
            count = app.counts().get("total") or 0
        except Exception as error:  # noqa: BLE001 - a flaky poll is not the end
            polls.append({"t": round(now() - started, 1), "error": str(error)[:200]})
            continue
        cpu_quiet = stats.quiet(stats.load(stats_path), since=started, cpu_below=QUIET_CPU, rounds_needed=3)
        api_idle = (not busy) and count > 0
        polls.append({"t": round(now() - started, 1), "busy": busy, "cpu_quiet": cpu_quiet,
                      "count": count, **{k: v for k, v in detail.items() if v}})
        # The app's own job API, kept apart so a stack that never gets quiet still shows when its
        # queues emptied.
        if api_idle:
            api_streak += 1
            api_first_idle = api_first_idle or now()
        else:
            api_streak, api_first_idle = 0, None
        if api_idle and cpu_quiet:
            idle_streak += 1
            first_idle = first_idle or now()
            if idle_streak >= STABLE_POLLS:
                return {"complete": True, "seconds": round(first_idle - started, 1), "started": started,
                        "ended": first_idle, "api_idle_seconds": round(api_first_idle - started, 1),
                        "polls": polls[-40:]}
        else:
            idle_streak, first_idle = 0, None
    api_idle_seconds = (round(api_first_idle - started, 1)
                        if api_first_idle and api_streak >= STABLE_POLLS else None)
    return {"complete": False, "seconds": None, "timed_out_after": round(now() - started, 1),
            "api_idle_seconds": api_idle_seconds,
            "note": "queues empty but CPU never settled" if api_idle_seconds else "still working at the deadline",
            "started": started, "ended": now(), "polls": polls[-40:]}


def roundtrip(app: Adapter, relative: str, label: str, wait: float) -> dict[str, Any]:
    """Set rating, description and keyword through the API, then look at the file and its sidecars."""
    ref = app.find(relative)
    if ref is None:
        return {"target": relative, "error": "photo not found through the API"}
    nonce = secrets.token_hex(4)
    description = f"teardown {app.name} {label} {nonce}"
    keyword = f"teardown-{label}-{nonce}"
    extra = app.app_sidecars(ref)
    before_state = exif.snapshot(ref.host_path, extra)
    baseline = exif.where_written(ref.host_path, before_state, RATING, description, keyword, extra)["fields"]
    api = app.set_metadata(ref, RATING, description, keyword)
    written: dict[str, Any] = {}
    deadline = now() + wait
    while now() < deadline:
        time.sleep(POLL)
        written = exif.where_written(ref.host_path, before_state, RATING, description, keyword, extra)
        for field, places in baseline.items():  # a value the file already had is no credit
            written["fields"][field] = [p for p in written["fields"][field] if p not in places]
        if all(written["fields"].values()):
            break
    return {"target": relative, "app_path": ref.app_path, "api": api, **written,
            "verdict": exif.classify(written.get("fields", {})), "description": description,
            "keyword": keyword, "_ref": ref}


def export_check(app: Adapter, refs: list[PhotoRef], trips: list[dict[str, Any]]) -> dict[str, Any]:
    """Download the edited photos as the app's export and see whether the edits travel."""
    body = app.export(refs)
    try:
        archive = zipfile.ZipFile(io.BytesIO(body))
    except zipfile.BadZipFile:
        return {"error": "not a zip", "bytes": len(body)}
    members = [m for m in archive.namelist() if not m.endswith("/")]
    sidecars = [m for m in members if m.lower().endswith((".xmp", ".yml", ".yaml", ".json"))]
    found: dict[str, dict[str, bool]] = {}
    with tempfile.TemporaryDirectory() as tmp:
        archive.extractall(tmp)
        paths = [p for p in Path(tmp).rglob("*") if p.is_file()]
        tags = exif.read_tags(paths)
        for trip in trips:
            if "description" not in trip:
                continue
            hits = {"rating": False, "description": False, "keyword": False}
            for row in tags.values():
                for field, keys in exif.locate(row, RATING, trip["description"], trip["keyword"]).items():
                    hits[field] = hits[field] or bool(keys)
            for path in paths:
                if path.suffix.lower() in (".yml", ".yaml", ".json"):
                    for field, keys in exif.text_locate(path, RATING, trip["description"],
                                                        trip["keyword"]).items():
                        hits[field] = hits[field] or bool(keys)
            found[trip["label"]] = hits
    return {"bytes": len(body), "members": len(members), "names": members[:20], "sidecars_in_zip": sidecars,
            "metadata_in_export": found}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--tool", choices=sorted(ADAPTERS), required=True)
    parser.add_argument("--mode", choices=["rw", "ro"], default="rw",
                        help="how the library is mounted (recorded; run_tool.sh does the mounting)")
    parser.add_argument("--work", required=True, type=Path)
    parser.add_argument("--lock", required=True, type=Path)
    parser.add_argument("--interop", type=Path, help="meta/interop.json (interop fixtures)")
    parser.add_argument("--stats", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--t0", type=float, default=now(), help="epoch seconds when compose up started")
    parser.add_argument("--budget", type=float, default=600, help="whole run, startup to the delete test (s)")
    parser.add_argument("--ready-timeout", type=float, default=240)
    parser.add_argument("--idle-seconds", type=float, default=20)
    parser.add_argument("--roundtrip-wait", type=float, default=30)
    args = parser.parse_args()

    lock = json.loads(args.lock.read_text(encoding="utf-8"))
    fixtures = (json.loads(args.interop.read_text(encoding="utf-8"))["fixtures"]
                if args.interop and args.interop.exists() else [])
    app = ADAPTERS[args.tool](args.work)
    modes = app.write_back_modes()
    budget = Budget(args.t0, args.budget)
    result: dict[str, Any] = {"tool": args.tool, "mode": args.mode, "budget_seconds": args.budget, "errors": [],
                              "expected": lock["counts"], "dataset_profile": lock["profile"]}

    def phase(name: str, call: Any) -> Any:
        try:
            return call()
        except Exception as error:  # noqa: BLE001 - record and keep measuring
            result["errors"].append({"phase": name, "error": f"{type(error).__name__}: {error}"[:500],
                                     "trace": traceback.format_exc(limit=3)[-800:]})
            return None

    def save() -> None:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(result, indent=1, default=str) + "\n", encoding="utf-8")

    # Before anything can touch the library: the path + hash manifest the file-safety check compares with.
    tree_before = checks.tree(app.library)

    ready = wait_ready(app, now() + min(args.ready_timeout, budget.left()))
    result["startup_seconds"] = round(now() - args.t0, 1) if ready else None
    result["ready"] = ready
    if not ready:
        result["errors"].append({"phase": "ready", "error": f"API not ready after {args.ready_timeout}s"})
        save()
        return 1

    phase("bootstrap", app.bootstrap)
    idle_start = now()
    time.sleep(min(args.idle_seconds, max(0, budget.left() - 300)))
    result["resources"] = {"idle_after_start": stats.summarise(stats.load(args.stats), idle_start, now())}

    # Room after indexing: idle window, interop read, one round-trip per mode (+ face write),
    # export and the delete test.
    reserve = args.idle_seconds + (1 + len(modes)) * args.roundtrip_wait + 60 * len(modes) + 15 + 30 + 45
    indexed = phase("index", lambda: index(app, args.stats, now() + max(30, budget.left() - reserve)))
    if indexed:
        result["index"] = {k: v for k, v in indexed.items() if k not in ("started", "ended")}
        result["resources"]["indexing"] = stats.summarise(stats.load(args.stats), indexed["started"],
                                                          indexed["ended"])
    idle_start = now()
    time.sleep(min(args.idle_seconds, max(0, budget.left() - reserve + args.idle_seconds)))
    result["resources"]["idle_after_index"] = stats.summarise(stats.load(args.stats), idle_start, now())

    counts = phase("counts", app.counts) or {}
    found = counts.get("total") or 0
    expected = lock["counts"]["media_files"]
    result["counts"] = {"found": found, "expected_media_files": expected,
                        "expected_unique_bytes": lock["counts"]["media_unique_bytes"],
                        "found_ratio": round(found / expected, 3) if expected else None, "app": counts}
    if indexed and indexed.get("complete") and indexed.get("seconds"):
        result["index"]["files_per_minute"] = round(found / indexed["seconds"] * 60, 1)
    save()

    # 1. Interop: what curation from other tools is visible after indexing (nothing edited yet).
    if fixtures:
        result["interop"] = phase("interop", lambda: checks.interop(app, fixtures))
        save()

    # 2. Metadata round-trip: defaults first, then each write-back switch the app has.
    targets = lock["roundtrip_targets"]
    trips = []
    default = phase("roundtrip-default", lambda: roundtrip(app, targets[0], "default", args.roundtrip_wait))
    if default:
        default["label"] = "default"
        trips.append(default)
    if not modes:
        result["write_back_switch"] = "none: the app has no write-back setting (see tools.json)"
    for number, mode in enumerate(modes, start=1):
        if not phase(f"enable-{mode.label}", lambda: mode.enable() or True):
            continue
        target = targets[min(number, len(targets) - 1)]
        trip = phase(f"roundtrip-{mode.label}", lambda: roundtrip(app, target, mode.label, args.roundtrip_wait))
        if trip:
            trip["label"] = mode.label
            trip["setting"] = mode.setting
            if mode.write_faces:
                phase(f"write-faces-{mode.label}", mode.write_faces)
                trip["face_regions"] = phase(f"face-regions-{mode.label}",
                                             lambda: checks.face_regions_written(app, lock.get("people_targets", [])))
            trips.append(trip)
        save()
    refs = [t.pop("_ref") for t in trips if "_ref" in t]
    result["roundtrip"] = {t["label"]: t for t in trips}

    # 3. Export: do the edits travel with the files?
    if refs:
        result["export"] = phase("export", lambda: export_check(app, refs, trips))

    # 4. File safety: did indexing and editing move, rename, rewrite or create anything?
    edited = {t["target"] for t in trips if "target" in t}
    result["file_safety"] = phase("tree-diff", lambda: checks.tree_diff(tree_before, checks.tree(app.library),
                                                                        edited))
    # 5. Delete: trash, delete permanently, and what the configured trash expiry would do.
    delete_targets = lock.get("delete_targets") or []
    if delete_targets:
        result["delete"] = phase("delete", lambda: checks.delete_test(app, delete_targets[0]))

    result["setup"] = {"harness_steps": app.steps, "api_requests": app.api.requests, "notes": app.notes}
    result["total_seconds"] = round(now() - args.t0, 1)
    result["within_budget"] = result["total_seconds"] <= args.budget
    save()
    print(json.dumps({k: result.get(k) for k in ("tool", "mode", "startup_seconds", "counts", "total_seconds")},
                     default=str), file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
