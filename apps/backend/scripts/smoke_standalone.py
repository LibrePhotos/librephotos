"""Smoke-test a standalone build by running it (#2319).

    python scripts/smoke_standalone.py <program folder or zip> [--tag 1.4.0]
    python scripts/smoke_standalone.py --from-source [--work-dir DIR]

Starts librephotos.exe the way a user's double-click does (``run``, minus the
browser and the tray icon) on a fresh data folder and free ports, then uses it:

1. waits up to ten minutes for /api/healthz/ready;
2. creates an admin with ``manage createadmin`` and logs in with a token;
3. checks that /api/imagetag reports ``--tag`` (the build_info.json the build wrote);
4. checks that every enabled sidecar answers, through the API and on its own
   port, and, for a compiled build, runs under its own process name;
5. scans three sample photos (deploy/e2e/photos) and waits for their thumbnails;
6. kills the root process the way Task Manager's End task does (no tree kill)
   and fails if any process of the build outlives it: that is the job object's
   promise in librephotos/standalone.py.

No ML model is downloaded: ``manage scan`` queues the import directly, and
every sidecar loads its model on first use.

The program can be the distribution folder (the one with librephotos.exe, or
its parent) or the release zip, which is extracted first, so CI tests the file
users download. ``--from-source`` runs librephotos_standalone.py with this
Python instead, to try the script without a three-hour Nuitka build; the
process-name check is skipped then. On failure the logs are printed; they stay
in <work dir>/data/logs for CI to upload.
"""

from __future__ import annotations

import argparse
import base64
import binascii
import json
import os
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import zipfile
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, TextIO, TypeVar

import psutil
import requests

BACKEND = Path(__file__).resolve().parents[1]
REPO = BACKEND.parents[1]
if str(BACKEND) not in sys.path:
    # Run as a script, sys.path[0] is scripts/; the names below come from the
    # same checkout the build was made from.
    sys.path.insert(0, str(BACKEND))

from api.runtime.sidecars import SERVICES, port_variable  # noqa: E402
from librephotos.standalone import PROCESS_NAMES  # noqa: E402

T = TypeVar("T")

EXECUTABLE = "librephotos.exe"
ENTRY_SCRIPT = BACKEND / "librephotos_standalone.py"
SAMPLE_PHOTOS = REPO / "deploy" / "e2e" / "photos"
SAMPLE_NAMES = ("e2e_01.jpg", "e2e_02.jpg", "e2e_03.jpg")
ADMIN_USERNAME = "smoke"
ADMIN_EMAIL = "smoke@example.invalid"

READY_TIMEOUT_SECONDS = 600.0
SERVICE_TIMEOUT_SECONDS = 120.0
THUMBNAIL_TIMEOUT_SECONDS = 300.0
EXIT_TIMEOUT_SECONDS = 30.0
POLL_SECONDS = 2.0
REQUEST_TIMEOUT_SECONDS = 30.0
LOG_TAIL_LINES = 200

# Sidecars that need neither a feature switch nor a model choice in the site
# settings (api.runtime.supervisor), so every build must start them. Checking
# only what /api/services says is enabled would pass a build that runs none.
ALWAYS_ON_SERVICES = ("exif", "image_similarity", "tags", "thumbnail")
# The processes besides the root and the sidecars, by role (PROCESS_NAMES).
CORE_ROLES = ("jobs", "worker")

# Variables that would point the build at another data folder, settings or
# release than the one under test, from whatever shell runs this script.
# IMAGE_TAG and GIT_HASH win over build_info.json (apply_build_info).
ISOLATED_VARIABLES = (
    "ADMIN_PASSWORD",
    "BASE_DATA",
    "BASE_LOGS",
    "DJANGO_SETTINGS_MODULE",
    "GIT_HASH",
    "IMAGE_TAG",
    "LIBREPHOTOS_CONSOLE_LOG",
    "PHOTOS",
    "SECRET_KEY",
)


class SmokeError(Exception):
    """A check failed; the message says which and what was seen."""


@dataclass(frozen=True)
class Layout:
    """Where one smoke run keeps its files, all under ``work``."""

    work: Path

    @property
    def data(self) -> Path:
        return self.work / "data"

    @property
    def logs(self) -> Path:
        return self.data / "logs"

    @property
    def photos(self) -> Path:
        return self.work / "photos"

    @property
    def library(self) -> Path:
        return self.photos / "library"

    @property
    def run_log(self) -> Path:
        return self.logs / "smoke-run.log"

    def create(self) -> None:
        for directory in (self.logs, self.library):
            directory.mkdir(parents=True, exist_ok=True)


def program_folder(path: Path, work: Path) -> Path:
    """The folder holding librephotos.exe: ``path`` itself, its ``librephotos``
    subfolder, or that folder inside the zip ``path``, extracted into ``work``."""
    if path.suffix.lower() == ".zip":
        if not path.is_file():
            raise SmokeError(f"no zip at {path}")
        target = work / "program"
        with zipfile.ZipFile(path) as bundle:
            bundle.extractall(target)
        path = target
    for candidate in (path, path / "librephotos"):
        if (candidate / EXECUTABLE).is_file():
            return candidate.resolve()
    raise SmokeError(f"no {EXECUTABLE} in {path} or {path / 'librephotos'}")


def free_ports(count: int) -> list[int]:
    """``count`` distinct ports nothing listens on right now."""
    sockets: list[socket.socket] = []
    try:
        for _ in range(count):
            probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            probe.bind(("127.0.0.1", 0))
            sockets.append(probe)
        return [probe.getsockname()[1] for probe in sockets]
    finally:
        for probe in sockets:
            probe.close()


def app_environment(
    base: Mapping[str, str], ports: Mapping[str, int]
) -> dict[str, str]:
    """The build's environment: ``base`` without ISOLATED_VARIABLES, every
    sidecar on the port ``ports`` gives it, and one job worker."""
    environment = {
        key: value
        for key, value in base.items()
        if key.upper() not in ISOLATED_VARIABLES
        and not key.upper().startswith("SIDECAR_PORT_")
    }
    for service, port in ports.items():
        environment[port_variable(service)] = str(port)
    environment["WORKER_CONCURRENCY"] = "1"
    environment["PYTHONIOENCODING"] = "utf-8"
    return environment


def token_user_id(token: str) -> int:
    """The user_id claim of a JWT access token (the server writes it as a string)."""
    try:
        payload = token.split(".")[1]
        claims = json.loads(
            base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4))
        )
        return int(claims["user_id"])
    except (IndexError, KeyError, TypeError, ValueError, binascii.Error) as error:
        raise SmokeError(
            f"the access token has no usable user_id: {error!r}"
        ) from error


def wait_until(
    check: Callable[[], T | None],
    timeout: float,
    what: str,
    still_running: Callable[[], bool] | None = None,
) -> T:
    """Call ``check`` until it returns something truthy and return that.

    Fails after ``timeout`` seconds, or at once when ``still_running`` says
    the program under test has exited.
    """
    deadline = time.monotonic() + timeout
    while True:
        result = check()
        if result:
            return result
        if still_running is not None and not still_running():
            raise SmokeError(f"LibrePhotos exited while waiting for {what}")
        if time.monotonic() >= deadline:
            raise SmokeError(f"timed out after {timeout:.0f} s waiting for {what}")
        time.sleep(POLL_SECONDS)


def hidden_console() -> dict[str, Any]:
    """Popen arguments that give the root a console window nobody sees.

    Without a console, a failed start explains itself in a message box
    (standalone._report_failure), which nobody closes on a CI runner: the run
    would hang until the timeout instead of failing with the reason in the log.
    """
    if sys.platform != "win32":
        return {}
    startupinfo = subprocess.STARTUPINFO()
    startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    startupinfo.wShowWindow = subprocess.SW_HIDE
    return {"creationflags": subprocess.CREATE_NEW_CONSOLE, "startupinfo": startupinfo}


class App:
    """The program under test: its command line, environment and root process."""

    def __init__(
        self, launcher: Sequence[str], layout: Layout, environment: Mapping[str, str]
    ) -> None:
        self.launcher = list(launcher)
        self.layout = layout
        self.environment = dict(environment)
        self.process: subprocess.Popen[bytes] | None = None
        self._log: TextIO | None = None

    def command(self, *args: str) -> list[str]:
        return [
            *self.launcher,
            "--data-dir",
            str(self.layout.data),
            "--photos",
            str(self.layout.photos),
            *args,
        ]

    def start(self, port: int) -> None:
        # The output goes to a file, as a double-click's goes to console.log.
        self._log = open(self.layout.run_log, "w", encoding="utf-8")  # noqa: SIM115
        self.process = subprocess.Popen(
            self.command("run", "--no-browser", "--no-tray", "--port", str(port)),
            stdout=self._log,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            env=self.environment,
            **hidden_console(),
        )

    def running(self) -> bool:
        return self.process is not None and self.process.poll() is None

    def manage(self, *args: str, extra: Mapping[str, str] | None = None) -> str:
        """Run ``manage <args>`` against the same data folder; return its output."""
        completed = subprocess.run(
            self.command("manage", *args),
            capture_output=True,
            check=False,
            text=True,
            encoding="utf-8",
            errors="replace",
            env={**self.environment, **(extra or {})},
            stdin=subprocess.DEVNULL,
            timeout=READY_TIMEOUT_SECONDS,
        )
        output = completed.stdout + completed.stderr
        if completed.returncode != 0:
            raise SmokeError(
                f"manage {' '.join(args)} exited with {completed.returncode}:\n{output}"
            )
        return output

    def close_log(self) -> None:
        if self._log is not None:
            self._log.close()
            self._log = None


class Api:
    """requests against the running server, with the admin's token once there is one."""

    def __init__(self, base_url: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.session = requests.Session()

    def authenticate(self, token: str) -> None:
        self.session.headers["Authorization"] = f"Bearer {token}"

    def request(self, method: str, path: str, **kwargs: Any) -> requests.Response:
        kwargs.setdefault("timeout", REQUEST_TIMEOUT_SECONDS)
        return self.session.request(method, f"{self.base_url}{path}", **kwargs)

    def json(self, method: str, path: str, **kwargs: Any) -> object:
        """The JSON body of a 2xx answer; anything else fails the smoke test."""
        response = self.request(method, path, **kwargs)
        if not response.ok:
            raise SmokeError(
                f"{method} {path} answered {response.status_code}: {response.text[:500]}"
            )
        return response.json()

    def answers(self, path: str) -> bool:
        """Whether ``path`` answers 200; a refused connection is a no."""
        try:
            return self.request("GET", path, timeout=5).status_code == 200
        except requests.RequestException:
            return False


def step(title: str) -> None:
    print(f"smoke: {title}", flush=True)


def wait_ready(app: App, api: Api) -> None:
    step("waiting for /api/healthz/ready")
    wait_until(
        lambda: api.answers("/api/healthz/ready/"),
        READY_TIMEOUT_SECONDS,
        "/api/healthz/ready",
        app.running,
    )


def log_in(app: App, api: Api) -> int:
    """Create the admin from the environment, as the e2e seed does, and log in.
    Returns the admin's user id."""
    step("creating the admin and logging in")
    password = secrets.token_urlsafe(24)
    app.manage(
        "createadmin", ADMIN_USERNAME, ADMIN_EMAIL, extra={"ADMIN_PASSWORD": password}
    )
    body = api.json(
        "POST",
        "/api/auth/token/obtain/",
        json={"username": ADMIN_USERNAME, "password": password},
    )
    token = body.get("access") if isinstance(body, dict) else None
    if not isinstance(token, str):
        raise SmokeError(f"the login returned no access token: {body!r}")
    api.authenticate(token)
    return token_user_id(token)


def check_tag(api: Api, tag: str | None) -> None:
    body = api.json("GET", "/api/imagetag/")
    if not isinstance(body, dict):
        raise SmokeError(f"/api/imagetag answered {body!r}")
    reported = body.get("image_tag")
    step(f"/api/imagetag reports {reported!r}, commit {body.get('git_hash')!r}")
    if tag is not None and reported != tag:
        raise SmokeError(f"/api/imagetag reports {reported!r}, expected {tag!r}")


def service_state(api: Api, service: str) -> dict[str, Any]:
    body = api.json("GET", f"/api/services/{service}/")
    if not isinstance(body, dict):
        raise SmokeError(f"/api/services/{service}/ answered {body!r}")
    return body


def sidecar_identity(port: int) -> str | None:
    """The ``service`` a sidecar's own /health names, or None when nothing
    (or something else) answers on ``port``."""
    try:
        response = requests.get(f"http://127.0.0.1:{port}/health", timeout=5)
        body = response.json() if response.status_code == 200 else None
    except (requests.RequestException, ValueError):
        return None
    service = body.get("service") if isinstance(body, dict) else None
    return service if isinstance(service, str) else None


def enabled_services(api: Api) -> list[str]:
    """The sidecars the build says it runs; fails when one of the always-on
    ones is not among them."""
    body = api.json("GET", "/api/services/")
    listed = body.get("services") if isinstance(body, dict) else None
    if not isinstance(listed, dict):
        raise SmokeError(f"/api/services/ answered {body!r}")
    enabled = [name for name in listed if service_state(api, name).get("enabled")]
    missing = [name for name in ALWAYS_ON_SERVICES if name not in enabled]
    if missing:
        raise SmokeError(f"sidecars that must always run are not enabled: {missing}")
    return enabled


def check_service(
    api: Api, service: str, port: int, still_running: Callable[[], bool]
) -> None:
    def healthy() -> bool:
        state = service_state(api, service)
        return bool(state.get("healthy")) and sidecar_identity(port) == service

    wait_until(
        healthy,
        SERVICE_TIMEOUT_SECONDS,
        f"the {service} sidecar on port {port}",
        still_running,
    )


def check_services(app: App, api: Api, ports: Mapping[str, int]) -> list[str]:
    services = enabled_services(api)
    step(f"checking the sidecars: {', '.join(services)}")
    for service in services:
        check_service(api, service, ports[service], app.running)
    return services


def expected_process_names(services: Iterable[str]) -> set[str]:
    roles = [*CORE_ROLES, *services]
    return {EXECUTABLE} | {
        f"{PROCESS_NAMES[role]}.exe" for role in roles if role in PROCESS_NAMES
    }


def processes_in(folder: Path) -> list[psutil.Process]:
    """Every running process whose executable lies in ``folder``."""
    wanted = os.path.normcase(str(folder))
    found = []
    for process in psutil.process_iter(["exe"]):
        exe = process.info.get("exe")
        if exe and os.path.normcase(os.path.dirname(exe)) == wanted:
            found.append(process)
    return found


def process_names(processes: Iterable[psutil.Process]) -> set[str]:
    names = set()
    for process in processes:
        try:
            names.add(process.name().lower())
        except psutil.Error:
            continue
    return names


def check_process_names(program: Path, services: Iterable[str]) -> None:
    expected = expected_process_names(services)
    seen = process_names(processes_in(program))
    step(f"processes running from {program}: {', '.join(sorted(seen))}")
    missing = sorted(expected - seen)
    if missing:
        raise SmokeError(f"processes not running under their own name: {missing}")


def thumbnailed_photos(api: Api, expected: int) -> list[dict[str, Any]] | None:
    """The recently added photos once at least ``expected`` have a thumbnail
    (the list leaves out photos without one)."""
    body = api.json("GET", "/api/photos/recentlyadded/")
    results = body.get("results") if isinstance(body, dict) else None
    if isinstance(results, list) and len(results) >= expected:
        return results
    return None


def scan_samples(app: App, api: Api, user_id: int) -> None:
    step("scanning the sample photos")
    for name in SAMPLE_NAMES:
        shutil.copy(SAMPLE_PHOTOS / name, app.layout.library / name)
    api.json(
        "PATCH",
        f"/api/manage/user/{user_id}/",
        json={"scan_directory": str(app.layout.library)},
    )
    app.manage("scan")
    photos = wait_until(
        lambda: thumbnailed_photos(api, len(SAMPLE_NAMES)),
        THUMBNAIL_TIMEOUT_SECONDS,
        f"thumbnails of {len(SAMPLE_NAMES)} photos",
        app.running,
    )
    for photo in photos:
        path = f"/media/thumbnails_big/{photo['image_hash']}"
        response = api.request("GET", path)
        content_type = response.headers.get("Content-Type", "")
        if response.status_code != 200 or not content_type.startswith("image/"):
            raise SmokeError(
                f"GET {path} answered {response.status_code} {content_type}"
            )


def descendants(process: psutil.Process) -> list[psutil.Process]:
    try:
        return process.children(recursive=True)
    except psutil.Error:
        return []


def alive(processes: Iterable[psutil.Process]) -> list[psutil.Process]:
    survivors = []
    for process in processes:
        try:
            if process.is_running() and process.status() != psutil.STATUS_ZOMBIE:
                survivors.append(process)
        except psutil.Error:
            continue
    return survivors


def describe(processes: Iterable[psutil.Process]) -> str:
    parts = []
    for process in processes:
        try:
            parts.append(f"{process.name()} (PID {process.pid})")
        except psutil.Error:
            parts.append(f"PID {process.pid}")
    return ", ".join(parts)


def kill_root(app: App, program: Path | None) -> list[psutil.Process]:
    """Kill only the root process and return what is left of the instance
    after EXIT_TIMEOUT_SECONDS: its former descendants and, for a compiled
    build, any process still running from the program folder."""
    if app.process is None:
        return []
    root = psutil.Process(app.process.pid)
    tracked = descendants(root)
    # TerminateProcess on Windows, as Task Manager's End task: no tree kill.
    app.process.kill()
    app.process.wait(timeout=EXIT_TIMEOUT_SECONDS)

    def gone() -> bool:
        return not alive(tracked) and not (program and processes_in(program))

    try:
        wait_until(gone, EXIT_TIMEOUT_SECONDS, "the other processes to exit")
    except SmokeError:
        return alive([*tracked, *(processes_in(program) if program else [])])
    return []


def kill_all(processes: Iterable[psutil.Process]) -> None:
    for process in processes:
        try:
            process.kill()
        except psutil.Error:
            continue


def check_shutdown(app: App, program: Path | None) -> None:
    step("killing the root process")
    leftovers = kill_root(app, program)
    if leftovers:
        kill_all(leftovers)
        raise SmokeError(
            f"still running after the root was killed: {describe(leftovers)}"
        )


def tail(path: Path, lines: int = LOG_TAIL_LINES) -> str:
    try:
        content = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError as error:
        return f"(cannot read: {error})"
    return "\n".join(content[-lines:])


def dump_logs(logs: Path, out: TextIO = sys.stdout) -> None:
    """Print the end of every log, one collapsible group each in GitHub Actions."""
    for path in sorted(logs.glob("*.log")):
        out.write(f"::group::{path.name}\n{tail(path)}\n::endgroup::\n")
    out.flush()


def clean_up(app: App) -> None:
    """Take down whatever a failed run left behind, so the logs can be read
    and uploaded and the next step does not trip over the ports."""
    if app.process is not None and app.process.poll() is None:
        try:
            tracked = descendants(psutil.Process(app.process.pid))
        except psutil.Error:
            tracked = []
        app.process.kill()
        app.process.wait(timeout=EXIT_TIMEOUT_SECONDS)
        kill_all(tracked)
    app.close_log()


def run_checks(app: App, program: Path | None, tag: str | None) -> None:
    web_port, *sidecar_ports = free_ports(1 + len(SERVICES))
    ports = dict(zip(SERVICES, sidecar_ports, strict=True))
    api = Api(f"http://127.0.0.1:{web_port}")
    app.environment = app_environment(app.environment, ports)
    step(f"starting {' '.join(app.command('run'))} on port {web_port}")
    app.start(web_port)
    wait_ready(app, api)
    user_id = log_in(app, api)
    check_tag(api, tag)
    services = check_services(app, api, ports)
    if program is not None:
        check_process_names(program, services)
    scan_samples(app, api, user_id)
    check_shutdown(app, program)


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument(
        "program",
        nargs="?",
        type=Path,
        help="the build's folder (with librephotos.exe) or its zip",
    )
    parser.add_argument("--tag", help="the release /api/imagetag must report")
    parser.add_argument(
        "--work-dir",
        type=Path,
        help="where the data folder and photos go (default: a new temporary folder)",
    )
    parser.add_argument(
        "--from-source",
        action="store_true",
        help="run librephotos_standalone.py with this Python instead of a build",
    )
    args = parser.parse_args(argv)
    if (args.program is None) == (not args.from_source):
        parser.error("give either a program folder or zip, or --from-source")
    return args


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    layout = Layout(
        (args.work_dir or Path(tempfile.mkdtemp(prefix="librephotos-smoke-"))).resolve()
    )
    layout.create()
    program: Path | None = None
    if args.from_source:
        launcher = [sys.executable, str(ENTRY_SCRIPT)]
    else:
        program = program_folder(args.program.resolve(), layout.work)
        launcher = [str(program / EXECUTABLE)]
    app = App(launcher, layout, dict(os.environ))
    try:
        run_checks(app, program, args.tag)
    except (
        SmokeError,
        OSError,
        requests.RequestException,
        subprocess.SubprocessError,
    ) as error:
        clean_up(app)
        dump_logs(layout.logs)
        print(f"smoke: FAILED: {error}", file=sys.stderr, flush=True)
        return 1
    finally:
        # Also after anything unexpected, so no process outlives the step.
        clean_up(app)
    print(f"smoke: passed (logs in {layout.logs})", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
