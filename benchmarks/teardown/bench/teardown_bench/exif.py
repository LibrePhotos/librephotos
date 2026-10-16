"""Where did an edit end up? Reads files with ExifTool and searches values, not tag names.

Searching for the values the benchmark set (a rating of 4, a description and a
keyword carrying a random nonce) instead of fixed tag names means a tool gets
credit for writing ``XMP-dc:Description``, ``EXIF:ImageDescription`` or
``IPTC:Caption-Abstract`` alike, and a misspelt tag name cannot pass.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any


def sidecar_candidates(path: Path) -> list[Path]:
    """The XMP sidecar names in use: ``IMG.xmp`` (Adobe, LibrePhotos) and ``IMG.jpg.xmp`` (darktable, Immich)."""
    names = [path.with_suffix(".xmp"), path.with_suffix(".XMP"),
             path.with_name(path.name + ".xmp"), path.with_name(path.name + ".XMP")]
    unique: list[Path] = []
    for name in names:
        if name not in unique:
            unique.append(name)
    return unique


def sha256_of(path: Path) -> str | None:
    if not path.is_file():
        return None
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        while chunk := handle.read(1 << 20):
            digest.update(chunk)
    return digest.hexdigest()


def read_tags(paths: list[Path]) -> dict[str, dict[str, Any]]:
    """``{path: {"Group:Tag": value}}`` for every existing path, numeric values (``-n``)."""
    existing = [p for p in paths if p.is_file()]
    if not existing or not shutil.which("exiftool"):
        return {}
    # Paths go through a UTF-8 argfile so non-ASCII names work on every platform.
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".args", delete=False) as argfile:
        argfile.write("".join(f"{path}\n" for path in existing))
    try:
        result = subprocess.run(["exiftool", "-j", "-G1", "-a", "-n", "-struct", "-charset", "filename=utf8",
                                 "-@", argfile.name], capture_output=True, text=True, encoding="utf-8",
                                errors="replace", timeout=120, check=False)
    finally:
        os.remove(argfile.name)
    try:
        rows = json.loads(result.stdout or "[]")
    except ValueError:
        return {}
    by_path: dict[str, dict[str, Any]] = {}
    for row in rows:
        source = row.get("SourceFile", "")
        by_path[source] = row
        by_path[str(Path(source))] = row  # ExifTool answers with forward slashes on Windows too
    return by_path


def _strings(value: Any) -> list[str]:
    if isinstance(value, list):
        return [s for item in value for s in _strings(item)]
    if isinstance(value, dict):
        return [s for item in value.values() for s in _strings(item)]
    return [str(value)]


def locate(tags: dict[str, Any], rating: int, description: str, keyword: str) -> dict[str, list[str]]:
    """Which tags of one file carry each value."""
    found: dict[str, list[str]] = {"rating": [], "description": [], "keyword": []}
    for key, value in tags.items():
        if key in ("SourceFile",) or key.startswith(("System:", "File:", "ExifTool:")):
            continue
        name = key.split(":")[-1].lower()
        if name == "rating" and str(value) == str(rating):
            found["rating"].append(key)
        texts = _strings(value)
        if any(description in text for text in texts):
            found["description"].append(key)
        if any(keyword == text or keyword in text.split(",") for text in texts):
            found["keyword"].append(key)
    return found


def text_locate(path: Path, rating: int, description: str, keyword: str) -> dict[str, list[str]]:
    """The same search in an app's own text sidecar (PhotoPrism YAML, JSON)."""
    found: dict[str, list[str]] = {"rating": [], "description": [], "keyword": []}
    if not path.is_file():
        return found
    text = path.read_text(encoding="utf-8", errors="replace")
    if description in text:
        found["description"].append(path.name)
    if keyword in text:
        found["keyword"].append(path.name)
    for line in text.splitlines():
        if "rating" in line.lower() and line.strip().endswith(str(rating)):
            found["rating"].append(path.name)
    return found


def snapshot(original: Path, extra: list[Path]) -> dict[str, Any]:
    """Hashes before an edit, to tell "original rewritten" from "sidecar created"."""
    return {
        "original_sha256": sha256_of(original),
        "sidecars": {str(p): sha256_of(p) for p in sidecar_candidates(original) + extra},
    }


def where_written(original: Path, before: dict[str, Any], rating: int, description: str, keyword: str,
                  extra: list[Path]) -> dict[str, Any]:
    """Per field, the files and tags that now hold the value, and what changed on disk."""
    sidecars = sidecar_candidates(original)
    exif_files = [original] + sidecars
    tags = read_tags(exif_files)
    fields: dict[str, list[str]] = {"rating": [], "description": [], "keyword": []}
    for path in exif_files:
        row = tags.get(str(path)) or tags.get(path.as_posix()) or {}
        kind = "original" if path == original else f"xmp-sidecar:{path.name}"
        for field, keys in locate(row, rating, description, keyword).items():
            fields[field] += [f"{kind}:{key}" for key in keys]
    for path in extra:
        for field, keys in text_locate(path, rating, description, keyword).items():
            fields[field] += [f"app-sidecar:{key}" for key in keys]
    after_original = sha256_of(original)
    created = [str(p) for p in sidecars + extra if before["sidecars"].get(str(p)) is None and p.is_file()]
    changed = [str(p) for p in sidecars + extra
               if before["sidecars"].get(str(p)) not in (None, sha256_of(p))]
    return {
        "fields": fields,
        "original_modified": after_original != before["original_sha256"],
        "sidecars_created": created,
        "sidecars_changed": changed,
    }


def classify(fields: dict[str, list[str]]) -> dict[str, str]:
    """``original`` / ``xmp-sidecar`` / ``app-sidecar`` / ``none`` per field (best place found)."""
    verdict = {}
    for field, places in fields.items():
        if any(p.startswith("original:") for p in places):
            verdict[field] = "original"
        elif any(p.startswith("xmp-sidecar:") for p in places):
            verdict[field] = "xmp-sidecar"
        elif any(p.startswith("app-sidecar:") for p in places):
            verdict[field] = "app-sidecar"
        else:
            verdict[field] = "none"
    return verdict
