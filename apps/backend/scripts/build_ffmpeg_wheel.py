"""Wrap BtbN's FFmpeg builds (GPL, shared) in wheels so pip installs ffmpeg + ffprobe:

    python scripts/build_ffmpeg_wheel.py <autobuild-tag> <build-id> [out_dir]
    python scripts/build_ffmpeg_wheel.py autobuild-2026-09-15-13-18 ffmpeg-n9.0.1-30-g9258bacca5

writes ffmpeg_bin-<ver>-py3-none-{win_amd64,manylinux_2_17_x86_64,manylinux_2_17_aarch64}.whl.
The package puts its bin/ on PATH when imported, and a .pth imports it at
interpreter start. GPL: the wheel carries the build's LICENSE.txt and points at the
release the binaries and their build scripts came from.
"""

import base64
import hashlib
import io
import re
import sys
import tarfile
import urllib.request
import zipfile
from pathlib import Path

INIT = """import os
from pathlib import Path

os.environ["PATH"] = str(Path(__file__).parent / "bin") + os.pathsep + os.environ.get("PATH", "")
"""

PLATFORMS = {
    "win64": ("py3-none-win_amd64", ".zip"),
    "linux64": ("py3-none-manylinux_2_17_x86_64", ".tar.xz"),
    "linuxarm64": ("py3-none-manylinux_2_17_aarch64", ".tar.xz"),
}


def version_of(build_id):
    """ffmpeg-n9.0.1-30-g9258bacca5 -> 9.0.1"""
    return build_id.split("-")[1].lstrip("n")


def payload(tag, build, platform):
    """(relative path, bytes, mode) for ffmpeg, ffprobe, their shared libraries and the license."""
    suffix = PLATFORMS[platform][1]
    branch = version_of(build).rsplit(".", 1)[0]  # 9.0.1 -> 9.0
    name = f"{build}-{platform}-gpl-shared-{branch}{suffix}"
    url = f"https://github.com/BtbN/FFmpeg-Builds/releases/download/{tag}/{name}"
    print("downloading", url)
    data = urllib.request.urlopen(url, timeout=600).read()
    if suffix == ".zip":
        src = zipfile.ZipFile(io.BytesIO(data))
        for info in src.infolist():
            rel = info.filename.split("/", 1)[1] if "/" in info.filename else ""
            if re.fullmatch(
                r"bin/(ffmpeg|ffprobe)\.exe|bin/[^/]+\.dll|LICENSE\.txt", rel
            ):
                yield rel, src.read(info), 0o755 if rel.endswith(".exe") else 0o644
        return
    src = tarfile.open(fileobj=io.BytesIO(data))
    for member in src.getmembers():
        rel = member.name.split("/", 1)[1] if "/" in member.name else ""
        if member.isfile() and re.fullmatch(r"bin/(ffmpeg|ffprobe)|LICENSE\.txt", rel):
            yield (
                rel,
                src.extractfile(member).read(),
                0o755 if rel.startswith("bin/") else 0o644,
            )
        elif member.isfile() and re.fullmatch(
            r"lib/lib[a-z]+\.so\.[0-9]+\.[0-9]+\.[0-9]+", rel
        ):
            # Wheels cannot hold symlinks; store the real file under its SONAME
            # (libavutil.so.61), the name the binaries and the other libraries ask for.
            soname = re.sub(r"(\.so\.[0-9]+)\.[0-9]+\.[0-9]+$", r"\1", rel)
            yield soname, src.extractfile(member).read(), 0o755


def build(tag, build_id, platform, out_dir):
    version = version_of(build_id)
    wheel_tag = PLATFORMS[platform][0]
    files = {
        "ffmpeg_bin/__init__.py": (INIT.encode(), 0o644),
        "ffmpeg_bin.pth": (b"import ffmpeg_bin\n", 0o644),
    }
    for rel, data, mode in payload(tag, build_id, platform):
        files["ffmpeg_bin/" + rel] = (data, mode)
    dist = f"ffmpeg_bin-{version}.dist-info/"
    files[dist + "METADATA"] = (
        (
            f"Metadata-Version: 2.1\nName: ffmpeg-bin\nVersion: {version}\n"
            f"Summary: ffmpeg and ffprobe from BtbN/FFmpeg-Builds {tag} ({build_id}, GPL shared build)\n"
            "License: GPL-3.0-or-later\n"
            f"Project-URL: Source, https://github.com/BtbN/FFmpeg-Builds/releases/tag/{tag}\n"
        ).encode(),
        0o644,
    )
    files[dist + "WHEEL"] = (
        f"Wheel-Version: 1.0\nGenerator: build_ffmpeg_wheel\nRoot-Is-Purelib: true\nTag: {wheel_tag}\n".encode(),
        0o644,
    )
    record = []
    out = Path(out_dir) / f"ffmpeg_bin-{version}-{wheel_tag}.whl"
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as whl:
        for name, (data, mode) in files.items():
            info = zipfile.ZipInfo(name, date_time=(2000, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = (0o100000 | mode) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            whl.writestr(info, data)
            digest = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(
                b"="
            )
            record.append(f"{name},sha256={digest.decode()},{len(data)}")
        record.append(dist + "RECORD,,")
        whl.writestr(dist + "RECORD", "\n".join(record) + "\n")
    print(out, out.stat().st_size // 1000000, "MB")


if __name__ == "__main__":
    tag, build_id = sys.argv[1], sys.argv[2]
    out_dir = sys.argv[3] if len(sys.argv) > 3 else "."
    for platform in PLATFORMS:
        build(tag, build_id, platform, out_dir)
