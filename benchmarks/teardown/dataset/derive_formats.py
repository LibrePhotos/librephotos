#!/usr/bin/env python3
"""Derive the formats Commons cannot host from the downloaded CC0 files.

    python3 derive_formats.py --dataset data [--heic 60] [--mp4 4]

* HEIC: re-encodes the first N photos of the people and Unsplash strata with
  ``heif-enc`` (libheif; on Ubuntu ``libheif-examples`` + ``libheif-plugin-x265``),
  falling back to ImageMagick when its build can write HEIC. EXIF is copied
  over with ExifTool, so the HEICs carry camera, date and GPS like a phone's.
* MP4: short synthetic H.264 clips from ffmpeg's ``testsrc2`` with a
  ``creation_time``, no third-party footage at all.

Derived files are CC0 like their sources (the synthetic clips have no source).
They land in ``<dataset>/library/derived/``. Their hashes depend on the
encoder version, so they are not in manifest.json;
lock_dataset.py records them for each run. A missing encoder skips that format
with a warning instead of failing: the run's lock file then shows it.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

HEIC_SOURCES = ("jpeg-people", "jpeg-unsplash")
MP4_DATES = ["2019-07-14T10:30:00Z", "2020-12-24T18:00:00Z", "2022-03-05T08:15:00Z", "2023-08-19T21:45:00Z"]


def run(args: list[str], timeout: int = 120) -> subprocess.CompletedProcess:
    return subprocess.run(args, capture_output=True, text=True, timeout=timeout, check=False)


def heic_encoder() -> list[str] | None:
    if shutil.which("heif-enc"):
        return ["heif-enc", "--quality", "80", "-o"]
    magick = shutil.which("magick") or shutil.which("convert")
    if magick:
        formats = run([magick, "-list", "format"]).stdout
        for line in formats.splitlines():
            parts = line.split()
            if parts and parts[0].rstrip("*") == "HEIC" and len(parts) > 2 and "w" in parts[2]:
                return [magick, "-quality", "80"]
    return None


def encode_heic(encoder: list[str], source: Path, target: Path) -> bool:
    if encoder[0].endswith("heif-enc"):
        result = run(encoder + [str(target), str(source)])
    else:
        result = run(encoder + [str(source), str(target)])
    if result.returncode != 0 or not target.exists():
        print(f"  heic failed for {source.name}: {result.stderr.strip()[:200]}", file=sys.stderr)
        return False
    # Copy EXIF (camera, dates, GPS) the way a phone would have stored it.
    run(["exiftool", "-q", "-overwrite_original", "-tagsFromFile", str(source),
         "-EXIF:all", "-XMP:all", "-Orientation=1", "-n", str(target)])
    return True


def make_mp4(ffmpeg: str, target: Path, created: str, seconds: int = 4) -> bool:
    result = run([
        ffmpeg, "-y", "-loglevel", "error", "-f", "lavfi",
        "-i", f"testsrc2=size=1280x720:rate=30:duration={seconds}",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
        "-metadata", f"creation_time={created}", str(target),
    ])
    if result.returncode != 0 or not target.exists():
        print(f"  mp4 failed: {result.stderr.strip()[:200]}", file=sys.stderr)
        return False
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--dataset", required=True, help="the --dest of fetch_dataset.py")
    parser.add_argument("--heic", type=int, default=60, help="how many HEICs to derive")
    parser.add_argument("--mp4", type=int, default=4, help="how many synthetic MP4s")
    args = parser.parse_args()

    root = Path(args.dataset) / "library"
    meta = Path(args.dataset) / "meta"
    out = root / "derived"
    report: dict = {"heic": [], "mp4": [], "skipped": []}

    sources = [p for stratum in HEIC_SOURCES for p in sorted((root / "clean" / stratum).glob("*.jpg"))]
    encoder = heic_encoder()
    if args.heic and not encoder:
        report["skipped"].append("heic: no encoder (install libheif-examples + libheif-plugin-x265)")
    elif args.heic:
        (out / "heic").mkdir(parents=True, exist_ok=True)
        for source in sources[: args.heic]:
            target = out / "heic" / (source.stem + ".heic")
            if target.exists() or encode_heic(encoder, source, target):
                report["heic"].append({"path": target.relative_to(root).as_posix(),
                                       "from": source.relative_to(root).as_posix()})

    ffmpeg = shutil.which("ffmpeg")
    if args.mp4 and not ffmpeg:
        report["skipped"].append("mp4: ffmpeg not found")
    elif args.mp4:
        (out / "mp4").mkdir(parents=True, exist_ok=True)
        for number, created in enumerate((MP4_DATES * 8)[: args.mp4], start=1):
            target = out / "mp4" / f"{number:04d}-synthetic-testsrc2.mp4"
            if target.exists() or make_mp4(ffmpeg, target, created):
                report["mp4"].append({"path": target.relative_to(root).as_posix(), "created": created})

    meta.mkdir(parents=True, exist_ok=True)
    (meta / "derived.json").write_text(json.dumps(report, indent=1) + "\n", encoding="utf-8")
    print(f"derived: {len(report['heic'])} heic, {len(report['mp4'])} mp4; skipped: {report['skipped']}",
          file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
