"""Sizes for ML_FOOTPRINT.md: binary variants, runtime deps, models, Docker images.

  python footprint_sizes.py --out sizes.json [--builds builds.jsonl]

Nothing is downloaded or installed: Docker Hub / registry metadata, GitHub
release asset sizes, PyPI wheel contents read from the zip central directory
with HTTP range requests, and Debian's Packages index (installed size of the
apt closure on debian:trixie-slim, no recommends). Local: the release binary,
its PDB, the Windows DLLs the venv ships, the models on disk.
"""

import argparse
import json
import lzma
import os
import re
import struct
import zlib
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent
RS_DIR = HERE.parent
LIBREPHOTOS = RS_DIR.parents[2]
MODELS = Path(os.environ.get("LP_ML_ROOT", LIBREPHOTOS / "rust-pg" / "ml")) / "protected_media" / "data_models"
SP = Path(os.environ.get("LP_FOOT_VENV", LIBREPHOTOS / "wt-windev" / "apps" / "backend" / ".venv-win")) / "Lib" / "site-packages"
HUB_REPOS = ["librephotos", "librephotos-unified", "librephotos-base", "librephotos-frontend", "librephotos-proxy",
             "librephotos-gpu"]
WHEELS = [("onnxruntime", "1.27.0"), ("pyvips-binary", "8.18.6")]
GH_WHEELS = "https://github.com/LibrePhotos/librephotos/releases/download/windows-wheels-2026.09.16/"
WHEEL_URLS = {  # apps/backend/requirements.txt: not on PyPI
    "exiftool-bin": ["exiftool_bin-13.57-py3-none-any.whl"],
    "ffmpeg-bin": ["ffmpeg_bin-9.0.1-py3-none-manylinux_2_28_x86_64.whl",
                   "ffmpeg_bin-9.0.1-py3-none-manylinux_2_28_aarch64.whl"],
}
DEBIAN = "trixie"
APT_SETS = {
    "libvips": ["libvips42t64"],
    "exiftool+perl": ["libimage-exiftool-perl"],
    "ffmpeg": ["ffmpeg"],
    "ca-certificates": ["ca-certificates"],
    "vips+exiftool+ffmpeg+certs": ["libvips42t64", "libimage-exiftool-perl", "ffmpeg", "ca-certificates"],
    "vips+exiftool+certs": ["libvips42t64", "libimage-exiftool-perl", "ca-certificates"],
}
S = requests.Session()


def get(url, **kw):
    r = S.get(url, timeout=120, **kw)
    r.raise_for_status()
    return r


def mb(x):
    return round(x / 1e6, 1)


# ------------------------------------------------------------------ Docker

def hub():
    out = {}
    for repo in HUB_REPOS:
        try:
            d = get(f"https://hub.docker.com/v2/repositories/reallibrephotos/{repo}/tags?page_size=5"
                    "&ordering=last_updated").json()
        except requests.RequestException as e:
            out[repo] = {"error": str(e)}
            continue
        tags = {}
        for t in d["results"]:
            tags[t["name"]] = {"pushed": t.get("tag_last_pushed"),
                               **{i["architecture"]: mb(i["size"]) for i in t["images"]
                                  if i["architecture"] in ("amd64", "arm64")}}
        out[repo] = tags
    base = get("https://hub.docker.com/v2/repositories/library/debian/tags/trixie-slim").json()
    out["debian:trixie-slim"] = {i["architecture"]: mb(i["size"]) for i in base["images"]
                                 if i["architecture"] in ("amd64", "arm64")}
    out["gcr.io/distroless/cc-debian12"] = distroless("distroless/cc-debian12")
    return out


def distroless(name):
    acc = "application/vnd.oci.image.index.v1+json,application/vnd.oci.image.manifest.v1+json"
    idx = get(f"https://gcr.io/v2/{name}/manifests/latest", headers={"Accept": acc}).json()
    out = {}
    for m in idx.get("manifests", []):
        arch = m["platform"]["architecture"]
        if arch not in ("amd64", "arm64"):
            continue
        man = get(f"https://gcr.io/v2/{name}/manifests/{m['digest']}", headers={"Accept": acc}).json()
        out[arch] = mb(sum(layer["size"] for layer in man["layers"]))
    return out


# ------------------------------------------------------------------ GitHub releases

def github():
    out = {}
    rel = get("https://api.github.com/repos/microsoft/onnxruntime/releases/tags/v1.27.0").json()
    out["onnxruntime v1.27.0"] = {a["name"]: mb(a["size"]) for a in rel["assets"]
                                  if re.search(r"linux-(x64|aarch64)-1|win-x64-1", a["name"])}
    rel = get("https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/latest").json()
    out["BtbN/FFmpeg-Builds latest (n8.1)"] = {a["name"]: mb(a["size"]) for a in rel["assets"]
                                               if a["name"].startswith("ffmpeg-n8.1-latest-linux")}
    return out


# ------------------------------------------------------------------ PyPI wheels

def _zip_entries(url, size):
    t = get(url, headers={"Range": f"bytes={max(0, size - 65558)}-{size - 1}"}).content
    i = t.rfind(b"PK\x05\x06")
    _, _, _, _, n, cd_size, cd_off, _ = struct.unpack("<IHHHHIIH", t[i:i + 22])
    if cd_off == 0xFFFFFFFF or n == 0xFFFF:
        j = t.rfind(b"PK\x06\x06")
        n, cd_size, cd_off = struct.unpack("<QQQ", t[j + 32:j + 56])
    cd = get(url, headers={"Range": f"bytes={cd_off}-{cd_off + cd_size - 1}"}).content
    out, p = [], 0
    while p < len(cd) and cd[p:p + 4] == b"PK\x01\x02":
        csize, usize = struct.unpack("<II", cd[p + 20:p + 28])
        ln, le, lc = struct.unpack("<HHH", cd[p + 28:p + 34])
        name = cd[p + 46:p + 46 + ln].decode("utf8", "replace")
        extra = cd[p + 46 + ln:p + 46 + ln + le]
        if usize == 0xFFFFFFFF or csize == 0xFFFFFFFF:
            q = 0
            while q < len(extra):
                hid, hl = struct.unpack("<HH", extra[q:q + 4])
                if hid == 1:
                    vals = struct.unpack("<" + "Q" * (hl // 8), extra[q + 4:q + 4 + hl])
                    k = 0
                    if usize == 0xFFFFFFFF:
                        usize = vals[k]
                        k += 1
                    if csize == 0xFFFFFFFF:
                        csize = vals[k]
                q += 4 + hl
        out.append((name, usize, csize))
        p += 46 + ln + le + lc
    return out


def wheels():
    res = {}
    files = []
    for pkg, ver in WHEELS:
        meta = get(f"https://pypi.org/pypi/{pkg}/{ver}/json").json()
        files += [(pkg, f) for f in meta["urls"]]
    for pkg, names in WHEEL_URLS.items():
        for n in names:
            h = S.head(GH_WHEELS + n, allow_redirects=True, timeout=60)
            h.raise_for_status()
            files.append((pkg, {"filename": n, "url": h.url, "size": int(h.headers["Content-Length"])}))
    for pkg, f in files:
        fn = f["filename"]
        if not fn.endswith(".whl") or "musllinux" in fn:
            continue
        arch = ("x86_64" if "manylinux" in fn and "x86_64" in fn else
                "aarch64" if "manylinux" in fn and "aarch64" in fn else
                "any" if "none-any" in fn else None)
        if arch is None or ("cp3" in fn and "cp312" not in fn and "abi3" not in fn):
            continue
        ents = _zip_entries(f["url"], f["size"])
        libs = {n: mb(u) for n, u, _ in ents if re.search(r"\.so(\.|$)|\.exe$|/exiftool$", n) and u > 500_000}
        res.setdefault(pkg, {})[arch] = {
            "wheel": fn, "wheel_mb": mb(f["size"]), "unpacked_mb": mb(sum(u for _, u, _ in ents)),
            "files": len(ents), "big_files_mb": dict(sorted(libs.items(), key=lambda kv: -kv[1])[:10]),
        }
    return res


# ------------------------------------------------------------------ Debian

def _packages(arch):
    url = f"https://deb.debian.org/debian/dists/{DEBIAN}/main/binary-{arch}/Packages.xz"
    raw = lzma.decompress(get(url).content).decode("utf8", "replace")
    pk, prov = {}, {}
    for block in raw.split("\n\n"):
        f = {}
        for line in block.split("\n"):
            if line and not line.startswith(" ") and ":" in line:
                k, _, v = line.partition(":")
                f[k] = v.strip()
        if "Package" not in f:
            continue
        pk[f["Package"]] = f
        for p in f.get("Provides", "").split(","):
            p = p.strip().split(" ")[0]
            if p:
                prov.setdefault(p, f["Package"])
    return pk, prov


def _deps(f):
    out = []
    for field in ("Pre-Depends", "Depends"):
        for alt in f.get(field, "").split(","):
            if alt.strip():
                out.append([re.sub(r"[ (:].*", "", a.strip()) for a in alt.split("|")])
    return out


def _closure(pk, prov, roots, base):
    seen, stack = set(), list(roots)
    while stack:
        n = stack.pop()
        n = n if n in pk else prov.get(n, n)
        if n in seen or n in base or n not in pk:
            continue
        seen.add(n)
        for alts in _deps(pk[n]):
            if not any(a in base or prov.get(a) in base or a in seen for a in alts):
                stack.append(alts[0])
    return seen


def debian():
    res = {}
    for arch in ("amd64", "arm64"):
        pk, prov = _packages(arch)
        base = {n for n, f in pk.items() if f.get("Priority") == "required" or f.get("Essential") == "yes"}
        base = _closure(pk, prov, sorted(base), set())
        res[arch] = {}
        for label, roots in APT_SETS.items():
            s = _closure(pk, prov, roots, base)
            top = sorted(s, key=lambda n: -int(pk[n].get("Installed-Size", 0)))[:6]
            res[arch][label] = {
                "packages": len(s),
                "installed_mb": round(sum(int(pk[n].get("Installed-Size", 0)) for n in s) / 1024, 1),
                "debs_mb": mb(sum(int(pk[n].get("Size", 0)) for n in s)),
                "largest_mb": {n: round(int(pk[n].get("Installed-Size", 0)) / 1024, 1) for n in top},
            }
    return res


# ------------------------------------------------------------------ local

def tree_bytes(p):
    p = Path(p)
    return sum(f.stat().st_size for f in p.rglob("*") if f.is_file()) if p.is_dir() else p.stat().st_size


def gz_mb(path):
    data = Path(path).read_bytes()
    return mb(len(zlib.compress(data, 6)))


def local(builds):
    out = {"binaries": {}, "windows_runtime_mb": {}, "models_mb": {}}
    asis = Path(os.environ.get("LP_RS_BIN", RS_DIR / "target" / "release" / "librephotos-rs.exe"))
    if asis.exists():
        out["binaries"]["as-is (lto thin, cgu 1)"] = {"mb": mb(asis.stat().st_size), "gzip_mb": gz_mb(asis)}
        pdb = RS_DIR / "target" / "release" / "librephotos_rs.pdb"
        if pdb.exists():
            out["binaries"]["as-is PDB (separate file, not shipped)"] = {"mb": mb(pdb.stat().st_size)}
    if builds and Path(builds).exists():
        for line in Path(builds).read_text().splitlines():
            b = json.loads(line)
            exe = Path(builds).parent / f"bin_{b['variant']}.exe"
            row = {"config": b["config"], "build_s": b["seconds"], "built": b["rc"] == 0,
                   "mb": mb(b["bytes"]) if b["bytes"] > 0 and b["rc"] == 0 else None}
            if exe.exists() and b["rc"] == 0:
                row["gzip_mb"] = gz_mb(exe)
            out["binaries"][b["variant"]] = row
    for label, p in {"onnxruntime.dll": SP / "onnxruntime" / "capi" / "onnxruntime.dll",
                     "libvips-42 dll (pyvips-binary, all deps static)":
                         next(SP.glob("libvips-42-*.dll"), None),
                     "exiftool_bin dir (exiftool.exe + perl)": SP / "exiftool_bin",
                     "ffmpeg_bin dir": SP / "ffmpeg_bin"}.items():
        if p and Path(p).exists():
            out["windows_runtime_mb"][label] = mb(tree_bytes(p))
    for d in sorted(MODELS.iterdir()):
        subs = [d] if any(f.is_file() for f in d.iterdir()) else sorted(x for x in d.rglob("*")
                                                                         if x.is_dir() and any(
                                                                             f.is_file() for f in x.iterdir()))
        for s in subs:
            out["models_mb"][s.relative_to(MODELS).as_posix()] = mb(tree_bytes(s))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--builds", help="builds.jsonl of the variant builds (bin_<variant>.exe beside it)")
    args = ap.parse_args()
    res = {"local": local(args.builds)}
    for name, fn in (("docker_hub", hub), ("github_releases", github), ("pypi_wheels", wheels),
                     ("debian_" + DEBIAN, debian)):
        try:
            res[name] = fn()
        except Exception as e:  # noqa: BLE001 - report and keep the other sections
            res[name] = {"error": repr(e)}
        print(name, "done", flush=True)
    Path(args.out).write_text(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()
