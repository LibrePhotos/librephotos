"""Build the standalone LibrePhotos binary with Nuitka.

    python scripts/build_standalone.py [--skip-frontend] [--zip] [--output-dir DIR]

Needs a virtualenv with requirements.txt and requirements.standalone.txt
installed, a C compiler Nuitka can use (MSVC on Windows; it downloads the rest
itself) and, unless --skip-frontend, Node and Yarn for the frontend build.

The result is <output-dir>/librephotos/: librephotos.exe next to everything it
loads at run time. See librephotos/standalone.py for what the binary does.
"""

import argparse
import os
import platform
import shutil
import subprocess
import sys
import sysconfig
import tempfile
import time
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
FRONTEND = BACKEND.parent / "frontend"
ENTRY = BACKEND / "librephotos_standalone.py"
DIST_NAME = "librephotos"

# The sidecars import their neighbours by bare name (``from clip_onnx import
# ...``) because api.services runs them as scripts with their own directory as
# sys.path[0]. Putting those directories on the compile-time path makes Nuitka
# compile the neighbours as the same top-level modules, so the imports resolve
# identically inside the binary. Only main.py is named through its package.
SIDECAR_DIRS = [
    BACKEND / "service" / name
    for name in (
        "clip_embeddings",
        "exif",
        "face_recognition",
        "image_captioning",
        "ocr",
        "tags",
        "thumbnail",
    )
] + [BACKEND / "image_similarity"]

# Packages Django and friends import by name at run time (apps, backends,
# management commands, migrations, providers), which no static import graph
# reaches. Everything else is found by following the imports.
INCLUDE_PACKAGES = [
    "api",
    "librephotos",
    "nextcloud",
    "chunked_upload",
    "django",
    "rest_framework",
    "rest_framework_simplejwt",
    "constance",
    "django_q",
    "corsheaders",
    "django_extensions",
    "django_filters",
    "allauth",
    "whitenoise",
    "uvicorn",
    "a2wsgi",
    "psycopg",
    # Named as strings in the settings (LOGGING, REST_FRAMEWORK), or loaded
    # by name inside Django (PASSWORD_HASHERS' Argon2PasswordHasher).
    "concurrent_log_handler",
    "portalocker",
    "drf_spectacular",
    "argon2",
    "geographiclib",
    # Picks its backend (pystray._win32) by name at import.
    "pystray",
]

# Non-Python files those packages read: templates, locale, static files, data.
INCLUDE_PACKAGE_DATA = [
    "django",
    "rest_framework",
    "allauth",
    "constance",
    "django_extensions",
    "timezonefinder",
    "tzdata",
    "certifi",
    "insightface",
]

# Never useful in the binary, and some of them drag in whole test frameworks.
# Only our own test packages are named: a wildcard like "*.test" also hits
# werkzeug.test, which werkzeug imports at run time.
NOFOLLOW = [
    "api.tests",
    "nextcloud.tests",
    "service.thumbnail.test",
    "pytest",
    "_pytest",
    "IPython",
    "jupyter",
    "notebook",
    "tkinter",
    "silk",
    "coverage",
]

# Wheels whose executables the binary puts on PATH (librephotos.standalone).
BUNDLED_BINARY_DIRS = {
    "exiftool_bin": Path("exiftool_bin"),
    "ffmpeg_bin/bin": Path("ffmpeg_bin") / "bin",
}

# Source files that must exist on disk next to their compiled module: simplejwt's
# 0011_linearizes_history migration lists its own directory for "000*.py" and
# resolves __file__ strictly. Nuitka refuses .py files as data, so they are
# copied in afterwards; the compiled modules still take precedence on import.
SOURCE_FILES_ON_DISK = [
    Path("rest_framework_simplejwt") / "token_blacklist" / "migrations",
]


def run(command, **kwargs):
    print("+", " ".join(str(part) for part in command), flush=True)
    subprocess.run(command, check=True, **kwargs)


def build_frontend():
    yarn = shutil.which("yarn") or shutil.which("yarn.cmd")
    if yarn is None:
        sys.exit("yarn not found; install Node and Yarn or pass --skip-frontend")
    run(
        [yarn, "install", "--frozen-lockfile", "--network-timeout", "600000"],
        cwd=FRONTEND,
    )
    run([yarn, "build"], cwd=FRONTEND)


def stage_frontend():
    dist = FRONTEND / "dist"
    if not (dist / "index.html").exists():
        sys.exit(f"no frontend build at {dist}; run without --skip-frontend")
    target = BACKEND / "frontend_build"
    shutil.rmtree(target, ignore_errors=True)
    shutil.copytree(dist, target)
    return target


def collect_static():
    """collectstatic into <backend>/static, where the settings look at run time.

    The settings module creates the data and log directories and a secret key
    on import, so point it at a scratch directory rather than the developer's
    real one.
    """
    scratch = Path(tempfile.mkdtemp(prefix="librephotos-build-"))
    env = {
        **os.environ,
        "DJANGO_SETTINGS_MODULE": "librephotos.settings.standalone",
        "BASE_DATA": str(scratch),
        "BASE_LOGS": str(scratch / "logs"),
        "SECRET_KEY": "build",
    }
    shutil.rmtree(BACKEND / "static", ignore_errors=True)
    run(
        [sys.executable, "manage.py", "collectstatic", "--noinput", "--clear"],
        cwd=BACKEND,
        env=env,
    )
    shutil.rmtree(scratch, ignore_errors=True)
    return BACKEND / "static"


def nuitka_command(output_dir, jobs, version):
    command = [
        sys.executable,
        "-m",
        "nuitka",
        "--standalone",
        "--assume-yes-for-downloads",
        f"--output-dir={output_dir}",
        f"--output-filename={DIST_NAME}",
        "--company-name=LibrePhotos",
        "--product-name=LibrePhotos",
        f"--product-version={version}",
        "--file-description=LibrePhotos standalone server",
        # Docstrings stay: scikit-image edits its own __doc__ strings while it
        # imports (skimage._shared.utils), and insightface needs that module.
        "--python-flag=-u",
        "--enable-plugin=gevent",
        "--enable-plugin=matplotlib",
        # `manage shell -c` passes -c through argv, which Nuitka's guard against
        # a program re-running itself otherwise refuses.
        "--no-deployment-flag=self-execution",
        # A Windows GUI program: a double-click opens no console window and
        # the application lives in the notification area, while a start from
        # a terminal or with redirected output still prints there.
        "--windows-console-mode=attach",
    ]
    if jobs:
        command.append(f"--jobs={jobs}")
    icon = FRONTEND / "public" / "favicon.ico"
    if sys.platform == "win32" and icon.exists():
        command.append(f"--windows-icon-from-ico={icon}")
    command += [f"--include-package={name}" for name in INCLUDE_PACKAGES]
    command += [f"--include-package-data={name}" for name in INCLUDE_PACKAGE_DATA]
    command += [f"--nofollow-import-to={name}" for name in NOFOLLOW]
    for directory in SIDECAR_DIRS:
        module = directory.relative_to(BACKEND).as_posix().replace("/", ".")
        command.append(f"--include-module={module}.main")
    # Shared by the ML sidecars' top-level neighbours (clip_onnx, lfm2_vl, ...)
    # and by every sidecar's main.py (the Flask app, /health, serve); named so
    # the binary never depends on Nuitka following those imports.
    command.append("--include-module=service.onnx_session")
    command.append("--include-module=service._common")
    # The tag vocabulary is looked up two directories above the tagger
    # modules, which compile as top-level packages: that is the distribution root.
    command.append(
        f"--include-data-files={BACKEND / 'service' / 'tags' / 'tags.txt'}=tags.txt"
    )
    command.append(str(ENTRY))
    return command


def compile_binary(output_dir, jobs, version):
    env = {
        **os.environ,
        "PYTHONPATH": os.pathsep.join(
            [str(directory) for directory in SIDECAR_DIRS]
            + [p for p in os.environ.get("PYTHONPATH", "").split(os.pathsep) if p]
        ),
    }
    run(nuitka_command(output_dir, jobs, version), cwd=BACKEND, env=env)
    built = output_dir / f"{ENTRY.stem}.dist"
    dist = output_dir / DIST_NAME
    shutil.rmtree(dist, ignore_errors=True)
    # Right after linking, the virus scanner still holds the new binary open
    # for a moment and the rename is refused; it goes through a few seconds later.
    for attempt in range(10):
        try:
            built.rename(dist)
            break
        except PermissionError:
            if attempt == 9:
                raise
            time.sleep(3)
    return dist


def copy_tree(source, target):
    shutil.copytree(
        source,
        target,
        dirs_exist_ok=True,
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
    )


def stage_runtime_files(dist, frontend_build, static):
    copy_tree(frontend_build, dist / "frontend_build")
    copy_tree(static, dist / "static")
    site_packages = Path(sysconfig.get_paths()["purelib"])
    for source, target in BUNDLED_BINARY_DIRS.items():
        source_dir = site_packages / Path(source)
        if not source_dir.is_dir():
            sys.exit(f"{source_dir} is missing; is requirements.txt installed?")
        copy_tree(source_dir, dist / target)
    for directory in SOURCE_FILES_ON_DISK:
        (dist / directory).mkdir(parents=True, exist_ok=True)
        for source in (site_packages / directory).glob("*.py"):
            shutil.copy(source, dist / directory / source.name)
    for name in ("LICENSE", "README.md"):
        shutil.copy(BACKEND / name, dist / name)
    (dist / "START_HERE.txt").write_text(
        "LibrePhotos standalone\n"
        "\n"
        "Double-click librephotos.exe (or run it from a terminal) to start the\n"
        "server; it opens http://localhost:8000/ in your browser. The first start\n"
        "creates the admin account and downloads the machine learning models.\n"
        "\n"
        "Your library stays where it is: set the scan directory of your user to\n"
        "the folder with your photos. The database, thumbnails and logs go to\n"
        "%LOCALAPPDATA%\\LibrePhotos (pass --data-dir to choose another place).\n"
        "\n"
        "librephotos.exe --help lists the options; librephotos.exe manage <cmd>\n"
        "runs any manage.py command, e.g. manage createadmin.\n",
        encoding="utf-8",
    )


def archive(dist, output_dir):
    machine = platform.machine().lower()
    arch = {"amd64": "x64", "x86_64": "x64", "arm64": "arm64", "aarch64": "arm64"}.get(
        machine, machine
    )
    system = {"win32": "windows", "darwin": "macos"}.get(sys.platform, sys.platform)
    name = f"librephotos-{system}-{arch}"
    path = shutil.make_archive(
        str(output_dir / name), "zip", root_dir=output_dir, base_dir=dist.name
    )
    print(f"archive: {path} ({os.path.getsize(path) / 2**20:.0f} MB)")
    return Path(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument(
        "--skip-frontend", action="store_true", help="reuse apps/frontend/dist"
    )
    parser.add_argument(
        "--zip", action="store_true", help="also write a zip next to the build"
    )
    parser.add_argument(
        "--output-dir", type=Path, default=BACKEND / "build" / "standalone"
    )
    parser.add_argument(
        "--jobs", type=int, help="parallel C compilations (default: all cores)"
    )
    parser.add_argument(
        "--version", default="0.0.0", help="numeric X.Y.Z stamped into the executable"
    )
    args = parser.parse_args()

    if not args.skip_frontend:
        build_frontend()
    frontend_build = stage_frontend()
    static = collect_static()
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    dist = compile_binary(output_dir, args.jobs, args.version)
    stage_runtime_files(dist, frontend_build, static)
    print(f"built: {dist}")
    if args.zip:
        archive(dist, output_dir)


if __name__ == "__main__":
    main()
