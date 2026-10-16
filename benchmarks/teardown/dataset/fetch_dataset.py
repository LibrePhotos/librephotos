#!/usr/bin/env python3
"""Download the files listed in manifest.json and verify every byte.

    python3 fetch_dataset.py --dest data --profile small      # -> data/library/clean/...
    python3 fetch_dataset.py --dest data --profile full
    python3 fetch_dataset.py --dest data --mirror https://example.org/teardown-v1   # same bytes, other host
    python3 fetch_dataset.py --dest data --fill-sha256   # maintainer: lock new manifest

Files land in ``<dest>/library/`` (the folder every app indexes) and the
report in ``<dest>/meta/``. A file already there with the right hash is not downloaded again, so the
same directory can serve as a CI cache. Each file is checked against its sha256
(or, before the manifest is locked, the sha1 Wikimedia Commons publishes); any
mismatch fails the run. Standard library only.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import tempfile
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

HERE = Path(__file__).resolve().parent
USER_AGENT = (
    "librephotos-teardown-benchmark/1.0 "
    "(https://github.com/LibrePhotos/librephotos; benchmarks/teardown)"
)
CHUNK = 1 << 20


class HashMismatch(Exception):
    pass


def hashes_of(path: Path) -> tuple[str, str, int]:
    sha256, sha1, size = hashlib.sha256(), hashlib.sha1(), 0
    with open(path, "rb") as handle:
        while chunk := handle.read(CHUNK):
            sha256.update(chunk)
            sha1.update(chunk)
            size += len(chunk)
    return sha256.hexdigest(), sha1.hexdigest(), size


def matches(entry: dict, sha256: str, sha1: str) -> bool:
    if entry.get("sha256"):
        return sha256 == entry["sha256"]
    if entry.get("sha1"):
        return sha1 == entry["sha1"]
    return False  # nothing to check against: never trust it


def download(entry: dict, dest: Path, mirror: str = "", delay: float = 0.0, retries: int = 6) -> dict:
    target = dest / "library" / entry["path"]
    if target.exists():
        sha256, sha1, size = hashes_of(target)
        if matches(entry, sha256, sha1):
            return {"id": entry["id"], "status": "cached", "sha256": sha256, "bytes": size}
    target.parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(retries):
        handle, partial = tempfile.mkstemp(dir=target.parent, suffix=".part")
        try:
            sha256, sha1, size = hashlib.sha256(), hashlib.sha1(), 0
            url = f"{mirror.rstrip('/')}/{urllib.parse.quote(entry['path'])}" if mirror else entry["url"]
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            time.sleep(delay)  # Wikimedia throttles bursts (HTTP 429)
            # Open the file first so the descriptor is closed on every path
            # (an HTTP error before fdopen leaked it, and Windows then refuses
            # to delete the .part file).
            with os.fdopen(handle, "wb") as out, urllib.request.urlopen(request, timeout=120) as response:
                while chunk := response.read(CHUNK):
                    out.write(chunk)
                    sha256.update(chunk)
                    sha1.update(chunk)
                    size += len(chunk)
            digest256, digest1 = sha256.hexdigest(), sha1.hexdigest()
            if not matches(entry, digest256, digest1):
                raise HashMismatch(f"{entry['id']}: got sha256 {digest256} sha1 {digest1}")
            os.replace(partial, target)
            return {"id": entry["id"], "status": "downloaded", "sha256": digest256, "bytes": size}
        except HashMismatch:
            Path(partial).unlink(missing_ok=True)
            raise
        except Exception as error:  # noqa: BLE001 - network: retry anything else
            Path(partial).unlink(missing_ok=True)
            if attempt == retries - 1:
                raise
            # Wikimedia answers 429 when downloads come too fast: honour Retry-After.
            retry_after = getattr(getattr(error, "headers", None), "get", lambda *_: None)("Retry-After")
            wait = int(retry_after) if (retry_after or "").isdigit() else 5 * 2 ** attempt
            print(f"  retry {entry['id']} in {wait}s: {error}", file=sys.stderr)
            time.sleep(wait)
    raise AssertionError("unreachable")


def select(manifest: dict, profile: str) -> list[dict]:
    return [f for f in manifest["files"] if profile in f.get("profiles", ["full"])]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--manifest", default=str(HERE / "manifest.json"))
    parser.add_argument("--dest", required=True, help="dataset root; files land in <dest>/library/clean/...")
    parser.add_argument("--profile", choices=["small", "full"], default="small")
    parser.add_argument("--jobs", type=int, default=1,
                        help="parallel downloads; Wikimedia answers 429 above about one at a time")
    parser.add_argument("--delay", type=float, default=0.5, help="seconds to wait before each download")
    parser.add_argument("--mirror", default="",
                        help="base URL of a mirror holding the same files at their manifest paths "
                             "(for example a release asset unpacked on a web server); hashes are still checked")
    parser.add_argument("--limit", type=int, default=0, help="only the first N files (testing)")
    parser.add_argument("--fill-sha256", action="store_true",
                        help="write the sha256 and exact size of each file back into the manifest")
    args = parser.parse_args()

    manifest_path = Path(args.manifest)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    entries = select(manifest, "full" if args.fill_sha256 else args.profile)
    if args.limit:
        entries = entries[: args.limit]
    dest = Path(args.dest)
    dest.mkdir(parents=True, exist_ok=True)

    results: list[dict] = []
    failures: list[str] = []
    started = time.monotonic()
    with ThreadPoolExecutor(max_workers=max(1, args.jobs)) as pool:
        futures = {pool.submit(download, e, dest, args.mirror, args.delay): e for e in entries}
        for done, future in enumerate(as_completed(futures), start=1):
            entry = futures[future]
            try:
                results.append(future.result())
            except Exception as error:  # noqa: BLE001 - report every failure at the end
                failures.append(f"{entry['id']}: {error}")
            if done % 50 == 0 or done == len(entries):
                print(f"{done}/{len(entries)} files", file=sys.stderr)

    by_id = {r["id"]: r for r in results}
    if args.fill_sha256:
        for entry in manifest["files"]:
            if entry["id"] in by_id:
                entry["sha256"] = by_id[entry["id"]]["sha256"]
                entry["bytes"] = by_id[entry["id"]]["bytes"]
        manifest_path.write_text(json.dumps(manifest, indent=1, ensure_ascii=False) + "\n",
                                 encoding="utf-8", newline="\n")

    report = {
        "profile": "full" if args.fill_sha256 else args.profile,
        "files": len(entries),
        "downloaded": sum(r["status"] == "downloaded" for r in results),
        "cached": sum(r["status"] == "cached" for r in results),
        "bytes": sum(r["bytes"] for r in results),
        "seconds": round(time.monotonic() - started, 1),
        "failures": failures,
    }
    (dest / "meta").mkdir(exist_ok=True)
    (dest / "meta" / "fetch-report.json").write_text(json.dumps(report, indent=1) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k != "failures"}), file=sys.stderr)
    for failure in failures:
        print(f"FAILED {failure}", file=sys.stderr)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
