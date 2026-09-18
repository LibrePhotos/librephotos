"""The standalone build: one binary that is the API server, the job cluster
and every ML sidecar, told apart by its first argument.

scripts/build_standalone.py compiles librephotos_standalone.py (which only
calls main() here) with Nuitka into a directory holding librephotos.exe, the
frontend build, the collected static files and the ExifTool and ffmpeg
binaries. Nothing else is needed on the machine: no Python, no Docker, no
proxy. The database is SQLite and everything the app writes goes under one
per-user data directory.

    librephotos.exe                     start everything and open the browser
    librephotos.exe run --port 8000 --data-dir D:\\LibrePhotos --no-browser
    librephotos.exe manage <command>    any manage.py command, e.g. createadmin
    librephotos.exe service <name>      one sidecar (api.services starts these)

The same module runs from source too (python librephotos_standalone.py), which
is how it is tested; only the paths differ.
"""

import argparse
import importlib
import os
import subprocess
import sys
import threading
import time
import webbrowser

APP_DIR_NAME = "LibrePhotos"
DEFAULT_PORT = 8000
SUBCOMMANDS = ("run", "manage", "service")
BACKEND_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Directories in the distribution whose executables the code finds on PATH:
# the ExifTool wheel (exiftool.exe, or the Perl script) and ffmpeg/ffprobe.
# From source, the wheels' .pth files put the same directories on PATH.
BUNDLED_BINARY_DIRS = (("exiftool_bin",), ("ffmpeg_bin", "bin"))

# What each process is called. Windows shows the executable's file name in Task
# Manager's Details tab, tasklist and Resource Monitor, and thirteen processes
# all named librephotos.exe tell nobody which one is eating the CPU. The names
# are NTFS hard links to the one binary, made on first use: no extra disk
# space, and nothing a zip would have to carry ten times.
PROCESS_NAMES = {
    "jobs": "librephotos-jobs",
    "worker": "librephotos-worker",
    "thumbnail": "librephotos-thumbnails",
    "exif": "librephotos-metadata",
    "face_recognition": "librephotos-faces",
    "clip_embeddings": "librephotos-search",
    "image_similarity": "librephotos-similarity",
    "image_captioning": "librephotos-captions",
    "tags": "librephotos-tags",
    "ocr": "librephotos-ocr",
}

# Management commands the Docker entrypoints run before the server, in order.
# migrate is not among them: it runs in a child process first, see run_server.
STARTUP_COMMANDS = (
    ["start_service", "all"],
    ["start_cleaning_service"],
    ["start_job_cleanup_service"],
    ["clear_cache"],
    ["build_similarity_index"],
)


def standalone_executable():
    """Absolute path of the compiled binary, or None when running from source.

    Nuitka's standalone mode leaves sys.executable pointing at a python.exe
    that does not exist in the distribution, so anything that starts a child
    process (the sidecars, django-q2's workers) has to use the binary itself.
    """
    compiled = getattr(sys.modules.get("__main__"), "__compiled__", None)
    if compiled is None or not getattr(compiled, "standalone", False):
        return None
    return os.path.abspath(getattr(compiled, "original_argv0", None) or sys.argv[0])


def named_executable(role):
    """The binary under the name PROCESS_NAMES gives the role, or the binary
    itself when it has no name or the link cannot be made (read-only install
    directory, a file system without hard links). None when running from source.

    A link left over from a previous version still points at the old binary's
    content after an update replaced librephotos.exe, so it is only trusted
    while it is the same file.
    """
    executable = standalone_executable()
    name = PROCESS_NAMES.get(role)
    if executable is None or name is None:
        return executable
    target = os.path.join(
        os.path.dirname(executable), name + os.path.splitext(executable)[1]
    )
    try:
        if os.path.exists(target) and not os.path.samefile(target, executable):
            os.remove(target)
        if not os.path.exists(target):
            os.link(executable, target)
    except FileExistsError:
        # Another process made it between the check and the link.
        if not os.path.samefile(target, executable):
            return executable
    except OSError:
        return executable
    return target


def install_root():
    """Where the distribution (or, from source, the backend) lives."""
    executable = standalone_executable()
    if executable is None:
        return BACKEND_ROOT
    return os.path.dirname(executable)


def default_data_dir():
    """Per-user application data directory, following each platform's habit."""
    home = os.path.expanduser("~")
    if sys.platform == "win32":
        base = os.environ.get("LOCALAPPDATA") or os.path.join(home, "AppData", "Local")
    elif sys.platform == "darwin":
        base = os.path.join(home, "Library", "Application Support")
    else:
        base = os.environ.get("XDG_DATA_HOME") or os.path.join(home, ".local", "share")
    return os.path.join(base, APP_DIR_NAME)


def prepare_environment(data_dir=None, photos_dir=None):
    """Point the settings at the data directory and the bundled binaries.

    Must run before Django's settings are imported: production.py reads
    BASE_DATA and BASE_LOGS at import time. Explicit environment variables
    win over the defaults so an installation can be relocated the same way a
    container is configured.
    """
    data = os.path.abspath(
        data_dir or os.environ.get("BASE_DATA") or default_data_dir()
    )
    os.environ["BASE_DATA"] = data
    os.environ.setdefault("BASE_LOGS", os.path.join(data, "logs"))
    # DATA_ROOT bounds the scan directories an admin may pick; the home
    # directory lets a desktop user choose their Pictures folder.
    photos = photos_dir or os.environ.get("PHOTOS") or os.path.expanduser("~")
    os.environ["PHOTOS"] = os.path.abspath(photos)
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "librephotos.settings.standalone")
    # The sidecars are only ever reached from this machine and have no
    # authentication. Loopback keeps them off the network, and spares the user
    # a Windows Firewall prompt per executable name.
    os.environ.setdefault("SERVICE_HOST", "127.0.0.1")
    os.makedirs(os.environ["BASE_LOGS"], exist_ok=True)

    root = install_root()
    bundled = [
        os.path.join(root, *parts)
        for parts in BUNDLED_BINARY_DIRS
        if os.path.isdir(os.path.join(root, *parts))
    ]
    if bundled:
        os.environ["PATH"] = os.pathsep.join([*bundled, os.environ.get("PATH", "")])
    return data


def run_manage(argv):
    """Run a manage.py command in this process."""
    from django.core.management import execute_from_command_line

    if argv[:1] == ["qcluster"]:
        # django-q2's guard, pusher, monitor and workers are multiprocessing
        # children; spawn starts them from this executable path.
        worker = named_executable("worker")
        if worker is not None:
            import multiprocessing

            multiprocessing.set_executable(worker)
    execute_from_command_line(["manage.py", *argv])


def service_module_name(name):
    if name == "image_similarity":
        return "image_similarity.main"
    return f"service.{name}.main"


def run_service(name):
    """Run one sidecar in this process, as ``python service/<name>/main.py`` would.

    The sidecars are plain Flask scripts that import their siblings by bare
    name (``from clip_onnx import ...``); scripts/build_standalone.py compiles
    those siblings as top-level modules so the imports resolve the same way.
    """
    module = importlib.import_module(service_module_name(name))
    module.serve()


def child_command(*args, role=None):
    """argv that runs this program again with the given arguments, under the
    executable name of ``role`` (see PROCESS_NAMES) when compiled."""
    executable = named_executable(role)
    if executable is None:
        script = os.path.join(BACKEND_ROOT, "librephotos_standalone.py")
        return [sys.executable, script, *args]
    return [executable, *args]


def _open_browser_when_up(url, timeout=120):
    import requests

    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            if requests.get(f"{url}api/healthz", timeout=2).status_code < 500:
                break
        except requests.RequestException:
            pass
        time.sleep(1)
    webbrowser.open(url)


def _take_children_down_with_us():
    """Put this process in a Windows job that kills its descendants with it.

    Closing the console, Task Manager and a crash all end this process without
    running any cleanup, and the sidecars would live on holding their ports,
    so the next start could not bind them. The job object is the one Windows
    mechanism that follows the process tree regardless of how the root died.
    """
    if sys.platform != "win32":
        return
    import ctypes
    from ctypes import wintypes

    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000
    JobObjectExtendedLimitInformation = 9

    class JOBOBJECT_BASIC_LIMIT_INFORMATION(ctypes.Structure):
        _fields_ = [
            ("PerProcessUserTimeLimit", ctypes.c_int64),
            ("PerJobUserTimeLimit", ctypes.c_int64),
            ("LimitFlags", wintypes.DWORD),
            ("MinimumWorkingSetSize", ctypes.c_size_t),
            ("MaximumWorkingSetSize", ctypes.c_size_t),
            ("ActiveProcessLimit", wintypes.DWORD),
            ("Affinity", ctypes.c_size_t),
            ("PriorityClass", wintypes.DWORD),
            ("SchedulingClass", wintypes.DWORD),
        ]

    class IO_COUNTERS(ctypes.Structure):
        _fields_ = [
            (name, ctypes.c_uint64)
            for name in (
                "ReadOperationCount",
                "WriteOperationCount",
                "OtherOperationCount",
                "ReadTransferCount",
                "WriteTransferCount",
                "OtherTransferCount",
            )
        ]

    class JOBOBJECT_EXTENDED_LIMIT_INFORMATION(ctypes.Structure):
        _fields_ = [
            ("BasicLimitInformation", JOBOBJECT_BASIC_LIMIT_INFORMATION),
            ("IoInfo", IO_COUNTERS),
            ("ProcessMemoryLimit", ctypes.c_size_t),
            ("JobMemoryLimit", ctypes.c_size_t),
            ("PeakProcessMemoryUsed", ctypes.c_size_t),
            ("PeakJobMemoryUsed", ctypes.c_size_t),
        ]

    # Explicit signatures: with ctypes' int defaults the (HANDLE)-1 pseudo
    # handle of GetCurrentProcess is truncated to 32 bits and the assignment
    # fails without a word.
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.CreateJobObjectW.restype = wintypes.HANDLE
    kernel32.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
    kernel32.SetInformationJobObject.restype = wintypes.BOOL
    kernel32.SetInformationJobObject.argtypes = [
        wintypes.HANDLE,
        ctypes.c_int,
        ctypes.c_void_p,
        wintypes.DWORD,
    ]
    kernel32.AssignProcessToJobObject.restype = wintypes.BOOL
    kernel32.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    kernel32.GetCurrentProcess.restype = wintypes.HANDLE

    job = kernel32.CreateJobObjectW(None, None)
    info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION()
    info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    if (
        not job
        or not kernel32.SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            ctypes.byref(info),
            ctypes.sizeof(info),
        )
        or not kernel32.AssignProcessToJobObject(job, kernel32.GetCurrentProcess())
    ):
        print(
            "Could not bind child processes to this one "
            f"(Windows error {ctypes.get_last_error()}); "
            "stop LibrePhotos with Ctrl-C so the sidecars are shut down too",
            flush=True,
        )
    # The handle is deliberately never closed: closing it is what kills the job.


def _set_console_title(title):
    if sys.platform == "win32":
        import ctypes

        ctypes.windll.kernel32.SetConsoleTitleW(title)


def run_server(host, port, open_browser):
    """migrate, start the sidecars, the job cluster and the API server.

    The cluster is a child process (django-q2 forks workers of its own) so
    that closing this one takes the whole application down with it. uvicorn
    runs in-process with a single worker: more would need multiprocessing
    spawn through the binary, and one worker with WEB_THREADS threads is
    enough for a desktop.
    """
    import django

    _take_children_down_with_us()
    # Migrate in a child before this process loads Django. On a first start
    # the settings tables do not exist yet when api.apps.ready() reads the
    # site settings, and in the compiled build that failed lookup leaves the
    # constance config object unable to resolve any attribute for the rest of
    # the process: every request then died with "'LazyConfig' object has no
    # attribute ...". A process that only ever sees a migrated database never
    # takes that path.
    subprocess.run(child_command("manage", "migrate", "--noinput"), check=True)
    django.setup()
    for command in STARTUP_COMMANDS:
        run_manage(command)

    cluster = subprocess.Popen(child_command("manage", "qcluster", role="jobs"))
    try:
        shown_host = "localhost" if host in ("0.0.0.0", "::") else host
        url = f"http://{shown_host}:{port}/"
        _set_console_title(f"LibrePhotos - {url} - close this window to stop")
        print(f"LibrePhotos is starting at {url}", flush=True)
        if open_browser:
            threading.Thread(
                target=_open_browser_when_up, args=(url,), daemon=True
            ).start()

        import uvicorn

        uvicorn.run(
            "librephotos.asgi:application",
            host=host,
            port=port,
            log_level="info",
            workers=1,
        )
    finally:
        _shutdown(cluster)


def _shutdown(cluster):
    from api.services import SERVICES, stop_service

    for service in SERVICES:
        stop_service(service)
    if cluster.poll() is None:
        cluster.terminate()
        try:
            cluster.wait(timeout=15)
        except subprocess.TimeoutExpired:
            cluster.kill()


def build_parser():
    parser = argparse.ArgumentParser(
        prog="librephotos", description="LibrePhotos standalone"
    )
    parser.add_argument(
        "--data-dir",
        help="where the database, thumbnails, models and logs go "
        f"(default: {default_data_dir()})",
    )
    parser.add_argument(
        "--photos",
        help="topmost directory the scan directories may be chosen from "
        "(default: your home directory)",
    )
    sub = parser.add_subparsers(dest="command")

    run = sub.add_parser("run", help="start everything (the default)")
    run.add_argument("--host", default="127.0.0.1")
    run.add_argument("--port", type=int, default=DEFAULT_PORT)
    run.add_argument("--no-browser", action="store_true")

    manage = sub.add_parser("manage", help="run a manage.py command")
    manage.add_argument("argv", nargs=argparse.REMAINDER)

    service = sub.add_parser("service", help="run one sidecar")
    service.add_argument("name")
    return parser


def parse_args(argv):
    """`librephotos.exe` and `librephotos.exe --data-dir X` both mean run."""
    argv = list(argv)
    if not any(arg in SUBCOMMANDS for arg in argv):
        argv.append("run")
    return build_parser().parse_args(argv)


def main(argv=None):
    args = parse_args(sys.argv[1:] if argv is None else argv)
    prepare_environment(args.data_dir, args.photos)

    if args.command == "manage":
        run_manage(args.argv)
    elif args.command == "service":
        run_service(args.name)
    else:
        run_server(args.host, args.port, not args.no_browser)
