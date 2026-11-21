import argparse
import os
import shutil
import subprocess
import sys
import tomllib
from pathlib import Path

OPENCV_PYTHON_REPO = "https://github.com/opencv/opencv-python.git"
OPENCV_PYTHON_TAG = "93"
DIST_NAME = "opencv_lp_headless"
CMAKE = "cmake==4.3.2"
NINJA = "ninja==1.13.0"

MODULES = ("core", "flann", "geometry", "imgproc", "imgcodecs")

OPTIONS = {
    "PYTHON3_LIMITED_API": "ON",
    "WITH_IPP": "ON",
    "WITH_LAPACK": "OFF",
    "WITH_EIGEN": "OFF",
    "WITH_OPENCL": "OFF",
    "WITH_ITT": "OFF",
    "WITH_PROTOBUF": "OFF",
    "WITH_FFMPEG": "OFF",
    "WITH_GSTREAMER": "OFF",
    "WITH_V4L": "OFF",
    "WITH_1394": "OFF",
    "WITH_DSHOW": "OFF",
    "WITH_MSMF": "OFF",
    "WITH_OBSENSOR": "OFF",
    "WITH_OPENEXR": "OFF",
    "WITH_OPENJPEG": "OFF",
    "WITH_JASPER": "OFF",
    "WITH_AVIF": "OFF",
    "WITH_JPEGXL": "OFF",
    "WITH_GDAL": "OFF",
    "WITH_GDCM": "OFF",
    "WITH_SPNG": "OFF",
    "WITH_IMGCODEC_GIF": "OFF",
    "WITH_IMGCODEC_HDR": "OFF",
    "WITH_IMGCODEC_PFM": "OFF",
    "WITH_IMGCODEC_PXM": "OFF",
    "WITH_IMGCODEC_SUNRASTER": "OFF",
    "WITH_JPEG": "ON",
    "WITH_PNG": "ON",
    "WITH_TIFF": "ON",
    "WITH_WEBP": "ON",
    "BUILD_JPEG": "ON",
    "BUILD_PNG": "ON",
    "BUILD_TIFF": "ON",
    "BUILD_WEBP": "ON",
    "BUILD_ZLIB": "ON",
}

STUBS = "opencv/modules/python/src2/typing_stubs_generation"
REFINEMENT = f"{STUBS}/api_refinement.py"
PREDEFINED_TYPES = f"{STUBS}/predefined_types.py"

PATCHES = [
    (
        "setup.py",
        '[r"bin/opencv_videoio_ffmpeg\\d{3}%s\\.dll" % ("_64" if is64 else "")]',
        "[]",
    ),
    (
        REFINEMENT,
        "from .ast_utils import (find_function_node, SymbolName,",
        "from .ast_utils import (ScopeNotFoundError, SymbolNotFoundError,\n"
        "                        find_function_node, SymbolName,",
    ),
    (
        REFINEMENT,
        "        refine_symbol(root, symbol_name)\n",
        "        try:\n"
        "            refine_symbol(root, symbol_name)\n"
        "        except (ScopeNotFoundError, SymbolNotFoundError):\n"
        "            pass\n",
    ),
    (
        PREDEFINED_TYPES,
        '    AliasTypeNode.class_("FeatureDetector", "Feature2D",\n'
        '                         export_name="FeatureDetector"),\n'
        '    AliasTypeNode.class_("DescriptorExtractor", "Feature2D",\n'
        '                         export_name="DescriptorExtractor"),\n'
        '    AliasTypeNode.class_("FeatureExtractor", "Feature2D",\n'
        '                         export_name="FeatureExtractor"),\n',
        "",
    ),
]


def run(command: list[str], cwd: Path | None = None) -> None:
    print("+", " ".join(command), flush=True)
    subprocess.run(command, check=True, cwd=cwd)


def checkout(work: Path) -> Path:
    source = work / "opencv-python"
    if source.exists():
        shutil.rmtree(source)
    run(
        [
            "git",
            "clone",
            "--depth",
            "1",
            "--branch",
            OPENCV_PYTHON_TAG,
            OPENCV_PYTHON_REPO,
            str(source),
        ]
    )
    run(["git", "submodule", "update", "--init", "--depth", "1", "opencv"], source)
    for name, old, new in PATCHES:
        path = source / name
        text = path.read_text(encoding="utf-8")
        if text.count(old) != 1:
            sys.exit(f"{name}: patch target not found once: {old}")
        path.write_text(text.replace(old, new), encoding="utf-8")
    return source


def build_requirements(source: Path) -> list[str]:
    project = tomllib.loads((source / "pyproject.toml").read_text(encoding="utf-8"))
    return [*project["build-system"]["requires"], CMAKE, NINJA, "wheel"]


def cmake_args(modules: list[str], defines: list[str]) -> str:
    options = {"BUILD_LIST": ",".join([*modules, "python3"]), **OPTIONS}
    for define in defines:
        name, _, value = define.partition("=")
        options[name] = value
    return " ".join(f"-D{name}={value}" for name, value in options.items())


def build(source: Path, raw: Path, modules: list[str], defines: list[str]) -> None:
    run([sys.executable, "-m", "pip", "install", *build_requirements(source)])
    env = {
        **os.environ,
        "ENABLE_HEADLESS": "1",
        "ENABLE_CONTRIB": "0",
        "ENABLE_ROLLING": "0",
        "OPENCV_PYTHON_PACKAGE_NAME": DIST_NAME,
        "OPENCV_PYTHON_SKIP_GIT_COMMANDS": "1",
        "CMAKE_ARGS": cmake_args(modules, defines),
    }
    if sys.platform == "win32":
        env["CI_BUILD"] = "1"
    command = [
        sys.executable,
        "setup.py",
        "bdist_wheel",
        "--py-limited-api=cp37",
        f"--dist-dir={raw}",
    ]
    print("+ CMAKE_ARGS=" + env["CMAKE_ARGS"], flush=True)
    print("+", " ".join(command), flush=True)
    subprocess.run(command, check=True, cwd=source, env=env)


def repair(raw: Path, out: Path, platform: str | None) -> None:
    out.mkdir(parents=True, exist_ok=True)
    for wheel in raw.glob("*.whl"):
        if platform:
            run(
                ["auditwheel", "repair", "--plat", platform, "-w", str(out), str(wheel)]
            )
        else:
            shutil.copy2(wheel, out / wheel.name)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("out_dir", type=Path)
    parser.add_argument("--work-dir", type=Path, default=Path("build") / "opencv")
    parser.add_argument("--modules", default=",".join(MODULES))
    parser.add_argument("--define", action="append", default=[])
    parser.add_argument("--plat")
    args = parser.parse_args()
    work = args.work_dir.resolve()
    work.mkdir(parents=True, exist_ok=True)
    source = checkout(work)
    raw = work / "raw"
    shutil.rmtree(raw, ignore_errors=True)
    build(source, raw, args.modules.split(","), args.define)
    repair(raw, args.out_dir.resolve(), args.plat)


if __name__ == "__main__":
    main()
