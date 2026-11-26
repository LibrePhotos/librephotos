import argparse
import base64
import hashlib
import zipfile
from pathlib import Path

INIT = """import os
from pathlib import Path

os.environ["PATH"] = str(Path(__file__).parent / "bin") + os.pathsep + os.environ.get("PATH", "")
"""

WHEEL_TAGS = {
    "win64": "py3-none-win_amd64",
    "linux-x86_64": "py3-none-manylinux_2_28_x86_64",
    "linux-aarch64": "py3-none-manylinux_2_28_aarch64",
    "macos-arm64": "py3-none-macosx_14_0_arm64",
}


def file_mode(relative: str) -> int:
    executable = relative.startswith("bin/") or relative.startswith("lib/")
    return 0o755 if executable else 0o644


def payload(stage: Path) -> dict[str, tuple[bytes, int]]:
    files = {
        "ffmpeg_bin/__init__.py": (INIT.encode(), 0o644),
        "ffmpeg_bin.pth": (b"import ffmpeg_bin\n", 0o644),
    }
    for path in sorted(p for p in stage.rglob("*") if p.is_file()):
        relative = path.relative_to(stage).as_posix()
        files["ffmpeg_bin/" + relative] = (path.read_bytes(), file_mode(relative))
    return files


def metadata(version: str, source_url: str) -> bytes:
    return (
        f"Metadata-Version: 2.1\nName: ffmpeg-bin\nVersion: {version}\n"
        f"Summary: ffmpeg and ffprobe {version}, a minimal GPL build for LibrePhotos\n"
        "License: GPL-2.0-or-later\n"
        f"Project-URL: Source, {source_url}\n"
    ).encode()


def build(
    stage: Path, platform: str, version: str, source_url: str, out_dir: Path
) -> Path:
    wheel_tag = WHEEL_TAGS[platform]
    files = payload(stage)
    dist = f"ffmpeg_bin-{version}.dist-info/"
    files[dist + "METADATA"] = (metadata(version, source_url), 0o644)
    files[dist + "WHEEL"] = (
        f"Wheel-Version: 1.0\nGenerator: build_ffmpeg_wheel\nRoot-Is-Purelib: true\nTag: {wheel_tag}\n".encode(),
        0o644,
    )
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"ffmpeg_bin-{version}-{wheel_tag}.whl"
    record = []
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as whl:
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
        info = zipfile.ZipInfo(dist + "RECORD", date_time=(2000, 1, 1, 0, 0, 0))
        info.create_system = 3
        info.external_attr = (0o100000 | 0o644) << 16
        info.compress_type = zipfile.ZIP_DEFLATED
        whl.writestr(info, "\n".join(record) + "\n")
    print(out, out.stat().st_size // 1_000_000, "MB")
    return out


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Package a staged ffmpeg build (scripts/ffmpeg/build.sh) as the ffmpeg-bin wheel."
    )
    parser.add_argument("stage", type=Path)
    parser.add_argument("platform", choices=sorted(WHEEL_TAGS))
    parser.add_argument("version")
    parser.add_argument("source_url")
    parser.add_argument("out_dir", type=Path)
    args = parser.parse_args()
    build(args.stage, args.platform, args.version, args.source_url, args.out_dir)


if __name__ == "__main__":
    main()
