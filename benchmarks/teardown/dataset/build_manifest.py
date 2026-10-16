#!/usr/bin/env python3
"""Build manifest.json: the frozen list of CC0 files the teardown benchmark uses.

Maintainer tool. Run it once, review the result, and commit manifest.json; every
benchmark run then downloads exactly those files (fetch_dataset.py) and checks
their sha256, so two runs a year apart index the same bytes.

Sources (all CC0 1.0, checked per file, anything else is skipped):

* Wikimedia Commons, through the public MediaWiki API (no key):
  - "Images from Unsplash": photos uploaded while Unsplash was CC0 (before
    June 2017); camera EXIF mostly intact. Commons keeps only the CC0 ones.
  - Own-work CC0 photos that carry GPS in EXIF, for the places/map features.
  - CC0 PNGs and short CC0 WebM videos.
* raw.pixls.us: camera RAW samples, CC0 unless listed otherwise; the site
  publishes a sha256 for every file.

Standard library only. Usage:

    python3 build_manifest.py --out manifest.json            # API calls only
    python3 fetch_dataset.py --manifest manifest.json --dest /tmp/ds --fill-sha256
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

USER_AGENT = (
    "librephotos-teardown-benchmark/1.0 "
    "(https://github.com/LibrePhotos/librephotos; benchmarks/teardown)"
)
COMMONS_API = "https://commons.wikimedia.org/w/api.php"
RAWPIXLS_REPO = "https://raw.pixls.us/json/getrepository.php?set=all"
CC0_URL = "https://creativecommons.org/publicdomain/zero/1.0/"

# One stratum per kind of file. ``small`` is how many of them the small
# profile (the CI default) keeps: every n-th file, so it stays a fixed subset.
STRATA = [
    {
        "name": "jpeg-unsplash",
        "count": 600,
        "small": 150,
        "kind": "image",
        "query": 'incategory:"Images from Unsplash" filemime:image/jpeg filesize:200,3500',
    },
    {
        "name": "jpeg-people",
        "count": 150,
        "small": 50,
        "kind": "image",
        "query": 'incategory:"Images from Unsplash" filemime:image/jpeg filesize:200,3500 portrait',
    },
    {
        "name": "jpeg-gps",
        "count": 200,
        "small": 50,
        "kind": "image",
        "require_gps": True,
        "query": "incategory:CC-Zero filemime:image/jpeg filesize:300,4000 filew:>1500",
    },
    {
        "name": "png",
        "count": 50,
        "small": 15,
        "kind": "image",
        "query": "incategory:CC-Zero filemime:image/png filesize:200,5000 filew:>1000",
    },
    {
        "name": "video-webm",
        "count": 6,
        "small": 3,
        "kind": "video",
        "query": "incategory:CC-Zero filemime:video/webm filesize:500,12000",
    },
]

# One RAW per vendor format, each under 30 MB.
RAW_EXTENSIONS = ["CR2", "CR3", "NEF", "ARW", "RAF", "ORF", "RW2", "DNG"]
RAW_SMALL = 4
RAW_MAX_MB = 30.0


def get_json(url: str, retries: int = 4) -> object:
    for attempt in range(retries):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(request, timeout=60) as response:
                return json.load(response)
        except Exception as error:  # noqa: BLE001 - network: retry anything
            if attempt == retries - 1:
                raise
            wait = 2 ** (attempt + 1)
            print(f"  retry in {wait}s after {error}", file=sys.stderr)
            time.sleep(wait)
    raise AssertionError("unreachable")


def strip_html(value: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", value or "")).strip()


def slug(title: str, limit: int = 48) -> str:
    stem = title.removeprefix("File:").rsplit(".", 1)[0]
    text = re.sub(r"[^A-Za-z0-9]+", "-", stem).strip("-").lower()
    return (text[:limit].rstrip("-")) or "file"


def commons_pages(query: str):
    """Yield imageinfo pages for a CirrusSearch query, 50 per request."""
    offset = 0
    while True:
        params = {
            "action": "query",
            "format": "json",
            "generator": "search",
            "gsrnamespace": 6,
            "gsrsearch": query,
            "gsrlimit": 50,
            "gsroffset": offset,
            "prop": "imageinfo",
            "iiprop": "url|sha1|size|mime|extmetadata",
            "iiextmetadatafilter": "LicenseShortName|LicenseUrl|Artist|Credit|GPSLatitude|DateTimeOriginal",
        }
        data = get_json(f"{COMMONS_API}?{urllib.parse.urlencode(params)}")
        pages = sorted(
            data.get("query", {}).get("pages", {}).values(), key=lambda p: p.get("index", 0)
        )
        yield from pages
        cont = data.get("continue", {}).get("gsroffset")
        if cont is None or cont >= 9950:
            return
        offset = cont
        time.sleep(0.5)  # be gentle with the API


def is_cc0(meta: dict) -> bool:
    short = meta.get("LicenseShortName", {}).get("value", "")
    return short.strip().upper().startswith("CC0")


def commons_stratum(stratum: dict, seen_sha1: set[str]) -> list[dict]:
    picked: list[dict] = []
    extension = {"image/jpeg": "jpg", "image/png": "png", "video/webm": "webm"}
    for page in commons_pages(stratum["query"]):
        if len(picked) >= stratum["count"]:
            break
        info = (page.get("imageinfo") or [{}])[0]
        meta = info.get("extmetadata", {})
        if not info.get("url") or not is_cc0(meta):
            continue
        if info.get("sha1") in seen_sha1:
            continue
        has_gps = bool(meta.get("GPSLatitude", {}).get("value"))
        if stratum.get("require_gps") and not has_gps:
            continue
        seen_sha1.add(info["sha1"])
        number = len(picked) + 1
        ext = extension.get(info.get("mime", ""), info["url"].rsplit(".", 1)[-1].lower())
        picked.append(
            {
                "id": f"{stratum['name']}/{number:04d}",
                "path": f"clean/{stratum['name']}/{number:04d}-{slug(page['title'])}.{ext}",
                "source": "wikimedia-commons",
                "url": info["url"],
                "page": info.get("descriptionurl", ""),
                "title": page["title"],
                "author": strip_html(meta.get("Artist", {}).get("value", ""))[:200],
                "credit": strip_html(meta.get("Credit", {}).get("value", ""))[:200],
                "license": "CC0-1.0",
                "license_url": meta.get("LicenseUrl", {}).get("value", CC0_URL),
                "bytes": info.get("size"),
                "sha1": info.get("sha1"),
                "sha256": None,
                "mime": info.get("mime"),
                "kind": stratum["kind"],
                "stratum": stratum["name"],
                "has_gps": has_gps,
            }
        )
    print(f"{stratum['name']}: {len(picked)}/{stratum['count']}", file=sys.stderr)
    return picked


def rawpixls_stratum() -> list[dict]:
    data = get_json(RAWPIXLS_REPO)
    by_ext: dict[str, dict] = {}
    for row in data["data"]:
        make, model, mode, _mp, _x, licence, _date, link = row[:8]
        if "publicdomain/zero" not in licence:
            continue
        match = re.search(r"href='([^']+)'>([^<]+)</a>.*?sha256 Checksum'>([0-9a-f]{64})</span>&nbsp;\(([\d.]+)MB\)", link)
        if not match:
            continue
        url, name, sha256, megabytes = match.groups()
        ext = name.rsplit(".", 1)[-1].upper()
        if ext not in RAW_EXTENSIONS or ext in by_ext or float(megabytes) > RAW_MAX_MB:
            continue
        by_ext[ext] = {
            "id": "",
            "path": f"clean/raw/0000-{slug(make + ' ' + model)}.{ext.lower()}",
            "source": "raw.pixls.us",
            "url": urllib.parse.quote(url, safe=":/"),
            "page": "https://raw.pixls.us/",
            "title": name,
            "author": "raw.pixls.us contributors",
            "credit": f"{make} {model} ({mode})".strip(),
            "license": "CC0-1.0",
            "license_url": CC0_URL,
            "bytes": int(float(megabytes) * 1024 * 1024),  # approximate, site gives MB
            "sha1": None,
            "sha256": sha256,
            "mime": "image/x-raw",
            "kind": "raw",
            "stratum": "raw",
            "has_gps": False,
        }
    picked = [by_ext[e] for e in RAW_EXTENSIONS if e in by_ext]
    for number, item in enumerate(picked, start=1):  # number in format order
        item["id"] = f"raw/{number:04d}"
        item["path"] = re.sub(r"/\d{4}-", f"/{number:04d}-", item["path"], count=1)
    print(f"raw: {len(picked)}/{len(RAW_EXTENSIONS)}", file=sys.stderr)
    return picked


def mark_small_profile(files: list[dict], small: dict[str, int]) -> None:
    """Tag a fixed, evenly spread subset of each stratum as the small profile."""
    by_stratum: dict[str, list[dict]] = {}
    for item in files:
        by_stratum.setdefault(item["stratum"], []).append(item)
    for name, items in by_stratum.items():
        keep = min(small.get(name, len(items)), len(items))
        step = len(items) / keep if keep else 0
        chosen = {int(i * step) for i in range(keep)}
        for index, item in enumerate(items):
            item["profiles"] = ["full", "small"] if index in chosen else ["full"]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--out", default="manifest.json")
    parser.add_argument("--scale", type=float, default=1.0, help="multiply stratum counts (testing)")
    args = parser.parse_args()

    seen: set[str] = set()
    files: list[dict] = []
    small = {"raw": RAW_SMALL}
    for stratum in STRATA:
        scaled = dict(stratum, count=max(1, round(stratum["count"] * args.scale)))
        small[stratum["name"]] = max(1, round(stratum["small"] * args.scale))
        files.extend(commons_stratum(scaled, seen))
    files.extend(rawpixls_stratum())
    mark_small_profile(files, small)

    manifest = {
        "schema": 1,
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "generator": "benchmarks/teardown/dataset/build_manifest.py",
        "license_note": "Every file is CC0 1.0 per its source page at generation time; see LICENSES.md.",
        "strata": {s["name"]: s["query"] for s in STRATA} | {"raw": RAWPIXLS_REPO},
        "files": files,
    }
    with open(args.out, "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=1, ensure_ascii=False)
        handle.write("\n")
    total = sum(f["bytes"] or 0 for f in files)
    small = [f for f in files if "small" in f["profiles"]]
    print(f"wrote {args.out}: {len(files)} files, {total / 1e9:.2f} GB; small profile {len(small)} files",
          file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
