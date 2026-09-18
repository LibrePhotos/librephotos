"""The standalone build: one binary that is the API server, the job cluster
and every ML sidecar, told apart by its first argument.

scripts/build_standalone.py compiles librephotos_standalone.py (which only
calls main() here) with Nuitka into a directory holding librephotos.exe, the
frontend build, the collected static files and the ExifTool and ffmpeg
binaries. Nothing else is needed on the machine: no Python, no Docker, no
proxy. The database is SQLite and everything the app writes goes under one
per-user data directory.

    librephotos.exe                     start everything and open the browser;
                                        lives in the notification area (tray)
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
# Set by the root process when it runs without a console: where its own output
# and that of every child goes instead (see bootstrap_process).
CONSOLE_LOG_ENV = "LIBREPHOTOS_CONSOLE_LOG"
CONSOLE_LOG_NAME = "console.log"
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
    # This module's own marker, which Nuitka gives every compiled module, and
    # not __main__'s: while a multiprocessing child is still importing the
    # entry script, __main__ is multiprocessing's bootstrap, the check said
    # "running from source", and bootstrap_process() skipped exactly the
    # processes (django-q2's sentinel and workers) that needed it.
    compiled = globals().get("__compiled__")
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


def _has_console_window():
    if sys.platform != "win32":
        return True
    import ctypes
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32")
    kernel32.GetConsoleWindow.restype = wintypes.HWND
    return bool(kernel32.GetConsoleWindow())


def _output_is_discarded():
    """Started without a console and without redirection (a double-click from
    Explorer, or a child of such a process): the binary is a Windows GUI
    program, and Nuitka then binds stdout and stderr to NUL."""
    return getattr(sys.stdout, "name", None) in (None, "NUL:", "nul")


def _redirect_output(path, mode):
    stream = open(path, mode, encoding="utf-8", errors="replace", buffering=1)  # noqa: SIM115
    sys.stdout = sys.stderr = stream


def _repair_standard_handles():
    """Point standard handles that are missing or invalid at NUL.

    A Windows GUI process started without a console has no usable stdin,
    stdout or stderr handle. Python only notices when a child's output is
    captured: it then has to hand the child all three, duplicates its own for
    the ones the caller left alone, and fails with "[WinError 6] The handle is
    invalid". Django does exactly that at import (git log, for its version
    string), so not even migrate ran; ffmpeg, ffprobe and ExifTool calls would
    have been next. Valid handles - a console, a pipe, a file - are left as
    they are.
    """
    import ctypes
    import msvcrt
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.GetStdHandle.restype = wintypes.HANDLE
    kernel32.GetStdHandle.argtypes = [wintypes.DWORD]
    kernel32.SetStdHandle.restype = wintypes.BOOL
    kernel32.SetStdHandle.argtypes = [wintypes.DWORD, wintypes.HANDLE]
    kernel32.GetFileType.restype = wintypes.DWORD
    kernel32.GetFileType.argtypes = [wintypes.HANDLE]
    file_type_unknown = 0

    repaired = []
    for name, number in (("stdin", -10), ("stdout", -11), ("stderr", -12)):
        number &= 0xFFFFFFFF
        handle = kernel32.GetStdHandle(number)
        if handle and kernel32.GetFileType(handle) != file_type_unknown:
            continue
        # Never closed: the handle has to stay valid for the life of the process.
        fd = os.open(os.devnull, os.O_RDONLY if name == "stdin" else os.O_WRONLY)
        kernel32.SetStdHandle(number, msvcrt.get_osfhandle(fd))
        repaired.append(name)
    return repaired


def _hide_child_consoles():
    """Start child processes without a console window of their own.

    A process that has no console gives every console program it starts a
    brand-new, visible one: ffmpeg, ffprobe, git and perl would each flash a
    black window over whatever the user is doing. There are a dozen call sites
    and some are in third-party code, so the default is changed once here
    rather than at each of them.
    """
    original = subprocess.Popen.__init__
    if getattr(original, "_no_console_window", False):
        return
    own_console = subprocess.CREATE_NEW_CONSOLE | subprocess.DETACHED_PROCESS

    def __init__(self, *args, **kwargs):
        flags = kwargs.get("creationflags", 0)
        if not flags & own_console:
            kwargs["creationflags"] = flags | subprocess.CREATE_NO_WINDOW
        original(self, *args, **kwargs)

    __init__._no_console_window = True
    subprocess.Popen.__init__ = __init__


def bootstrap_process():
    """Per-process setup of the compiled build.

    librephotos_standalone.py calls this at import, which is the one place
    that runs in every process: the root, the job cluster, each sidecar, and
    django-q2's multiprocessing children (Nuitka runs the entry script again
    there, as __parents_main__, without calling main()). From source, and on
    other platforms, it does nothing.
    """
    if standalone_executable() is None or sys.platform != "win32":
        return
    _repair_standard_handles()
    if not _has_console_window():
        _hide_child_consoles()
    console_log = os.environ.get(CONSOLE_LOG_ENV)
    if console_log and _output_is_discarded():
        _redirect_output(console_log, "a")


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


def _already_running(url):
    import requests

    try:
        return requests.get(f"{url}api/healthz", timeout=2).ok
    except requests.RequestException:
        return False


def _tray_image():
    from PIL import Image

    candidates = (
        os.path.join(install_root(), "frontend_build", "favicon.ico"),
        os.path.join(BACKEND_ROOT, os.pardir, "frontend", "public", "favicon.ico"),
    )
    for candidate in candidates:
        if os.path.exists(candidate):
            return Image.open(candidate)
    return Image.new("RGB", (64, 64), (30, 120, 200))


def _start_tray(url, server):
    """An icon in the notification area: the application's only surface once
    there is no console window. Returns the icon, or None when it cannot be
    shown (pystray missing, no desktop session); the server runs either way."""
    try:
        import pystray

        def open_folder(path):
            return lambda icon, item: os.startfile(path)

        def quit_app(icon, item):
            server.should_exit = True
            icon.stop()

        icon = pystray.Icon(
            "librephotos",
            _tray_image(),
            f"LibrePhotos - {url}",
            menu=pystray.Menu(
                pystray.MenuItem(
                    "Open LibrePhotos",
                    lambda icon, item: webbrowser.open(url),
                    default=True,
                ),
                pystray.MenuItem(
                    "Open data folder", open_folder(os.environ["BASE_DATA"])
                ),
                pystray.MenuItem("Open logs", open_folder(os.environ["BASE_LOGS"])),
                pystray.Menu.SEPARATOR,
                pystray.MenuItem("Quit LibrePhotos", quit_app),
            ),
        )
        threading.Thread(target=icon.run, daemon=True, name="tray").start()
        return icon
    except Exception as error:
        print(f"No notification area icon: {error!r}", flush=True)
        return None


def _report_failure(message):
    """Say why the start failed. Without a console there is nowhere to read
    it, and an application that silently does nothing is the worst outcome."""
    print(message, flush=True)
    if sys.platform == "win32" and not _has_console_window():
        import ctypes

        log = os.path.join(os.environ.get("BASE_LOGS", ""), CONSOLE_LOG_NAME)
        ctypes.windll.user32.MessageBoxW(
            None, f"{message}\n\nDetails: {log}", "LibrePhotos", 0x10
        )


def _set_console_title(title):
    if sys.platform == "win32":
        import ctypes

        ctypes.windll.kernel32.SetConsoleTitleW(title)


def run_server(host, port, open_browser, tray=True):
    """migrate, start the sidecars, the job cluster and the API server.

    The cluster is a child process (django-q2 forks workers of its own) so
    that closing this one takes the whole application down with it. uvicorn
    runs in-process with a single worker: more would need multiprocessing
    spawn through the binary, and one worker with WEB_THREADS threads is
    enough for a desktop.
    """
    import django

    shown_host = "localhost" if host in ("0.0.0.0", "::") else host
    url = f"http://{shown_host}:{port}/"
    if _already_running(url):
        # A second double-click: show the instance that is there instead of
        # failing on its port where nobody would see it.
        print(f"LibrePhotos is already running at {url}", flush=True)
        if open_browser:
            webbrowser.open(url)
        return

    if standalone_executable() is not None and _output_is_discarded():
        console_log = os.path.join(os.environ["BASE_LOGS"], CONSOLE_LOG_NAME)
        _redirect_output(console_log, "w")
        os.environ[CONSOLE_LOG_ENV] = console_log

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

    import uvicorn

    # A Server rather than uvicorn.run(), so the tray's Quit can stop it.
    server = uvicorn.Server(
        uvicorn.Config(
            "librephotos.asgi:application",
            host=host,
            port=port,
            log_level="info",
            workers=1,
        )
    )
    cluster = subprocess.Popen(child_command("manage", "qcluster", role="jobs"))
    icon = None
    try:
        _set_console_title(f"LibrePhotos - {url} - close this window to stop")
        print(f"LibrePhotos is starting at {url}", flush=True)
        if tray and sys.platform == "win32":
            icon = _start_tray(url, server)
        if open_browser:
            threading.Thread(
                target=_open_browser_when_up, args=(url,), daemon=True
            ).start()
        server.run()
        if not server.started:
            raise RuntimeError(f"The server could not start on {host}:{port}")
    finally:
        if icon is not None:
            icon.stop()
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
    run.add_argument(
        "--no-tray", action="store_true", help="no icon in the notification area"
    )

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
        try:
            run_server(args.host, args.port, not args.no_browser, not args.no_tray)
        except Exception as error:
            import traceback

            traceback.print_exc()
            _report_failure(f"LibrePhotos could not start: {error}")
            raise SystemExit(1) from error


# Also at import, not only from the entry script: this module is imported in
# every process of the binary, whatever multiprocessing does with __main__, and
# the handles have to be in order before Django is imported. It does nothing
# from source or on other platforms, and every step of it is safe to repeat.
bootstrap_process()
