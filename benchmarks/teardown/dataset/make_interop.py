#!/usr/bin/env python3
"""Generate the interop fixtures: files as other photo tools leave them.

    python3 make_interop.py --dataset data [--per-convention 3]

Someone switching photo managers brings years of curation with them. This writes
``<dataset>/library/interop/`` with copies of clean CC0 files that carry that
curation in the layout each tool really uses, so the benchmark can see what
every app imports after indexing:

==================  ==============================================================
convention          what is written (ExifTool, JSON import)
==================  ==============================================================
digikam             in the JPEG: MWG face regions with names (``XMP-mwg-rs:RegionInfo``),
                    ``XMP-digiKam:TagsList`` hierarchy ``a/b/leaf``, ``dc:subject``,
                    ``xmp:Rating``, ``dc:description``
lightroom-raw       a RAW (one of the CC0 raw.pixls.us files) plus ``<stem>.xmp`` with
                    ``lr:hierarchicalSubject`` ``a|b|leaf``, ``dc:subject``, rating, description
lightroom-jpeg      the same fields embedded in a JPEG
darktable           ``<file>.<ext>.xmp`` sidecar (darktable's naming)
adobe-sidecar       ``<stem>.xmp`` sidecar (Adobe's naming) for a JPEG
both-sidecars       one JPEG with both names, different ratings (1 vs 5): which one wins?
windows-photo       ``XMP-MP:RegionInfoMP`` people rectangles (Windows Photo Gallery /
                    Microsoft Photos), ``MicrosoftPhoto:LastKeywordXMP``, ``RatingPercent``
                    plus ``xmp:Rating``, ``dc:description``
==================  ==============================================================

Each value carries the fixture's own number, so the benchmark can tell a
flat keyword (``dc:subject``) from the leaf of a hierarchy (only in
``TagsList``/``hierarchicalSubject``), and one file's people from another's.
Real digiKam and Lightroom also copy hierarchy leaves into ``dc:subject``;
here they are kept apart on purpose so each import path is scored on its own.
Face boxes are centred guesses, not detected faces: the benchmark scores
whether the box and name are imported, not whether they sit on a face.

The expectations go to ``<dataset>/meta/interop.json``.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

NAMES = ["Ada Teardown", "Grace Teardown", "Hedy Teardown", "Katherine Teardown", "Radia Teardown",
         "Frances Teardown", "Barbara Teardown", "Margaret Teardown"]
# Fields cleared from every copied original before a fixture writes its own values.
CLEARED = ["-XMP-xmp:Rating=", "-EXIF:Rating=", "-EXIF:RatingPercent=", "-XMP-microsoft:RatingPercent=",
           "-XMP-dc:Description=", "-EXIF:ImageDescription=", "-IPTC:Caption-Abstract=", "-XMP-dc:Subject=",
           "-IPTC:Keywords=", "-XMP-lr:HierarchicalSubject=", "-XMP-digiKam:TagsList=",
           "-XMP-mwg-rs:RegionInfo=", "-XMP-MP:RegionInfoMP="]
# MWG areas are centre-based, MP rectangles top-left based; both normalised.
BOX = {"x": 0.35, "y": 0.2, "w": 0.3, "h": 0.4}


def exiftool(*args: str) -> str:
    """ExifTool with a UTF-8 argfile (see make_messy.py)."""
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".args", delete=False) as argfile:
        argfile.write("".join(f"{arg}\n" for arg in args))
    try:
        result = subprocess.run(["exiftool", "-charset", "filename=utf8", "-@", argfile.name],
                                capture_output=True, text=True, encoding="utf-8", errors="replace",
                                timeout=120, check=False)
    finally:
        os.remove(argfile.name)
    if result.returncode != 0:
        raise RuntimeError(f"exiftool {' '.join(args)}: {result.stderr.strip()[:300]}")
    return result.stdout


def write_json(target: Path, tags: dict) -> None:
    """Write (or create, for a new .xmp) ``target`` from a tag dict, structures included."""
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".json", delete=False) as handle:
        json.dump([{"SourceFile": "*", **tags}], handle)
    try:
        args = ["-q", "-overwrite_original", f"-j={handle.name}", str(target)]
        if not target.exists():
            args.remove("-overwrite_original")
        exiftool(*args)
    finally:
        os.remove(handle.name)


def dimensions(path: Path) -> tuple[int, int]:
    row = json.loads(exiftool("-j", "-n", "-ImageWidth", "-ImageHeight", str(path)))[0]
    return int(row.get("ImageWidth") or 0), int(row.get("ImageHeight") or 0)


def mwg_regions(name: str, width: int, height: int) -> dict:
    return {"AppliedToDimensions": {"W": width, "H": height, "Unit": "pixel"},
            "RegionList": [{"Type": "Face", "Name": name,
                            "Area": {"X": BOX["x"] + BOX["w"] / 2, "Y": BOX["y"] + BOX["h"] / 2,
                                     "W": BOX["w"], "H": BOX["h"], "Unit": "normalized"}}]}


def mp_regions(name: str) -> dict:
    return {"Regions": [{"PersonDisplayName": name,
                         "Rectangle": f"{BOX['x']}, {BOX['y']}, {BOX['w']}, {BOX['h']}"}]}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--dataset", required=True)
    parser.add_argument("--per-convention", type=int, default=3)
    args = parser.parse_args()
    if not shutil.which("exiftool"):
        print("exiftool is required", file=sys.stderr)
        return 2

    root = Path(args.dataset) / "library"
    meta = Path(args.dataset) / "meta"
    out = root / "interop"
    if out.exists():
        shutil.rmtree(out)
    people = sorted((root / "clean" / "jpeg-people").glob("*.jpg"))
    jpegs = sorted((root / "clean" / "jpeg-unsplash").glob("*.jpg"))[-40:]  # away from the round-trip targets
    raws = [p for p in sorted((root / "clean" / "raw").glob("*")) if p.suffix.lower() != ".dng"]
    if not people or not jpegs:
        print("no clean JPEGs: run fetch_dataset.py first", file=sys.stderr)
        return 2

    fixtures: list[dict] = []
    n = args.per_convention
    name_index = 0

    def next_name() -> str:
        nonlocal name_index
        name_index += 1
        return NAMES[(name_index - 1) % len(NAMES)] + (f" {name_index}" if name_index > len(NAMES) else "")

    def record(path: Path, convention: str, number: int, *, sidecars: list[Path] = (), people_names=(),
               flat=(), hierarchical=(), rating=None, caption=None, note=None) -> None:
        fixtures.append({
            "path": path.relative_to(root).as_posix(),
            "convention": convention,
            "sidecars": [s.relative_to(root).as_posix() for s in sidecars],
            "people": [{"name": name, "box": BOX} for name in people_names],
            "keywords_flat": list(flat),
            "keywords_hierarchical": [{"path": h, "leaf": h.replace("|", "/").split("/")[-1]} for h in hierarchical],
            "rating": rating,
            "caption": caption,
            "number": number,
            **({"note": note} if note else {}),
        })

    def copy(source: Path, folder: str, number: int, suffix: str | None = None) -> Path:
        """Copy a clean file and clear the curation fields it already carries.

        Many Unsplash and RAW originals embed a Rating of 0 or camera keywords; left in,
        they would compete with the fixture's values (sidecar vs embedded) and blur the score.
        """
        target = out / folder / f"{folder}-{number:02d}-{source.stem[:32]}{suffix or source.suffix}"
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        exiftool("-q", "-overwrite_original", *CLEARED, str(target))
        return target

    for i in range(n):
        number = i + 1
        # digiKam: everything inside the JPEG.
        source = people[i % len(people)]
        target = copy(source, "digikam", number)
        width, height = dimensions(target)
        name = next_name()
        tags = {"XMP-mwg-rs:RegionInfo": mwg_regions(name, width, height),
                "XMP-digiKam:TagsList": [f"InteropDK/People/interop-dk-leaf-{number}"],
                "XMP-dc:Subject": [f"interop-dk-flat-{number}"], "XMP-xmp:Rating": 3,
                "XMP-dc:Description": f"interop digikam caption {number}"}
        write_json(target, tags)
        record(target, "digikam", number, people_names=[name], flat=[f"interop-dk-flat-{number}"],
               hierarchical=[f"InteropDK/People/interop-dk-leaf-{number}"], rating=3,
               caption=f"interop digikam caption {number}")

        # Lightroom Classic: RAW + <stem>.xmp, and a JPEG with the XMP embedded.
        lr_tags = lambda kind: {  # noqa: E731 - small local template
            "XMP-lr:HierarchicalSubject": [f"InteropLR|Trips|interop-lr-{kind}-leaf-{number}"],
            "XMP-dc:Subject": [f"interop-lr-{kind}-flat-{number}"], "XMP-xmp:Rating": 4,
            "XMP-dc:Description": f"interop lightroom {kind} caption {number}"}
        if raws:
            source = raws[i % len(raws)]
            target = copy(source, "lightroom-raw", number)
            # Unique bytes without embedding XMP (Lightroom leaves proprietary RAWs untouched).
            write_json(target, {"IFD0:Software": f"interop-unique-lightroom-raw-{number}"})
            sidecar = target.with_suffix(".xmp")
            write_json(sidecar, lr_tags("raw"))
            record(target, "lightroom-raw", number, sidecars=[sidecar], flat=[f"interop-lr-raw-flat-{number}"],
                   hierarchical=[f"InteropLR|Trips|interop-lr-raw-leaf-{number}"], rating=4,
                   caption=f"interop lightroom raw caption {number}")
        target = copy(jpegs[i % len(jpegs)], "lightroom-jpeg", number)
        write_json(target, lr_tags("jpeg"))
        record(target, "lightroom-jpeg", number, flat=[f"interop-lr-jpeg-flat-{number}"],
               hierarchical=[f"InteropLR|Trips|interop-lr-jpeg-leaf-{number}"], rating=4,
               caption=f"interop lightroom jpeg caption {number}")

        # darktable (<file>.<ext>.xmp) and Adobe (<stem>.xmp) sidecars next to JPEGs.
        for convention, offset in (("darktable", 10), ("adobe-sidecar", 20)):
            source = jpegs[(offset + i) % len(jpegs)]
            target = copy(source, convention, number)
            write_json(target, {"XMP-xmp:Label": f"interop-unique-{convention}-{number}"})  # unique bytes
            sidecar = (target.with_name(target.name + ".xmp") if convention == "darktable"
                       else target.with_suffix(".xmp"))
            short = "dt" if convention == "darktable" else "ad"
            write_json(sidecar, {"XMP-dc:Subject": [f"interop-{short}-flat-{number}"],
                                 "XMP-lr:HierarchicalSubject": [f"Interop{short.upper()}|interop-{short}-leaf-{number}"],
                                 "XMP-xmp:Rating": 2, "XMP-dc:Description": f"interop {convention} caption {number}"})
            record(target, convention, number, sidecars=[sidecar], flat=[f"interop-{short}-flat-{number}"],
                   hierarchical=[f"Interop{short.upper()}|interop-{short}-leaf-{number}"], rating=2,
                   caption=f"interop {convention} caption {number}")

        # Windows Photo Gallery / Microsoft Photos people tags.
        source = people[(i + n) % len(people)]
        target = copy(source, "windows-photo", number)
        name = next_name()
        write_json(target, {"XMP-MP:RegionInfoMP": mp_regions(name),
                            "XMP-microsoft:LastKeywordXMP": [f"interop-ms-kw-{number}"],
                            "XMP-microsoft:RatingPercent": 75, "XMP-xmp:Rating": 4,
                            "XMP-dc:Description": f"interop windows caption {number}"})
        record(target, "windows-photo", number, people_names=[name], flat=[f"interop-ms-kw-{number}"],
               rating=4, caption=f"interop windows caption {number}",
               note="keyword only in MicrosoftPhoto:LastKeywordXMP, not dc:subject")

    # One JPEG with both sidecar names and different ratings.
    target = copy(jpegs[30 % len(jpegs)], "both-sidecars", 1)
    write_json(target, {"XMP-xmp:Label": "interop-unique-both"})
    adobe, darktable = target.with_suffix(".xmp"), target.with_name(target.name + ".xmp")
    write_json(adobe, {"XMP-xmp:Rating": 1, "XMP-dc:Description": "interop both: adobe wins"})
    write_json(darktable, {"XMP-xmp:Rating": 5, "XMP-dc:Description": "interop both: darktable wins"})
    record(target, "both-sidecars", 1, sidecars=[adobe, darktable], rating=None, caption=None,
           note="rating 1 + 'adobe wins' in IMG.xmp, rating 5 + 'darktable wins' in IMG.jpg.xmp; reported, not scored")

    meta.mkdir(parents=True, exist_ok=True)
    (meta / "interop.json").write_text(json.dumps({"box": BOX, "fixtures": fixtures}, indent=1) + "\n",
                                       encoding="utf-8")
    sidecars = sum(len(f["sidecars"]) for f in fixtures)
    print(f"interop: {len(fixtures)} fixtures, {sidecars} sidecars", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
