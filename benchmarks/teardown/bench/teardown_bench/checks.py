"""Interop import scoring, file-safety (tree diff, delete) and face-region write-back checks."""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

from . import exif
from .adapters import Adapter, PhotoRef


def _blob(*values: Any) -> str:
    """Everything an API said, as one lower-case string to search values in."""
    return json.dumps(values, default=str, ensure_ascii=False).lower()


def score_fixture(app: Adapter, fixture: dict[str, Any], lists_blob: str) -> dict[str, Any]:
    """What of one fixture's curation the app shows after indexing, field by field.

    Values are searched in the photo's API detail (and, for keywords and names, the
    app-wide tag/people lists), so a field counts however the app names it.
    ``None`` means the fixture has nothing to score for that field.
    """
    ref = app.find(fixture["path"])
    if ref is None:
        return {"path": fixture["path"], "convention": fixture["convention"], "found": False}
    detail = app.detail(ref)
    blob = _blob(detail)
    faces = app.faces(ref, detail)
    names = [p["name"] for p in fixture["people"]]
    flat = fixture["keywords_flat"]
    hier = fixture["keywords_hierarchical"]

    def share(hits: list[bool]) -> float | None:
        return round(sum(hits) / len(hits), 2) if hits else None

    face_names = " ".join(f["name"].lower() for f in faces)
    hier_forms = []
    for item in hier:
        full = item["path"].lower()
        if full in blob or full.replace("|", "/") in blob:
            hier_forms.append("path")
        elif item["leaf"].lower() in blob or item["leaf"].lower() in lists_blob:
            hier_forms.append("leaf")
        else:
            hier_forms.append("none")
    rating = app.rating(detail)
    return {
        "path": fixture["path"],
        "convention": fixture["convention"],
        "found": True,
        "people_names": share([n.lower() in face_names or n.lower() in blob for n in names]),
        "face_boxes": share([any(f["box"] and f["name"].lower() == n.lower() for f in faces) for n in names])
        if names else None,
        "faces_seen": len(faces),
        "keywords_flat": share([k.lower() in blob or k.lower() in lists_blob for k in flat]),
        "keywords_hierarchical": share([form != "none" for form in hier_forms]),
        "hierarchy_kept": share([form == "path" for form in hier_forms]),
        "rating": None if fixture["rating"] is None else (1.0 if rating == fixture["rating"] else 0.0),
        "rating_seen": rating,
        "caption": None if not fixture["caption"] else (1.0 if fixture["caption"].lower() in blob else 0.0),
    }


def interop(app: Adapter, fixtures: list[dict[str, Any]]) -> dict[str, Any]:
    lists_blob = _blob(app.lists())
    rows = [score_fixture(app, f, lists_blob) for f in fixtures]
    fields = ["people_names", "face_boxes", "keywords_flat", "keywords_hierarchical", "hierarchy_kept",
              "rating", "caption"]
    by_convention: dict[str, dict[str, float | None]] = {}
    for convention in sorted({r["convention"] for r in rows}):
        group = [r for r in rows if r["convention"] == convention]
        summary: dict[str, float | None] = {"found": round(sum(r["found"] for r in group) / len(group), 2)}
        for field in fields:
            values = [r[field] for r in group if r.get("found") and r.get(field) is not None]
            summary[field] = round(sum(values) / len(values), 2) if values else None
        by_convention[convention] = summary
    # The both-sidecars fixture is reported, not scored: which file did the app believe?
    both = next((r for r in rows if r["convention"] == "both-sidecars" and r.get("found")), None)
    return {"by_convention": by_convention, "both_sidecars_rating": both and both.get("rating_seen"),
            "fixtures": rows}


def tree(library: Path) -> dict[str, str]:
    """``{relative path: sha256}`` of every file in the library."""
    return {p.relative_to(library).as_posix(): exif.sha256_of(p) or ""
            for p in sorted(library.rglob("*")) if p.is_file()}


def tree_diff(before: dict[str, str], after: dict[str, str], edited: set[str]) -> dict[str, Any]:
    """Moved, renamed, deleted, rewritten and new files between two snapshots.

    ``edited`` are the paths the benchmark itself asked the app to change; rewrites
    and new sidecars there are expected and listed apart.
    """
    gone = {p: h for p, h in before.items() if p not in after}
    new = {p: h for p, h in after.items() if p not in before}
    by_hash_new: dict[str, list[str]] = {}
    for path, digest in new.items():
        by_hash_new.setdefault(digest, []).append(path)
    moved = []
    for path, digest in gone.items():
        targets = by_hash_new.get(digest)
        if targets:
            moved.append({"from": path, "to": targets.pop(0)})
    moved_to = {m["to"] for m in moved}
    moved_from = {m["from"] for m in moved}
    rewritten = sorted(p for p in before if p in after and before[p] != after[p])

    def is_edited(path: str) -> bool:
        return any(path == e or path.startswith(e.rsplit(".", 1)[0]) for e in edited)

    return {
        "moved_or_renamed": moved,
        "deleted": sorted(p for p in gone if p not in moved_from),
        "rewritten_unexpected": [p for p in rewritten if not is_edited(p)],
        "rewritten_by_edits": [p for p in rewritten if is_edited(p)],
        "created_unexpected": sorted(p for p in new if p not in moved_to and not is_edited(p)),
        "created_by_edits": sorted(p for p in new if p not in moved_to and is_edited(p)),
    }


def delete_test(app: Adapter, relative: str, wait: float = 40) -> dict[str, Any]:
    """Trash a photo, delete it permanently, and see what happens to the file and its sidecars."""
    ref = app.find(relative)
    if ref is None:
        return {"target": relative, "error": "photo not found through the API"}
    sidecars = [p for p in exif.sidecar_candidates(ref.host_path) if p.exists()]

    def state() -> dict[str, Any]:
        return {"original_exists": ref.host_path.exists(),
                "sidecars_exist": [p.name for p in sidecars if p.exists()]}

    result: dict[str, Any] = {"target": relative, "sidecars_before": [p.name for p in sidecars]}
    try:
        app.trash(ref)
        time.sleep(5)
        result["after_trash"] = state()
    except Exception as error:  # noqa: BLE001 - the answer is part of the result
        result["after_trash"] = {"error": str(error)[:300], **state()}
    try:
        app.purge(ref)
    except Exception as error:  # noqa: BLE001
        result["purge_error"] = str(error)[:300]
    deadline = time.monotonic() + wait
    after = state()
    while time.monotonic() < deadline and after["original_exists"]:
        time.sleep(3)
        after = state()
    result["after_permanent_delete"] = after
    result["original_removed_from_disk"] = not after["original_exists"]
    result["sidecars_removed_from_disk"] = [p.name for p in sidecars if not p.exists()]
    try:
        result["trash_policy"] = app.trash_policy()
    except Exception as error:  # noqa: BLE001
        result["trash_policy"] = {"error": str(error)[:300]}
    return result


def face_regions_written(app: Adapter, relatives: list[str]) -> dict[str, Any]:
    """After a "write face tags" action: how many photos with known faces got MWG regions on disk."""
    checked = []
    for relative in relatives:
        ref: PhotoRef | None = app.find(relative)
        if ref is None:
            continue
        faces = app.faces(ref, app.detail(ref))
        if not faces:
            continue
        files = [ref.host_path] + exif.sidecar_candidates(ref.host_path)
        tags = exif.read_tags(files)
        regions = 0
        for row in tags.values():
            info = row.get("XMP-mwg-rs:RegionInfo")
            if isinstance(info, dict):
                regions = max(regions, len(info.get("RegionList") or []))
        checked.append({"target": relative, "faces_in_app": len(faces), "regions_on_disk": regions})
    return {"photos_with_faces": len(checked),
            "photos_with_regions_on_disk": sum(c["regions_on_disk"] > 0 for c in checked), "photos": checked}
