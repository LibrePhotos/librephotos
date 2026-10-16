#!/usr/bin/env python3
"""Generate the "messy" part of the library from the clean CC0 files.

    python3 make_messy.py --dataset data [--seed 42] [--scale 1.0]

Real libraries are not clean. This adds every
problem a photo manager meets in an old family archive, using ExifTool on
copies of clean files (the clean files are never touched), into
``<dataset>/library/messy/``:

=====================  ==========================================  ============
category               what                                        counts as
=====================  ==========================================  ============
dup-exact              byte-identical copies in other folders      media (dup)
dup-metadata-only      same pixels, one EXIF tag changed           media
exif-stripped          ``exiftool -all=``                          media
exif-zero-date         DateTimeOriginal ``0000:00:00 00:00:00``    media
exif-future-date       DateTimeOriginal in 2099                    media
exif-null-island       GPS 0,0                                     media
exif-conflict          EXIF date 2001 vs XMP date 2015             media
xmp-sidecar            ``IMG.xmp`` with rating/description/keyword  media + .xmp
xmp-sidecar-ext        ``IMG.jpg.xmp`` (darktable/Immich naming)   media + .xmp
wrong-extension        a JPEG named ``.png``                       media
upper-extension        ``.JPG`` / ``.JPEG``                        media
truncated              first 40 % of a JPEG                        corrupt
zero-byte              empty ``.jpg``                              corrupt
not-media              ``notes.txt``, ``Thumbs.db``                not media
hidden-folder          ``.hidden/``, ``@eaDir/``                   ambiguous
=====================  ==========================================  ============

Folders get the names that break naive code: Unicode, emoji, ``#`` and ``&``,
brackets, double spaces, deep nesting and a 180-character name. Everything
is listed in ``<dataset>/meta/messy.json`` with what a correct indexer should do;
lock_dataset.py turns that into the expected counts.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

FOLDERS = [
    "Ünïcödé ✓ Фото 写真",
    "2019 - Summer  Trip (copy)",
    "#hash & ampersand's %20 folder",
    "[brackets] {braces} (parens)",
    "deep/a/b/c/d/e/f/g/h",
    ("very long " + "name " * 34).strip(),  # ~180 characters
    "emoji 📷🌄",
]
COUNTS = {
    "dup-exact": 30,
    "dup-metadata-only": 20,
    "exif-stripped": 30,
    "exif-zero-date": 10,
    "exif-future-date": 10,
    "exif-null-island": 10,
    "exif-conflict": 10,
    "xmp-sidecar": 25,
    "xmp-sidecar-ext": 15,
    "wrong-extension": 5,
    "upper-extension": 10,
    "truncated": 5,
    "zero-byte": 2,
}


def exiftool(*args: str) -> None:
    """Run ExifTool with the arguments in a UTF-8 argfile.

    Folder names here are Unicode on purpose; on Windows a command line reaches
    ExifTool in the ANSI code page and such paths are not found. An argfile
    plus ``-charset filename=utf8`` works the same on every platform.
    """
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".args", delete=False) as argfile:
        argfile.write("".join(f"{arg}\n" for arg in args))
    try:
        result = subprocess.run(["exiftool", "-q", "-q", "-charset", "filename=utf8", "-@", argfile.name],
                                capture_output=True, text=True, encoding="utf-8", errors="replace",
                                timeout=120, check=False)
    finally:
        os.remove(argfile.name)
    if result.returncode != 0:
        raise RuntimeError(f"exiftool {' '.join(args)}: {result.stderr.strip()[:300]}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--dataset", required=True)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--scale", type=float, default=1.0, help="multiply every count (small runs)")
    args = parser.parse_args()

    if not shutil.which("exiftool"):
        print("exiftool is required (apt install libimage-exiftool-perl)", file=sys.stderr)
        return 2

    root = Path(args.dataset) / "library"
    meta = Path(args.dataset) / "meta"
    messy = root / "messy"
    if messy.exists():
        shutil.rmtree(messy)
    rng = random.Random(args.seed)
    jpegs = sorted((root / "clean").glob("jpeg-*/*.jpg"))
    if not jpegs:
        print("no clean JPEGs: run fetch_dataset.py first", file=sys.stderr)
        return 2

    entries: list[dict] = []

    def target_for(category: str, source: Path, number: int, suffix: str | None = None) -> Path:
        folder = FOLDERS[number % len(FOLDERS)]
        name = f"{category}-{number:03d}-{source.stem[:40]}{suffix or source.suffix}"
        path = messy / folder / name
        path.parent.mkdir(parents=True, exist_ok=True)
        return path

    def add(path: Path, category: str, expect: str, source: Path | None = None, **extra: object) -> None:
        entries.append({
            "path": path.relative_to(root).as_posix(),
            "category": category,
            "expect": expect,  # media | corrupt | not-media | ambiguous | sidecar
            "from": source.relative_to(root).as_posix() if source else None,
            **extra,
        })

    for category, count in COUNTS.items():
        count = max(1, round(count * args.scale))
        for number, source in enumerate(rng.sample(jpegs, min(count, len(jpegs))), start=1):
            if category == "dup-exact":
                target = target_for(category, source, number)
                shutil.copyfile(source, target)
                add(target, category, "media", source, duplicate_of=source.relative_to(root).as_posix())
            elif category == "dup-metadata-only":
                target = target_for(category, source, number)
                shutil.copyfile(source, target)
                exiftool("-overwrite_original", "-Software=teardown-messy", str(target))
                add(target, category, "media", source, near_duplicate_of=source.relative_to(root).as_posix())
            elif category == "exif-stripped":
                target = target_for(category, source, number)
                shutil.copyfile(source, target)
                exiftool("-overwrite_original", "-all=", str(target))
                add(target, category, "media", source)
            elif category == "exif-zero-date":
                target = target_for(category, source, number)
                shutil.copyfile(source, target)
                # "#" skips ExifTool's date check, which refuses month 00.
                exiftool("-overwrite_original", "-DateTimeOriginal#=0000:00:00 00:00:00",
                         "-CreateDate#=0000:00:00 00:00:00", str(target))
                add(target, category, "media", source)
            elif category == "exif-future-date":
                target = target_for(category, source, number)
                shutil.copyfile(source, target)
                exiftool("-overwrite_original", "-AllDates=2099:12:31 23:59:59", str(target))
                add(target, category, "media", source)
            elif category == "exif-null-island":
                target = target_for(category, source, number)
                shutil.copyfile(source, target)
                exiftool("-overwrite_original", "-GPSLatitude=0", "-GPSLatitudeRef=N",
                         "-GPSLongitude=0", "-GPSLongitudeRef=E", str(target))
                add(target, category, "media", source)
            elif category == "exif-conflict":
                target = target_for(category, source, number)
                shutil.copyfile(source, target)
                exiftool("-overwrite_original", "-EXIF:DateTimeOriginal=2001:02:03 04:05:06",
                         "-XMP-exif:DateTimeOriginal=2015:06:07 08:09:10",
                         "-XMP-photoshop:DateCreated=2015:06:07 08:09:10", str(target))
                add(target, category, "media", source, exif_date="2001-02-03T04:05:06",
                    xmp_date="2015-06-07T08:09:10")
            elif category in ("xmp-sidecar", "xmp-sidecar-ext"):
                target = target_for(category, source, number)
                shutil.copyfile(source, target)
                sidecar = (target.with_suffix(".xmp") if category == "xmp-sidecar"
                           else target.with_name(target.name + ".xmp"))
                description = f"teardown sidecar {category} {number:03d}"
                keyword = f"teardown-sidecar-kw-{number:03d}"
                exiftool("-overwrite_original", f"-Software=teardown-messy-{category}", str(target))
                # Two steps: "-o" copies the photo's own XMP (Unsplash files carry Rating 0),
                # which would win over values given in the same call.
                exiftool("-o", str(sidecar), str(target))
                exiftool("-overwrite_original", "-XMP-xmp:Rating=5", f"-XMP-dc:Description={description}",
                         f"-XMP-dc:Subject={keyword}", str(sidecar))
                add(target, category, "media", source, sidecar=sidecar.relative_to(root).as_posix(),
                    sidecar_rating=5, sidecar_description=description, sidecar_keyword=keyword)
                add(sidecar, category, "sidecar", source)
            elif category in ("wrong-extension", "upper-extension"):
                suffix = ".png" if category == "wrong-extension" else rng.choice([".JPG", ".JPEG"])
                target = target_for(category, source, number, suffix=suffix)
                # Unique bytes, so these test the extension and never duplicate detection. ExifTool
                # refuses a JPEG named .png, so the tag is written before the rename.
                staging = target.with_name(target.stem + ".staging.jpg")
                shutil.copyfile(source, staging)
                exiftool("-overwrite_original", f"-Software=teardown-messy-{category}", str(staging))
                os.replace(staging, target)
                add(target, category, "media", source)
            elif category == "truncated":
                target = target_for(category, source, number)
                data = source.read_bytes()
                target.write_bytes(data[: int(len(data) * 0.4)])
                add(target, category, "corrupt", source)
            elif category == "zero-byte":
                target = target_for(category, source, number)
                target.write_bytes(b"")
                add(target, category, "corrupt", source)

    notes = messy / FOLDERS[0] / "notes.txt"
    notes.write_text("Not a photo. A correct indexer skips this.\n", encoding="utf-8")
    add(notes, "not-media", "not-media")
    thumbs = messy / FOLDERS[1] / "Thumbs.db"
    thumbs.write_bytes(b"\xd0\xcf\x11\xe0" + bytes(508))
    add(thumbs, "not-media", "not-media")
    for hidden in (".hidden", "@eaDir"):
        source = rng.choice(jpegs)
        target = messy / hidden / f"hidden-{source.name}"
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        exiftool("-overwrite_original", "-Software=teardown-messy-hidden", str(target))
        add(target, "hidden-folder", "ambiguous", source)

    summary = {}
    for entry in entries:
        summary[entry["category"]] = summary.get(entry["category"], 0) + 1
    meta.mkdir(parents=True, exist_ok=True)
    (meta / "messy.json").write_text(
        json.dumps({"seed": args.seed, "scale": args.scale, "folders": FOLDERS, "summary": summary,
                    "files": entries}, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"messy: {len(entries)} files in {len(FOLDERS) + 2} folders: {summary}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
