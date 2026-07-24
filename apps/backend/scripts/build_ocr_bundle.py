#!/usr/bin/env python3
"""Build PP-OCRv6 ONNX model bundles for LibrePhotos' offline model installer.

This script is checked in for reproducibility and is run **by hand** by a
maintainer to (re)generate the ``ppocrv6_<tier>.tar.gz`` bundles that
``api/ml_models.py`` downloads. It is NOT imported by the running server and it
does NOT add any runtime dependency to the backend: it only needs the standard
library (``urllib``, ``tarfile``, ``hashlib``, ``json``) plus PyYAML, which is
already present in the backend environment as a transitive dependency and is
never imported by the running server.

For each tier in {tiny, small, medium} it:

  1. Downloads ``inference.onnx`` + ``inference.yml`` from the HuggingFace repos
     ``PaddlePaddle/PP-OCRv6_<tier>_det_onnx`` and
     ``PaddlePaddle/PP-OCRv6_<tier>_rec_onnx``.
  2. Parses the det yml (DBPostProcess params + NormalizeImage preprocess) and
     the rec yml (input shape + inline character_dict + use_space_char).
  3. Writes ``charset.txt`` (one char per line, order preserved), a compact
     ``config.json``, and a ``PROVENANCE.md`` (source URLs, commit SHAs,
     sha256 of every file, license).
  4. Packs ``det.onnx``, ``rec.onnx``, ``charset.txt``, ``config.json`` and
     ``PROVENANCE.md`` into ``ppocrv6_<tier>.tar.gz``.

The bundle layout tolerates an optional future ``cls.onnx``; nothing here
assumes exactly five members.

Usage::

    python build_ocr_bundle.py --tier small --output-dir /path/to/out

Idempotent: downloaded upstream files are cached under
``<output-dir>/_work/<tier>/`` and reused. sha256 of every upstream file is
verified against the pins in ``PINNED_SHA256`` when present, so a silently
changed upstream artifact fails loudly instead of producing a different bundle.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import sys
import tarfile
import urllib.request
from pathlib import Path

TIERS = ("tiny", "small", "medium")

HF_BASE = "https://huggingface.co"
LICENSE = "Apache-2.0"

# Default det geometry knobs (not present in the upstream yml, chosen by us).
DEFAULT_MAX_SIDE = 1600
DEFAULT_SIZE_MULTIPLE = 32

# Files fetched from each det/rec repo: (remote name, local name).
UPSTREAM_FILES = ("inference.onnx", "inference.yml")

# sha256 pins for upstream artifacts. Filled in after the first verified run so
# a later silent upstream change fails loudly. Shape:
#   {"<tier>": {"det": {"inference.onnx": "<sha>", ...}, "rec": {...}}}
PINNED_SHA256: dict[str, dict[str, dict[str, str]]] = {
    # Recorded from a verified run (see each bundle's PROVENANCE.md). A tier
    # with no entry here is unpinned and simply records whatever it fetches;
    # a mismatch against a present pin aborts the build loudly.
    "small": {
        "det": {
            "inference.onnx": "d73e0058b7a8086bbd57f3d10b8bcd4ff95363f67e06e2762b5e814fe9c9410e",
            "inference.yml": "193f435274bf9f0b5f71a929bbfbcf148282df7e633b34e7c373e8f44741b516",
        },
        "rec": {
            "inference.onnx": "5435fd747c9e0efe15a96d0b378d5bd157e9492ed8fd80edf08f30d02fa24634",
            "inference.yml": "ab078671bb49f06228eadccd34f1bb501e157f7a047095ffb943ba81512c77d1",
        },
    },
}


def _repo_id(tier: str, role: str) -> str:
    """HuggingFace repo id for a tier ('tiny'/'small'/'medium') and role."""
    return f"PaddlePaddle/PP-OCRv6_{tier}_{role}_onnx"


def _resolve_url(repo_id: str, filename: str) -> str:
    return f"{HF_BASE}/{repo_id}/resolve/main/{filename}"


def _api_url(repo_id: str) -> str:
    return f"{HF_BASE}/api/models/{repo_id}"


# --------------------------------------------------------------------------- #
# Pure parsing helpers (no network; unit-tested)
# --------------------------------------------------------------------------- #
def parse_scale(value) -> float:
    """Turn a NormalizeImage ``scale`` into a float.

    PaddleOCR writes it as the string ``"1./255."`` (a Python-2-ish literal),
    but it may already be a number. Both are accepted.
    """
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    if "/" in text:
        num, denom = text.split("/", 1)
        return float(num.strip().rstrip(".") or "0") / float(
            denom.strip().rstrip(".") or "1"
        )
    return float(text.rstrip("."))


def _iter_transform_ops(preprocess: dict):
    """Yield (op_name, op_params) for each entry in ``PreProcess.transform_ops``.

    Each entry is a single-key mapping like ``{"NormalizeImage": {...}}`` or
    ``{"DetLabelEncode": None}``.
    """
    ops = (preprocess or {}).get("transform_ops") or []
    for op in ops:
        if not isinstance(op, dict):
            continue
        for name, params in op.items():
            yield name, (params or {})


def parse_det_config(det_yml: dict) -> dict:
    """Extract det preprocess + DBPostProcess params from a parsed det yml."""
    preprocess = det_yml.get("PreProcess", {})

    img_mode = "BGR"
    mean = [0.485, 0.456, 0.406]
    std = [0.229, 0.224, 0.225]
    scale = 1.0 / 255.0
    order = "hwc"
    for name, params in _iter_transform_ops(preprocess):
        if name == "DecodeImage" and params.get("img_mode"):
            img_mode = params["img_mode"]
        if name == "NormalizeImage":
            mean = [float(x) for x in params.get("mean", mean)]
            std = [float(x) for x in params.get("std", std)]
            scale = parse_scale(params.get("scale", scale))
            order = params.get("order", order)

    post = det_yml.get("PostProcess", {})
    return {
        "preprocess": {
            "mean": mean,
            "std": std,
            "scale": scale,
            "order": order,
            "img_mode": img_mode,
            "bgr": str(img_mode).upper() == "BGR",
            "max_side": DEFAULT_MAX_SIDE,
            "size_multiple": DEFAULT_SIZE_MULTIPLE,
        },
        "postprocess": {
            "thresh": float(post.get("thresh", 0.3)),
            "box_thresh": float(post.get("box_thresh", 0.6)),
            "unclip_ratio": float(post.get("unclip_ratio", 1.5)),
            "max_candidates": int(post.get("max_candidates", 1000)),
        },
    }


def parse_rec_config(rec_yml: dict) -> dict:
    """Extract rec input shape, use_space_char and the inline charset.

    Returns ``{"input_shape": [c, h, w], "use_space_char": bool,
    "charset": [str, ...]}``.
    """
    preprocess = rec_yml.get("PreProcess", {})
    input_shape = None
    for name, params in _iter_transform_ops(preprocess):
        # RecResizeImg (and a few older variants) carry image_shape.
        if "image_shape" in params:
            input_shape = [int(x) for x in params["image_shape"]]
            break
        if "rec_image_shape" in params:
            input_shape = [int(x) for x in params["rec_image_shape"]]
            break
    if input_shape is None:
        input_shape = [3, 48, 320]

    post = rec_yml.get("PostProcess", {})
    charset = post.get("character_dict")
    if charset is None:
        raise ValueError(
            "rec inference.yml has no inline PostProcess.character_dict; "
            "a character_dict_path reference is not supported by this builder."
        )
    charset = [str(c) for c in charset]
    use_space_char = bool(post.get("use_space_char", False))

    return {
        "input_shape": input_shape,
        "use_space_char": use_space_char,
        "charset": charset,
    }


def build_config(det_cfg: dict, rec_cfg: dict) -> dict:
    """Assemble the compact config.json payload from parsed det/rec configs."""
    return {
        "format": "ppocrv6-bundle/1",
        "det": {
            "preprocess": det_cfg["preprocess"],
            "postprocess": det_cfg["postprocess"],
        },
        "rec": {
            "input_shape": rec_cfg["input_shape"],
        },
        "use_space_char": rec_cfg["use_space_char"],
    }


def charset_text(charset: list[str], use_space_char: bool) -> str:
    """Render charset.txt: one char per line, order preserved.

    ``use_space_char`` controls whether a literal space is appended as the last
    entry, mirroring PaddleOCR's CTCLabelDecode, which appends ' ' to the dict
    when the flag is set and the space is not already present.
    """
    lines = list(charset)
    if use_space_char and " " not in lines:
        lines.append(" ")
    # One char per line; a charset entry that is itself a space is written as a
    # blank line, which round-trips correctly when read back line by line.
    return "\n".join(lines) + "\n"


# --------------------------------------------------------------------------- #
# YAML loader
# --------------------------------------------------------------------------- #
def load_yaml(text: str) -> dict:
    """Parse an inference.yml with PyYAML.

    PyYAML is required by this hand-run build tool (it is already present in the
    backend environment as a transitive dependency of ``transformers``, and the
    real PaddleOCR ymls use anchors/aliases and nested block sequences that a
    hand-rolled parser would mis-read). It is NOT a server runtime dependency —
    the running LibrePhotos backend never imports this script.
    """
    try:
        import yaml  # type: ignore
    except ImportError as exc:  # pragma: no cover - environment dependent
        raise SystemExit(
            "PyYAML is required to build OCR bundles. Install it with "
            "`pip install pyyaml` and re-run."
        ) from exc
    return yaml.safe_load(text)


# --------------------------------------------------------------------------- #
# Network + filesystem
# --------------------------------------------------------------------------- #
def _http_get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "librephotos-ocr-build"})
    with urllib.request.urlopen(req) as resp:  # noqa: S310 (trusted HF host)
        return resp.read()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _pinned_sha(tier: str, role: str, filename: str):
    """Return a pinned sha256 for (tier, role, filename), or None if unpinned.

    Pins that are not 64 hex chars (e.g. the seeded placeholder) are ignored so
    an un-updated placeholder cannot masquerade as a real hash.
    """
    sha = PINNED_SHA256.get(tier, {}).get(role, {}).get(filename)
    if not sha or len(sha) != 64:
        return None
    try:
        int(sha, 16)
    except ValueError:
        return None
    return sha


def fetch_upstream(tier: str, role: str, work_dir: Path) -> dict:
    """Download (or reuse cached) inference.onnx + inference.yml for one repo.

    Returns ``{"repo_id", "commit_sha", "files": {name: {"path", "sha256",
    "url"}}}`` and asserts against ``PINNED_SHA256`` when a pin exists.
    """
    repo_id = _repo_id(tier, role)
    role_dir = work_dir / role
    role_dir.mkdir(parents=True, exist_ok=True)

    try:
        meta = json.loads(_http_get(_api_url(repo_id)).decode("utf-8"))
        commit_sha = meta.get("sha", "unknown")
    except Exception as exc:  # pragma: no cover - network dependent
        print(f"  ! could not fetch API metadata for {repo_id}: {exc}")
        commit_sha = "unknown"

    files = {}
    for filename in UPSTREAM_FILES:
        url = _resolve_url(repo_id, filename)
        dest = role_dir / filename
        if dest.exists():
            sha = sha256_file(dest)
            print(f"  = cached {role}/{filename} ({sha[:12]}...)")
        else:
            print(f"  > downloading {url}")
            data = _http_get(url)
            dest.write_bytes(data)
            sha = sha256_bytes(data)
            print(f"    saved {role}/{filename} ({sha[:12]}...)")

        pinned = _pinned_sha(tier, role, filename)
        if pinned and pinned != sha:
            raise SystemExit(
                f"sha256 mismatch for {repo_id}/{filename}\n"
                f"  expected (pinned): {pinned}\n"
                f"  actual  (fetched): {sha}\n"
                "Upstream changed. Review, then update PINNED_SHA256."
            )
        files[filename] = {"path": dest, "sha256": sha, "url": url}

    return {"repo_id": repo_id, "commit_sha": commit_sha, "files": files}


def render_provenance(tier: str, det: dict, rec: dict, bundle_files: dict) -> str:
    lines = [
        f"# PP-OCRv6 {tier} bundle — provenance",
        "",
        f"License: {LICENSE} (PaddleOCR / PaddlePaddle)",
        "",
        "## Source repositories",
        "",
        f"- Detection: `{det['repo_id']}` @ commit `{det['commit_sha']}`",
        f"  - {_resolve_url(det['repo_id'], 'inference.onnx')}",
        f"  - {_resolve_url(det['repo_id'], 'inference.yml')}",
        f"- Recognition: `{rec['repo_id']}` @ commit `{rec['commit_sha']}`",
        f"  - {_resolve_url(rec['repo_id'], 'inference.onnx')}",
        f"  - {_resolve_url(rec['repo_id'], 'inference.yml')}",
        "",
        "## Upstream file sha256",
        "",
    ]
    for role, info in (("det", det), ("rec", rec)):
        for filename, meta in info["files"].items():
            lines.append(f"- {role}/{filename}: `{meta['sha256']}`")
    lines += ["", "## Bundle member sha256", ""]
    for name, sha in bundle_files.items():
        lines.append(f"- {name}: `{sha}`")
    lines.append("")
    return "\n".join(lines)


def build_tier(tier: str, output_dir: Path) -> dict:
    print(f"== building ppocrv6_{tier} ==")
    work_dir = output_dir / "_work" / tier
    stage_dir = output_dir / f"ppocrv6_{tier}"
    stage_dir.mkdir(parents=True, exist_ok=True)

    det = fetch_upstream(tier, "det", work_dir)
    rec = fetch_upstream(tier, "rec", work_dir)

    det_yml = load_yaml(det["files"]["inference.yml"]["path"].read_text("utf-8"))
    rec_yml = load_yaml(rec["files"]["inference.yml"]["path"].read_text("utf-8"))

    det_cfg = parse_det_config(det_yml)
    rec_cfg = parse_rec_config(rec_yml)
    config = build_config(det_cfg, rec_cfg)

    # Stage the bundle members.
    det_onnx = stage_dir / "det.onnx"
    rec_onnx = stage_dir / "rec.onnx"
    det_onnx.write_bytes(det["files"]["inference.onnx"]["path"].read_bytes())
    rec_onnx.write_bytes(rec["files"]["inference.onnx"]["path"].read_bytes())

    # newline="\n" on every text write: without it, Windows text mode rewrites
    # "\n" to "\r\n", which would (a) break the byte-identical/content-addressable
    # guarantee across OSes and (b) leave a trailing "\r" on every charset token
    # for any reader that splits on "\n". Bundles must be LF-only everywhere.
    charset_path = stage_dir / "charset.txt"
    charset_path.write_text(
        charset_text(rec_cfg["charset"], rec_cfg["use_space_char"]),
        encoding="utf-8",
        newline="\n",
    )

    config_path = stage_dir / "config.json"
    config_path.write_text(
        json.dumps(config, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
        newline="\n",
    )

    # sha256 of every staged member (for PROVENANCE + the golden test).
    member_names = ["det.onnx", "rec.onnx", "charset.txt", "config.json"]
    bundle_files = {name: sha256_file(stage_dir / name) for name in member_names}

    provenance = render_provenance(tier, det, rec, bundle_files)
    (stage_dir / "PROVENANCE.md").write_text(provenance, encoding="utf-8", newline="\n")

    # Pack: iterate the staged directory so an optional future cls.onnx (or any
    # extra member) is included automatically — nothing assumes exactly 5 files.
    #
    # The archive members are prefixed with "ocr/ppocrv6_<tier>/" to match the
    # model's `target-dir` in api/ml_models.py. download_model() unpacks tar
    # bundles with extractall(path=data_models) (the PARENT), so the tar itself
    # must carry the full sub-path or the files land in the wrong place and
    # _model_target_exists() would never see them.
    #
    # Packing is made deterministic (fixed member mtime/uid/gid and gzip mtime=0)
    # so an unchanged input reproduces a byte-identical, content-addressable
    # tar.gz — the bundle sha256 is then a stable fingerprint, not a per-run
    # timestamp artifact.
    def _reset(tarinfo):
        tarinfo.mtime = 0
        tarinfo.uid = tarinfo.gid = 0
        tarinfo.uname = tarinfo.gname = ""
        return tarinfo

    arc_prefix = f"ocr/ppocrv6_{tier}"
    tar_path = output_dir / f"ppocrv6_{tier}.tar.gz"
    with (
        open(tar_path, "wb") as raw,
        gzip.GzipFile(fileobj=raw, mode="wb", mtime=0) as gz,
        tarfile.open(fileobj=gz, mode="w") as tar,
    ):
        for member in sorted(stage_dir.iterdir()):
            tar.add(member, arcname=f"{arc_prefix}/{member.name}", filter=_reset)

    tar_sha = sha256_file(tar_path)
    print(
        f"  charset length: {len(rec_cfg['charset'])} (use_space_char="
        f"{rec_cfg['use_space_char']})"
    )
    print(f"  rec input_shape: {rec_cfg['input_shape']}")
    print(f"  det postprocess: {det_cfg['postprocess']}")
    print(f"  wrote {tar_path.name} ({tar_sha})")

    return {
        "tier": tier,
        "tar_path": tar_path,
        "tar_sha256": tar_sha,
        "stage_dir": stage_dir,
        "config": config,
        "charset_len": len(rec_cfg["charset"]),
        "use_space_char": rec_cfg["use_space_char"],
        "bundle_files": bundle_files,
        "det_upstream": {k: v["sha256"] for k, v in det["files"].items()},
        "rec_upstream": {k: v["sha256"] for k, v in rec["files"].items()},
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Build PP-OCRv6 ONNX bundles.")
    parser.add_argument(
        "--tier",
        choices=(*TIERS, "all"),
        required=True,
        help="Which tier to build ('all' builds tiny+small+medium).",
    )
    parser.add_argument(
        "--output-dir",
        required=True,
        type=Path,
        help="Directory to write bundles and staged folders into.",
    )
    args = parser.parse_args(argv)

    tiers = TIERS if args.tier == "all" else (args.tier,)
    args.output_dir.mkdir(parents=True, exist_ok=True)

    for tier in tiers:
        result = build_tier(tier, args.output_dir)
        print(
            json.dumps(
                {
                    "tier": result["tier"],
                    "tar_sha256": result["tar_sha256"],
                    "charset_len": result["charset_len"],
                    "use_space_char": result["use_space_char"],
                    "bundle_files": result["bundle_files"],
                },
                indent=2,
            )
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
