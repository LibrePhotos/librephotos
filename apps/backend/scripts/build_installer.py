from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
BACKEND = SCRIPTS.parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from build_standalone import (
    CHECKSUMS_NAME,
    archive_names,
    platform_suffix,
    write_checksums,
)
from windows_signing import inno_sign_tool

from librephotos.installation import SETUP_NAME, STABLE_SETUP_NAME

SCRIPT = BACKEND / "installer" / "librephotos.iss"
DEFAULT_ISCC = (
    Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"))
    / "Inno Setup 6"
    / "ISCC.exe"
)
SIGN_TOOL_NAME = "librephotos"


def find_iscc(explicit: str | None) -> Path:
    for candidate in (explicit, os.environ.get("ISCC"), shutil.which("ISCC")):
        if candidate and Path(candidate).is_file():
            return Path(candidate)
    if DEFAULT_ISCC.is_file():
        return DEFAULT_ISCC
    sys.exit("ISCC.exe (Inno Setup 6) not found; pass --iscc or set ISCC")


def dist_version(dist: Path) -> str:
    info = json.loads((dist / "build_info.json").read_text(encoding="utf-8"))
    return str(info.get("version") or "0.0.0")


def setup_names(version: str) -> list[str]:
    if version == "0.0.0":
        return [STABLE_SETUP_NAME]
    return [SETUP_NAME.format(version=version), STABLE_SETUP_NAME]


def iscc_command(
    iscc: Path, dist: Path, output_dir: Path, version: str, compression: str
) -> list[str]:
    sign_tool = inno_sign_tool()
    output_name = Path(setup_names(version)[0]).stem
    command = [
        str(iscc),
        "/Qp",
        f"/DAppVersion={version}",
        f"/DDistDir={dist}",
        f"/DOutputDir={output_dir}",
        f"/DOutputName={output_name}",
        f"/DCompression={compression}",
    ]
    if sign_tool:
        command += [
            f"/DSignToolName={SIGN_TOOL_NAME}",
            f"/S{SIGN_TOOL_NAME}={sign_tool}",
        ]
    return [*command, str(SCRIPT)]


def release_assets(output_dir: Path, version: str) -> list[Path]:
    zips = [f"{name}.zip" for name in archive_names(version, platform_suffix())]
    names = [*zips, *setup_names(version)]
    return [output_dir / name for name in names if (output_dir / name).is_file()]


def build(
    dist: Path, output_dir: Path, version: str, compression: str, iscc: Path
) -> list[Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    command = iscc_command(iscc, dist, output_dir, version, compression)
    print("+", " ".join(command[:-1]), command[-1], flush=True)
    subprocess.run(command, check=True)
    first, *aliases = setup_names(version)
    for alias in aliases:
        shutil.copyfile(output_dir / first, output_dir / alias)
    return [output_dir / name for name in setup_names(version)]


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build LibrePhotos-Setup-<version>.exe from the standalone build"
    )
    parser.add_argument(
        "--dist",
        type=Path,
        default=BACKEND / "build" / "standalone" / "librephotos",
        help="the build's librephotos folder",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        help="where the installer goes (default: next to the build's folder)",
    )
    parser.add_argument(
        "--version", help="default: the version in the build's build_info.json"
    )
    parser.add_argument("--compression", default="lzma2/max")
    parser.add_argument("--iscc", help="path of ISCC.exe")
    parser.add_argument(
        "--checksums",
        action="store_true",
        help=f"rewrite {CHECKSUMS_NAME} in the output folder with the zips and installers",
    )
    args = parser.parse_args()
    dist = args.dist.resolve()
    output_dir = (args.output_dir or dist.parent).resolve()
    version = args.version or dist_version(dist)
    setups = build(dist, output_dir, version, args.compression, find_iscc(args.iscc))
    for setup in setups:
        print(f"installer: {setup} ({setup.stat().st_size / 2**20:.0f} MB)")
    if args.checksums:
        checksums = write_checksums(
            release_assets(output_dir, version), output_dir / CHECKSUMS_NAME
        )
        print(checksums.read_text(encoding="utf-8"), end="")


if __name__ == "__main__":
    main()
