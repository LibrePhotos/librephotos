#!/usr/bin/env python3
"""Hash the prepared library and write what a correct indexer should find.

    python3 lock_dataset.py --dataset data [--manifest manifest.json]

Reads ``<dataset>/library`` (clean + derived + messy + interop) and the notes the other
scripts left in ``<dataset>/meta``, and writes ``<dataset>/meta/dataset.lock.json``:
the sha256 of every file, its category, and the expected counts the benchmark
compares each app against. Unlisted files fail the run, so nothing sneaks in.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
VIDEO_EXT = {".mp4", ".mov", ".webm", ".mkv", ".m4v", ".avi"}
RAW_EXT = {".cr2", ".cr3", ".nef", ".arw", ".raf", ".orf", ".rw2", ".dng"}
# Files the benchmark edits through each app's API (rating, description, keyword).
ROUNDTRIP_STRATUM = "jpeg-unsplash"


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        while chunk := handle.read(1 << 20):
            digest.update(chunk)
    return digest.hexdigest()


def kind_of(path: str) -> str:
    suffix = Path(path).suffix.lower()
    if suffix in VIDEO_EXT:
        return "video"
    if suffix in RAW_EXT:
        return "raw"
    return "image"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--dataset", required=True)
    parser.add_argument("--manifest", default=str(HERE / "manifest.json"))
    parser.add_argument("--profile", choices=["small", "full"], default="small")
    args = parser.parse_args()

    root = Path(args.dataset)
    library, meta = root / "library", root / "meta"
    manifest = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    expected: dict[str, dict] = {}

    for entry in manifest["files"]:
        if args.profile in entry.get("profiles", ["full"]):
            expected[entry["path"]] = {"category": f"clean-{entry['stratum']}", "expect": "media",
                                       "kind": entry["kind"], "license": entry["license"]}
    derived_path = meta / "derived.json"
    if derived_path.exists():
        derived = json.loads(derived_path.read_text(encoding="utf-8"))
        for item in derived["heic"]:
            expected[item["path"]] = {"category": "derived-heic", "expect": "media", "kind": "image"}
        for item in derived["mp4"]:
            expected[item["path"]] = {"category": "derived-mp4", "expect": "media", "kind": "video"}
    messy_path = meta / "messy.json"
    if messy_path.exists():
        for item in json.loads(messy_path.read_text(encoding="utf-8"))["files"]:
            expected[item["path"]] = {"category": item["category"], "expect": item["expect"],
                                      "kind": kind_of(item["path"])}

    interop_path = meta / "interop.json"
    if interop_path.exists():
        for item in json.loads(interop_path.read_text(encoding="utf-8"))["fixtures"]:
            expected[item["path"]] = {"category": f"interop-{item['convention']}", "expect": "media",
                                      "kind": kind_of(item["path"])}
            for sidecar in item["sidecars"]:
                expected[sidecar] = {"category": f"interop-{item['convention']}", "expect": "sidecar",
                                     "kind": "sidecar"}

    files: list[dict] = []
    unlisted: list[str] = []
    for path in sorted(p for p in library.rglob("*") if p.is_file()):
        relative = path.relative_to(library).as_posix()
        info = expected.pop(relative, None)
        if info is None:
            unlisted.append(relative)
            continue
        files.append({"path": relative, "sha256": sha256_of(path), "bytes": path.stat().st_size, **info})
    missing = sorted(expected)

    media = [f for f in files if f["expect"] == "media"]
    counts = {
        "files_on_disk": len(files),
        "media_files": len(media),
        "media_unique_bytes": len({f["sha256"] for f in media}),
        "images": sum(f["kind"] == "image" for f in media),
        "raw": sum(f["kind"] == "raw" for f in media),
        "videos": sum(f["kind"] == "video" for f in media),
        "corrupt": sum(f["expect"] == "corrupt" for f in files),
        "not_media": sum(f["expect"] == "not-media" for f in files),
        "sidecars": sum(f["expect"] == "sidecar" for f in files),
        "ambiguous": sum(f["expect"] == "ambiguous" for f in files),
        "bytes": sum(f["bytes"] for f in files),
    }
    by_category: dict[str, int] = {}
    for f in files:
        by_category[f["category"]] = by_category.get(f["category"], 0) + 1
    # Four photos the benchmark edits: default, opt-in sidecar, opt-in media file, spare.
    roundtrip = [f["path"] for f in files
                 if f["category"] == f"clean-{ROUNDTRIP_STRATUM}" and f["path"].endswith(".jpg")][:4]
    # Photos with people, for the face-region write-back check.
    people = [f["path"] for f in files if f["category"] == "clean-jpeg-people"][:6]
    # The delete test removes a JPEG that has an Adobe-style sidecar, so sidecar cleanup shows too.
    delete = [f["path"] for f in files if f["category"] == "interop-adobe-sidecar" and f["expect"] == "media"][:1]

    lock = {"profile": args.profile, "manifest_generated": manifest.get("generated"), "counts": counts,
            "by_category": by_category, "roundtrip_targets": roundtrip, "people_targets": people,
            "delete_targets": delete, "missing": missing,
            "unlisted": unlisted, "files": files}
    meta.mkdir(parents=True, exist_ok=True)
    (meta / "dataset.lock.json").write_text(json.dumps(lock, indent=1, ensure_ascii=False) + "\n",
                                            encoding="utf-8")
    print(json.dumps(counts), file=sys.stderr)
    for item in missing:
        print(f"MISSING {item}", file=sys.stderr)
    for item in unlisted:
        print(f"UNLISTED {item}", file=sys.stderr)
    return 1 if missing or unlisted or len(roundtrip) < 3 else 0


if __name__ == "__main__":
    sys.exit(main())
