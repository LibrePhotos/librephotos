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
    librephotos.exe service <name>      one sidecar (api.runtime.supervisor starts these)

The same module runs from source too (python librephotos_standalone.py), which
is how it is tested; only the paths differ.
"""

from __future__ import annotations

import argparse
import errno
import importlib
import json
import os
import re
import subprocess
import sys
import threading
import time
import webbrowser
from collections import deque
from collections.abc import Callable, Sequence
from typing import TYPE_CHECKING, Any

from librephotos import instance_lock, startup_page

if TYPE_CHECKING:
    # Only for annotations: the GUI and the server modules are imported lazily
    # inside the functions that use them.
    import uvicorn
    from PIL import Image

    from librephotos.tray import Tray

APP_DIR_NAME = "LibrePhotos"
DEFAULT_PORT = 8000
# The port the message about a taken one suggests instead (#2323).
ALTERNATIVE_PORT = 8080
# Set by the root process when it runs without a console: where its own output
# and that of every child goes instead (see bootstrap_process).
CONSOLE_LOG_ENV = "LIBREPHOTOS_CONSOLE_LOG"
CONSOLE_LOG_NAME = "console.log"
# The previous start's console.log, kept so a failed start can still be
# explained after the next attempt (#2316).
PREVIOUS_CONSOLE_LOG_NAME = "console.previous.log"
SUBCOMMANDS = ("run", "manage", "service")
# Written next to the binary by scripts/build_standalone.py: the release and
# commit it was built from, which the Docker images get from build arguments.
BUILD_INFO_NAME = "build_info.json"
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
    "image_similarity": "librephotos-similarity",
    "image_captioning": "librephotos-captions",
    "tags": "librephotos-tags",
    "ocr": "librephotos-ocr",
}

# Management commands the Docker entrypoints run before the server, in order.
# backup_database and migrate are not among them: they run in child processes
# first, see run_server.
STARTUP_COMMANDS = (
    ["start_service", "all"],
    ["start_cleaning_service"],
    ["start_job_cleanup_service"],
    ["clear_cache"],
    ["build_similarity_index"],
    ["start_upgrade_tasks"],
)


def standalone_executable() -> str | None:
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


def named_executable(role: str | None) -> str | None:
    """The binary under the name PROCESS_NAMES gives the role, or the binary
    itself when it has no name or the link cannot be made (read-only install
    directory, a file system without hard links). None when running from source.

    A link left over from a previous version still points at the old binary's
    content after an update replaced librephotos.exe, so it is only trusted
    while it is the same file.
    """
    executable = standalone_executable()
    name = PROCESS_NAMES.get(role) if role is not None else None
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


def _has_console_window() -> bool:
    if sys.platform != "win32":
        return True
    import ctypes
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32")
    kernel32.GetConsoleWindow.restype = wintypes.HWND
    return bool(kernel32.GetConsoleWindow())


def _output_is_discarded() -> bool:
    """Started without a console and without redirection (a double-click from
    Explorer, or a child of such a process): the binary is a Windows GUI
    program, and Nuitka then binds stdout and stderr to NUL."""
    return getattr(sys.stdout, "name", None) in (None, "NUL:", "nul")


def _redirect_output(path: str, mode: str) -> None:
    stream = open(path, mode, encoding="utf-8", errors="replace", buffering=1)  # noqa: SIM115
    sys.stdout = sys.stderr = stream


def _repair_standard_handles() -> list[str]:
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
    # Windows-only: bootstrap_process calls this only on win32, so nothing was
    # repaired anywhere else.
    if sys.platform != "win32":
        return []
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

    repaired: list[str] = []
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


def _hide_child_consoles() -> None:
    """Start child processes without a console window of their own.

    A process that has no console gives every console program it starts a
    brand-new, visible one: ffmpeg, ffprobe, git and perl would each flash a
    black window over whatever the user is doing. There are a dozen call sites
    and some are in third-party code, so the default is changed once here
    rather than at each of them.
    """
    # Windows-only, and called only from bootstrap_process on win32.
    if sys.platform != "win32":
        return
    original = subprocess.Popen.__init__
    if getattr(original, "_no_console_window", False):
        return
    own_console = subprocess.CREATE_NEW_CONSOLE | subprocess.DETACHED_PROCESS

    def __init__(self: subprocess.Popen[Any], *args: Any, **kwargs: Any) -> None:
        flags = kwargs.get("creationflags", 0)
        if not flags & own_console:
            kwargs["creationflags"] = flags | subprocess.CREATE_NO_WINDOW
        original(self, *args, **kwargs)

    # setattr rather than assignment: this is a deliberate monkeypatch of
    # subprocess.Popen.__init__ and of a marker attribute on the replacement
    # function, which a type checker rejects as a plain assignment.
    setattr(__init__, "_no_console_window", True)
    setattr(subprocess.Popen, "__init__", __init__)


def bootstrap_process() -> None:
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


def install_root() -> str:
    """Where the distribution (or, from source, the backend) lives."""
    executable = standalone_executable()
    if executable is None:
        return BACKEND_ROOT
    return os.path.dirname(executable)


def default_data_dir() -> str:
    """Per-user application data directory, following each platform's habit."""
    home = os.path.expanduser("~")
    if sys.platform == "win32":
        base = os.environ.get("LOCALAPPDATA") or os.path.join(home, "AppData", "Local")
    elif sys.platform == "darwin":
        base = os.path.join(home, "Library", "Application Support")
    else:
        base = os.environ.get("XDG_DATA_HOME") or os.path.join(home, ".local", "share")
    return os.path.join(base, APP_DIR_NAME)


def apply_build_info(root: str) -> None:
    """Report the release this distribution was built as, like an image does.

    The version endpoint reads IMAGE_TAG and GIT_HASH, which only the Docker
    images set, and there is no .git to ask either, so a release zip said
    "dev". From source there is no file and nothing changes.
    """
    try:
        with open(os.path.join(root, BUILD_INFO_NAME), encoding="utf-8") as handle:
            info = json.load(handle)
    except (OSError, ValueError):
        return
    if not isinstance(info, dict):
        return
    for key, variable in (("version", "IMAGE_TAG"), ("git_hash", "GIT_HASH")):
        value = info.get(key)
        if value and isinstance(value, str):
            os.environ.setdefault(variable, value)


def prepare_environment(
    data_dir: str | None = None, photos_dir: str | None = None
) -> str:
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
    apply_build_info(root)
    bundled = [
        os.path.join(root, *parts)
        for parts in BUNDLED_BINARY_DIRS
        if os.path.isdir(os.path.join(root, *parts))
    ]
    if bundled:
        os.environ["PATH"] = os.pathsep.join([*bundled, os.environ.get("PATH", "")])
    return data


def run_manage(argv: list[str]) -> None:
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


def service_module_name(name: str) -> str:
    if name == "image_similarity":
        return "image_similarity.main"
    return f"service.{name}.main"


def run_service(name: str) -> None:
    """Run one sidecar in this process, as ``python service/<name>/main.py`` would.

    The sidecars are plain Flask scripts that import their siblings by bare
    name (``from openclip.openclip import ...``); scripts/build_standalone.py compiles
    those siblings as top-level modules so the imports resolve the same way.
    """
    module = importlib.import_module(service_module_name(name))
    module.serve()


def child_command(*args: str, role: str | None = None) -> list[str]:
    """argv that runs this program again with the given arguments, under the
    executable name of ``role`` (see PROCESS_NAMES) when compiled."""
    executable = named_executable(role)
    if executable is None:
        script = os.path.join(BACKEND_ROOT, "librephotos_standalone.py")
        return [sys.executable, script, *args]
    return [executable, *args]


# The job object of _take_children_down_with_us, once it holds this process.
_job_handles: list[int] = []
# JobObjectBasicProcessIdList; room for more processes than LibrePhotos starts.
_JOB_PROCESS_ID_LIST = 3
_JOB_PROCESS_ID_ROOM = 1024


def _job_process_ids() -> set[int] | None:
    """Every process in this instance's job, or None without one."""
    if sys.platform != "win32" or not _job_handles:
        return None
    import ctypes
    from ctypes import wintypes

    class JOBOBJECT_BASIC_PROCESS_ID_LIST(ctypes.Structure):
        _fields_ = [
            ("NumberOfAssignedProcesses", wintypes.DWORD),
            ("NumberOfProcessIdsInList", wintypes.DWORD),
            ("ProcessIdList", ctypes.c_size_t * _JOB_PROCESS_ID_ROOM),
        ]

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.QueryInformationJobObject.restype = wintypes.BOOL
    kernel32.QueryInformationJobObject.argtypes = [
        wintypes.HANDLE,
        ctypes.c_int,
        ctypes.c_void_p,
        wintypes.DWORD,
        ctypes.c_void_p,
    ]
    listing = JOBOBJECT_BASIC_PROCESS_ID_LIST()
    if not kernel32.QueryInformationJobObject(
        _job_handles[0],
        _JOB_PROCESS_ID_LIST,
        ctypes.byref(listing),
        ctypes.sizeof(listing),
        None,
    ):
        return None
    return {
        int(listing.ProcessIdList[index])
        for index in range(listing.NumberOfProcessIdsInList)
    }


def _take_children_down_with_us() -> None:
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
    else:
        # Kept for _job_process_ids: the job lists this instance's processes.
        _job_handles.append(job)
    # The handle is deliberately never closed: closing it is what kills the job.


def _already_running(url: str) -> bool:
    import requests

    try:
        return requests.get(f"{url}api/healthz", timeout=2).ok
    except requests.RequestException:
        return False


def _tray_image() -> Image.Image:
    from librephotos.tray import tray_image

    return tray_image(
        (
            os.path.join(install_root(), "frontend_build", "favicon.ico"),
            os.path.join(BACKEND_ROOT, os.pardir, "frontend", "public", "favicon.ico"),
        )
    )


# What the tray icon says while LibrePhotos starts (#2316): its tooltip and the
# first, greyed line of its menu.
STATUS_STARTING = "Starting..."
STATUS_DATABASE_UPDATE = "Updating the database ({done} of {total})"
STATUS_DATABASE_SETUP = "Setting up the database ({done} steps done)"
STATUS_SERVICES = "Starting services..."
STATUS_RUNNING = "Running at {url}"
STATUS_WAITING = "Waiting for LibrePhotos to finish starting..."
# Notifications, once each: (title, text).
NOTICE_UPDATE = (
    "Updating the database",
    "LibrePhotos is updating its database after the update. "
    "This can take a few minutes.",
)
NOTICE_SETUP = (
    "Setting up the database",
    "LibrePhotos is setting up its database. The first start takes a minute or two.",
)
NOTICE_ALREADY_STARTING = (
    "LibrePhotos is already starting",
    "It opens in your browser when it is ready.",
)
# How long a second start waits for the first one to answer, and how often it asks.
OTHER_INSTANCE_TIMEOUT_SECONDS = 600.0
_OTHER_INSTANCE_POLL_SECONDS = 2.0


class StartupCancelledError(Exception):
    """Quit was chosen in the tray while LibrePhotos was still starting."""


class Startup:
    """One start of LibrePhotos: its tray icon, the start-up page, the
    start-up child it waits for, the server once there is one, and whether
    Quit was chosen.

    The tray exists from the first second, so Quit has to work before there
    is a server to stop (#2316): it terminates the running migrate (or backup)
    child, and every later step checks ``check()`` before it begins.
    """

    def __init__(self) -> None:
        self.tray: Tray | None = None
        self.server: uvicorn.Server | None = None
        self.page: startup_page.StartupPage | None = None
        self.phase = startup_page.PhaseHolder()
        self._child: subprocess.Popen[str] | None = None
        self._cancelled = threading.Event()
        self._lock = threading.Lock()

    @property
    def cancelled(self) -> bool:
        return self._cancelled.is_set()

    def show_tray(self, url: str, status: str = STATUS_STARTING) -> None:
        """The notification area icon (Windows only; nothing elsewhere)."""
        if sys.platform != "win32" or self.tray is not None:
            return
        try:
            from librephotos.tray import Tray

            self.tray = Tray(
                url,
                _tray_image(),
                status,
                self.quit,
                (os.environ["BASE_DATA"], os.environ["BASE_LOGS"]),
            )
        except Exception as error:
            # pystray missing, no desktop session: LibrePhotos runs anyway.
            print(f"No notification area icon: {error!r}", flush=True)

    def show_page(self, host: str, port: int) -> None:
        """Answer on the server's port with the start-up page (#2310) until
        the server takes it over, so the browser can open on it at once."""
        try:
            self.page = startup_page.serve_in_thread(
                host,
                port,
                self.phase,
                serve_frontend=True,
                version=os.environ.get("IMAGE_TAG"),
            )
        except OSError as error:
            # Taken between check_port and here.
            raise StartupError(port_unavailable_message(port, error)) from error

    def close_page(self) -> None:
        """Free the port for the server."""
        if self.page is not None:
            self.page.stop()
            self.page = None

    def set_phase(self, status: str, reason_code: str | None = None) -> None:
        """What the start-up page says (startup_page.STATUSES)."""
        self.phase.set(status, reason_code)

    def status(self, text: str) -> None:
        print(f"LibrePhotos: {text}", flush=True)
        if self.tray is not None:
            self.tray.set_status(text)

    def notify(self, title: str, message: str) -> None:
        if self.tray is not None:
            self.tray.notify(title, message)

    def track(self, child: subprocess.Popen[str] | None) -> None:
        """The start-up child that Quit has to terminate, or None once it ended."""
        with self._lock:
            self._child = child
            if child is not None and self.cancelled:
                child.terminate()

    def quit(self) -> None:
        with self._lock:
            self._cancelled.set()
            if self._child is not None and self._child.poll() is None:
                self._child.terminate()
            if self.server is not None:
                self.server.should_exit = True

    def wait(self, seconds: float) -> bool:
        """Sleep up to ``seconds``; True when Quit was chosen meanwhile."""
        return self._cancelled.wait(seconds)

    def check(self) -> None:
        if self.cancelled:
            raise StartupCancelledError

    def close(self) -> None:
        self.close_page()
        if self.tray is not None:
            self.tray.stop()
            self.tray = None


class MigrationProgress:
    """Turns migrate's "Applying ..." lines into the tray status (#2316).

    ``total`` is the number of pending migrations the backup step reported, or
    None on a first start, which has no database to back up.
    """

    def __init__(self, startup: Startup, total: int | None) -> None:
        self.startup = startup
        self.total = total
        self.done = 0

    def __call__(self, line: str) -> None:
        if not line.lstrip().startswith("Applying "):
            return
        self.done += 1
        if self.done == 1:
            self.startup.set_phase(startup_page.UPDATING)
            self.startup.notify(*(NOTICE_UPDATE if self.total else NOTICE_SETUP))
        if self.total:
            done = min(self.done, self.total)
            self.startup.status(
                STATUS_DATABASE_UPDATE.format(done=done, total=self.total)
            )
        else:
            self.startup.status(STATUS_DATABASE_SETUP.format(done=self.done))


def _report_failure(message: str) -> None:
    """Say why the start failed. Without a console there is nowhere to read
    it, and an application that silently does nothing is the worst outcome."""
    print(message, flush=True)
    if sys.platform == "win32" and not _has_console_window():
        import ctypes

        logs = os.environ.get("BASE_LOGS", "")
        log = os.path.join(logs, CONSOLE_LOG_NAME)
        previous = os.path.join(logs, PREVIOUS_CONSOLE_LOG_NAME)
        ctypes.windll.user32.MessageBoxW(
            None,
            f"{message}\n\nDetails: {log}\nThe start before this one: {previous}",
            "LibrePhotos",
            0x10,
        )


# A line of Django's system check output naming one of LibrePhotos' own errors
# (api/checks.py): "?: (librephotos.E002) The database 'default' was ...".
_CHECK_ERROR_LINE = re.compile(r"\(librephotos\.E\d{3}\)\s*(.+)")
_COMMAND_ERROR_PREFIX = "CommandError: "
_HINT_PREFIX = "HINT:"
# How much of a start-up child's output is kept to explain its failure.
_FAILURE_TAIL_LINES = 200


class StartupError(Exception):
    """A start-up step failed. The message is the whole text for the user;
    ``reason_code`` is what the start-up page may say about it (#2310)."""

    def __init__(self, message: str, reason_code: str = startup_page.UNKNOWN) -> None:
        super().__init__(message)
        self.reason_code = reason_code


def failure_detail(lines: Sequence[str]) -> str | None:
    """Why a manage command failed, in its own plain words: the last
    librephotos.E0xx check error with its hint, or a CommandError's message."""
    for index in range(len(lines) - 1, -1, -1):
        line = lines[index].strip()
        match = _CHECK_ERROR_LINE.search(line)
        if match:
            following = lines[index + 1].strip() if index + 1 < len(lines) else ""
            hint = following[len(_HINT_PREFIX) :].strip()
            if not following.startswith(_HINT_PREFIX):
                hint = ""
            return f"{match.group(1)}\n\n{hint}".strip()
        if line.startswith(_COMMAND_ERROR_PREFIX):
            return line[len(_COMMAND_ERROR_PREFIX) :]
    return None


def run_teed(
    argv: list[str],
    startup: Startup | None = None,
    on_line: Callable[[str], None] | None = None,
) -> tuple[int, list[str]]:
    """Run a child with its output copied to ours line by line, as it comes.

    Returns its exit code and its last lines, which say why it failed. The
    output is still all there in the console or console.log; a child whose
    stdout is a pipe does not redirect itself (see bootstrap_process).
    ``startup`` can terminate the child (the tray's Quit); ``on_line`` sees
    each line as it comes.
    """
    tail: deque[str] = deque(maxlen=_FAILURE_TAIL_LINES)
    environment = {**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUNBUFFERED": "1"}
    with subprocess.Popen(
        argv,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        env=environment,
        text=True,
        encoding="utf-8",
        errors="replace",
    ) as process:
        if startup is not None:
            startup.track(process)
        try:
            for line in process.stdout or ():
                sys.stdout.write(line)
                tail.append(line.rstrip("\r\n"))
                if on_line is not None:
                    on_line(line)
            sys.stdout.flush()
        finally:
            if startup is not None:
                startup.track(None)
    return process.returncode, list(tail)


def run_startup_step(
    argv: list[str],
    failure: str,
    startup: Startup | None = None,
    on_line: Callable[[str], None] | None = None,
) -> list[str]:
    """Run ``manage <argv>`` in a child and return its last lines; raise
    StartupError saying why when it fails, StartupCancelledError after a Quit."""
    returncode, lines = run_teed(child_command("manage", *argv), startup, on_line)
    if startup is not None:
        startup.check()
    if returncode == 0:
        return lines
    detail = failure_detail(lines)
    raise StartupError(
        f"{failure}\n\n{detail}" if detail else failure,
        startup_page.reason_code(lines),
    )


def port_unavailable_message(port: int, error: OSError | None) -> str:
    """The message box text for a web server port LibrePhotos cannot listen on.

    Names the program holding it when the OS says (#2323): "port in use" alone
    leaves the user to find out which of their programs that is.
    """
    from api.runtime.ports import port_owner

    example = ALTERNATIVE_PORT if port != ALTERNATIVE_PORT else ALTERNATIVE_PORT + 1
    another_port = (
        "start LibrePhotos on another port, for example with "
        f'"librephotos.exe run --port {example}" (see "Using another port" in '
        "the LibrePhotos documentation for Windows)."
    )
    owner = port_owner(port)
    if owner is not None or error is None or error.errno == errno.EADDRINUSE:
        program = ""
        if owner is not None:
            name = owner.name or "unknown name"
            program = f" ({name}, process ID {owner.pid})"
        return (
            f"Port {port} is already used by another program{program}. "
            "LibrePhotos needs it to show its pages.\n\n"
            f"Close that program and start LibrePhotos again, or {another_port}"
        )
    return (
        f"LibrePhotos cannot use port {port}: {error.strerror or error}.\n\n"
        f"Windows keeps some ports for itself or for other programs; {another_port}"
    )


def check_port(host: str, port: int) -> None:
    """Raise StartupError when the web server could not listen on its port.

    Runs before anything else starts: uvicorn only finds out after the
    migrations, the sidecars and the job cluster, and then exits.
    """
    from api.runtime.ports import bind_error

    error = bind_error(host, port)
    if error is not None:
        raise StartupError(port_unavailable_message(port, error))


def check_sidecar_ports() -> None:
    """Raise StartupError when another program holds an enabled sidecar's port.

    A sidecar that cannot bind its port exits at once, and every photo of the
    next scan then misses what it does (thumbnails of RAW files, dates and
    places, faces, tags), with the reason only in console.log (#2324). This
    instance has not started any sidecar yet, so whatever listens there is
    someone else: another program, or a LibrePhotos with another data folder.
    Needs Django set up: whether a sidecar is enabled is a site setting.
    """
    from api.runtime.ports import bind_error, port_owner
    from api.runtime.sidecars import port_variable
    from api.runtime.supervisor import LOOPBACK, SERVICES, is_service_enabled

    blocked: list[str] = []
    first_variable = ""
    for service, port in SERVICES.items():
        if not is_service_enabled(service) or bind_error(LOOPBACK, port) is None:
            continue
        owner = port_owner(port)
        holder = "another program"
        if owner is not None:
            holder = f"{owner.name or 'unknown name'}, process ID {owner.pid}"
        blocked.append(f"Port {port} ({service}): {holder}")
        first_variable = first_variable or f"{port_variable(service)}={port + 10000}"
    if not blocked:
        return
    listing = "\n".join(blocked)
    raise StartupError(
        "Ports LibrePhotos needs for its background services are already used "
        f"by other programs:\n\n{listing}\n\n"
        "Close those programs and start LibrePhotos again, or move the services "
        f"to free ports, for example with {first_variable} (see "
        '"Using another port" in the LibrePhotos documentation for Windows).'
    )


def _set_console_title(title: str) -> None:
    if sys.platform == "win32":
        import ctypes

        ctypes.windll.kernel32.SetConsoleTitleW(title)


def run_server(
    host: str,
    port: int,
    open_browser: bool,
    tray: bool = True,
    startup: Startup | None = None,
) -> None:
    """migrate, start the sidecars, the job cluster and the API server.

    The cluster is a child process (django-q2 forks workers of its own) so
    that closing this one takes the whole application down with it. uvicorn
    runs in-process with a single worker: more would need multiprocessing
    spawn through the binary, and one worker with WEB_THREADS threads is
    enough for a desktop.

    The data folder's lock comes first (#2316): a second start from the same
    folder touches neither console.log, nor the database, nor any process,
    and only waits for the first one to answer.

    From the port check on, the start-up page answers on the port (#2310),
    so the browser opens at once and says "LibrePhotos is updating" (or why
    it failed) instead of waiting for the server.
    """
    import django

    startup = startup or Startup()
    shown_host = "localhost" if host in ("0.0.0.0", "::") else host
    url = f"http://{shown_host}:{port}/"
    data_dir = os.environ["BASE_DATA"]
    # Held until this process ends; the OS drops it then, however it ends.
    lock = instance_lock.acquire(data_dir, url)
    if lock is None:
        _wait_for_other_instance(data_dir, url, open_browser, tray, startup)
        return
    if _already_running(url):
        # LibrePhotos from another data folder on this port: show it instead
        # of failing on its port where nobody would see it.
        print(f"LibrePhotos is already running at {url}", flush=True)
        if open_browser:
            webbrowser.open(url)
        return

    _capture_console_output()
    # Something else answers on the port, or nothing does but the port is
    # still not ours to take (#2323): say so before doing any work.
    check_port(host, port)
    if tray:
        startup.show_tray(url)
    startup.show_page(host, port)
    if open_browser:
        webbrowser.open(url)
    _take_children_down_with_us()
    prepare_database(startup)
    startup.set_phase(startup_page.STARTING)
    startup.status(STATUS_SERVICES)
    django.setup()
    try:
        check_sidecar_ports()
        for command in STARTUP_COMMANDS:
            startup.check()
            run_manage(command)
        startup.check()
    except BaseException:
        # Sidecars a Quit or a failure left behind; the job object would
        # also take them down, but without letting them finish a request.
        _shutdown(None)
        raise

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
    startup.server = server
    _serve(server, cluster, url, startup)


def _wait_for_other_instance(
    data_dir: str, url: str, open_browser: bool, tray: bool, startup: Startup
) -> None:
    """Another process holds the data folder: wait for it to answer, then
    open the browser on it. Changes nothing on disk (#2316)."""
    other = instance_lock.holder_url(data_dir) or url
    print(f"LibrePhotos is already starting from {data_dir} at {other}", flush=True)
    if not _already_running(other):
        if tray:
            startup.show_tray(other, STATUS_WAITING)
        startup.notify(*NOTICE_ALREADY_STARTING)
        deadline = time.monotonic() + OTHER_INSTANCE_TIMEOUT_SECONDS
        while not _already_running(other):
            if time.monotonic() >= deadline:
                raise StartupError(
                    "LibrePhotos is already starting from this data folder, "
                    f"but it has not answered at {other} for "
                    f"{OTHER_INSTANCE_TIMEOUT_SECONDS / 60:.0f} minutes."
                )
            if startup.wait(_OTHER_INSTANCE_POLL_SECONDS):
                return
    if open_browser:
        webbrowser.open(other)


def _capture_console_output() -> None:
    """Without a console, send this process's output and its children's to
    console.log, keeping the previous start's as console.previous.log.

    Only the holder of the data folder's lock gets here, so no other start is
    still writing to the file it renames (#2316).
    """
    if standalone_executable() is not None and _output_is_discarded():
        logs = os.environ["BASE_LOGS"]
        console_log = os.path.join(logs, CONSOLE_LOG_NAME)
        try:
            os.replace(console_log, os.path.join(logs, PREVIOUS_CONSOLE_LOG_NAME))
        except OSError:
            # None yet (a first start), or still open somewhere: start over.
            pass
        _redirect_output(console_log, "w")
        os.environ[CONSOLE_LOG_ENV] = console_log


# The backup step's report when an update brings migrations
# (api.runtime.db_backup.backup_database).
_PENDING_MIGRATIONS = re.compile(r"before applying (\d+) pending migration")


def pending_migration_count(lines: Sequence[str]) -> int | None:
    """How many migrations the backup step said are pending, if it said."""
    for line in reversed(lines):
        match = _PENDING_MIGRATIONS.search(line)
        if match:
            return int(match.group(1))
    return None


def prepare_database(startup: Startup | None = None) -> None:
    """Back up the database when migrations are due, then migrate, each in a child.

    The backup (SQLite only, issue #2314) runs before any other process opens
    the database, and nothing is migrated without it.

    Migrate runs in a child before this process loads Django. On a first start
    the settings tables do not exist yet when api.apps.ready() reads the site
    settings, and in the compiled build that failed lookup leaves the
    constance config object unable to resolve any attribute for the rest of
    the process: every request then died with "'LazyConfig' object has no
    attribute ...". A process that only ever sees a migrated database never
    takes that path. A database a newer release migrated stops it with
    librephotos.E002 (issue #2315), which the message box then quotes.
    """
    startup = startup or Startup()
    lines = run_startup_step(
        ["backup_database", "--if-pending-migrations"],
        "LibrePhotos could not back up your database before updating it, "
        "so it did not start.",
        startup,
    )
    total = pending_migration_count(lines)
    if total:
        startup.set_phase(startup_page.UPDATING)
        startup.status(STATUS_DATABASE_UPDATE.format(done=0, total=total))
    run_startup_step(
        ["migrate", "--noinput"],
        "LibrePhotos could not update its database, so it did not start.",
        startup,
        MigrationProgress(startup, total),
    )


def _serve(
    server: uvicorn.Server,
    cluster: subprocess.Popen[bytes],
    url: str,
    startup: Startup,
) -> None:
    """Run the API server until it stops; then stop the rest.

    The start-up page gives the port up only now; the browser that opened on
    it reloads into the app once the server answers."""
    stopped = threading.Event()
    try:
        _set_console_title(f"LibrePhotos - {url} - close this window to stop")
        print(f"LibrePhotos is starting at {url}", flush=True)
        threading.Thread(
            target=_say_when_running,
            args=(server, url, startup, stopped),
            daemon=True,
        ).start()
        startup.close_page()
        try:
            server.run()
        except SystemExit:
            # uvicorn's answer to a port it cannot bind (#2323): sys.exit(3),
            # which main()'s "except Exception" would let through without
            # the message box. Only a start that never happened is ours.
            if server.started:
                raise
        if not server.started:
            raise _server_start_failure(server.config.host, server.config.port)
    finally:
        stopped.set()
        _shutdown(cluster)


def _say_when_running(
    server: uvicorn.Server, url: str, startup: Startup, stopped: threading.Event
) -> None:
    """Set the tray status to "Running" once uvicorn has started."""
    while not server.started:
        if stopped.wait(0.5) or startup.cancelled:
            return
    startup.status(STATUS_RUNNING.format(url=url))


def _server_start_failure(host: str, port: int) -> Exception:
    """Why the server did not start: its port, taken after check_port ran,
    or an error uvicorn has already logged."""
    from api.runtime.ports import bind_error

    error = bind_error(host, port)
    if error is not None:
        return StartupError(port_unavailable_message(port, error))
    return RuntimeError(f"The server could not start on {host}:{port}")


def _shutdown(cluster: subprocess.Popen[bytes] | None) -> None:
    """Stop this instance's sidecars and job cluster, and nobody else's.

    stop_service alone stops every process running a sidecar, whichever
    LibrePhotos started it (#2316): a second instance on its way out took the
    first one's sidecars down with it.
    """
    from api.runtime.supervisor import SERVICES, stop_service

    own = own_process_ids()
    for service in SERVICES:
        stop_service(service, only=own)
    if cluster is not None and cluster.poll() is None:
        cluster.terminate()
        try:
            cluster.wait(timeout=15)
        except subprocess.TimeoutExpired:
            cluster.kill()


def own_process_ids() -> set[int]:
    """The processes this instance started, directly or not.

    On Windows that is the job object of _take_children_down_with_us: it
    also holds a sidecar the watchdog restarted from a django-q worker that
    has exited since, which no longer descends from this process. Elsewhere,
    or without a job, this process's descendants.
    """
    pids = _job_process_ids()
    if pids is None:
        import psutil

        pids = {child.pid for child in psutil.Process().children(recursive=True)}
    pids.discard(os.getpid())
    return pids


def build_parser() -> argparse.ArgumentParser:
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


def parse_args(argv: list[str]) -> argparse.Namespace:
    """`librephotos.exe` and `librephotos.exe --data-dir X` both mean run."""
    argv = list(argv)
    if not any(arg in SUBCOMMANDS for arg in argv):
        argv.append("run")
    return build_parser().parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    prepare_environment(args.data_dir, args.photos)

    if args.command == "manage":
        run_manage(args.argv)
    elif args.command == "service":
        run_service(args.name)
    else:
        startup = Startup()
        try:
            run_server(
                args.host, args.port, not args.no_browser, not args.no_tray, startup
            )
        except StartupCancelledError:
            print("LibrePhotos was quit while it was starting", flush=True)
        except StartupError as error:
            # The child's own output, already in the console or console.log,
            # is the traceback; the message box gets the plain reason, and
            # the start-up page in the browser its reason code.
            startup.set_phase(startup_page.FAILED, error.reason_code)
            _report_failure(str(error))
            raise SystemExit(1) from error
        except Exception as error:
            import traceback

            traceback.print_exc()
            startup.set_phase(startup_page.FAILED)
            _report_failure(f"LibrePhotos could not start: {error}")
            raise SystemExit(1) from error
        finally:
            # After the message box: the icon and the failure page stay
            # while it is open.
            startup.close()


# Also at import, not only from the entry script: this module is imported in
# every process of the binary, whatever multiprocessing does with __main__, and
# the handles have to be in order before Django is imported. It does nothing
# from source or on other platforms, and every step of it is safe to repeat.
bootstrap_process()
