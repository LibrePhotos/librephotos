from __future__ import annotations

import argparse
import datetime
import functools
import http.server
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import zipfile
from collections.abc import Callable, Iterator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import psutil
import requests

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from build_installer import build as build_setup
from build_installer import find_iscc
from build_standalone import write_checksums
from smoke_standalone import (
    ADMIN_EMAIL,
    ADMIN_USERNAME,
    EXECUTABLE,
    Api,
    App,
    Layout,
    SmokeError,
    app_environment,
    dump_logs,
    free_ports,
    kill_all,
    processes_in,
    program_folder,
    scan_samples,
    step,
    thumbnailed_photos,
    token_user_id,
    wait_until,
)

from api.runtime.sidecars import SERVICES
from librephotos.installation import (
    MOVE_RECORD_NAME,
    SETUP_NAME,
    SETUP_SWITCHES,
    UNINSTALL_KEY,
)

ZIP_NAME = "librephotos-windows-x64.zip"
CHECKSUMS_NAME = "SHA256SUMS"
UPDATE_MARKER = ".librephotos-update.json"
FEED_PATH = "releases/download"
INSTALL_TIMEOUT_SECONDS = 1200.0
READY_TIMEOUT_SECONDS = 1500.0
DOWNLOAD_TIMEOUT_SECONDS = 900.0
EXIT_TIMEOUT_SECONDS = 120.0
UNINSTALL_TIMEOUT_SECONDS = 600.0
FORWARD_TIMEOUT_SECONDS = 120.0
OFFER_ATTEMPTS = 12
RUN_KEY = "Software\\Microsoft\\Windows\\CurrentVersion\\Run"
SCENARIOS = ("fresh", "update", "uninstall", "migrate")


def local_appdata() -> Path:
    return Path(os.environ["LOCALAPPDATA"])


def install_dir() -> Path:
    return local_appdata() / "Programs" / "LibrePhotos"


def installed_program() -> Path:
    return install_dir() / "librephotos"


def start_menu_shortcut() -> Path:
    return (
        Path(os.environ["APPDATA"])
        / "Microsoft"
        / "Windows"
        / "Start Menu"
        / "Programs"
        / "LibrePhotos.lnk"
    )


def desktop_shortcut() -> Path:
    return Path(os.environ["USERPROFILE"]) / "Desktop" / "LibrePhotos.lnk"


def uninstall_value(name: str) -> object:
    import winreg

    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, UNINSTALL_KEY) as key:
            return winreg.QueryValueEx(key, name)[0]
    except OSError:
        return None


def machine_wide_entry() -> bool:
    import winreg

    try:
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, UNINSTALL_KEY):
            return True
    except OSError:
        return False


def autostart_value() -> object:
    import winreg

    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY) as key:
            return winreg.QueryValueEx(key, "LibrePhotos")[0]
    except OSError:
        return None


def shortcut(path: Path) -> tuple[str, str]:
    quoted = str(path).replace("'", "''")
    script = (
        "$s = (New-Object -ComObject WScript.Shell).CreateShortcut('"
        + quoted
        + "'); $s.TargetPath; $s.Arguments"
    )
    completed = subprocess.run(
        ["powershell", "-NoProfile", "-NonInteractive", "-Command", script],
        capture_output=True,
        text=True,
        check=True,
    )
    lines = [*completed.stdout.splitlines(), "", ""]
    return lines[0].strip(), lines[1].strip()


def check(condition: object, message: str) -> None:
    if not condition:
        raise SmokeError(message)


def release_version(program: Path) -> str:
    info = json.loads((program / "build_info.json").read_text(encoding="utf-8"))
    return str(info.get("version") or "")


def stamp(dist: Path, version: str, target: Path) -> Path:
    program = target / "librephotos"
    if program.exists():
        shutil.rmtree(program)
    shutil.copytree(dist, program)
    info_path = program / "build_info.json"
    info = json.loads(info_path.read_text(encoding="utf-8"))
    info["version"] = version
    info_path.write_text(json.dumps(info), encoding="utf-8")
    return program


def zip_program(program: Path, target: Path) -> Path:
    with zipfile.ZipFile(target, "w", zipfile.ZIP_STORED) as archive:
        for path in sorted(program.rglob("*")):
            name = (Path("librephotos") / path.relative_to(program)).as_posix()
            archive.write(path, name + "/" if path.is_dir() else name)
    return target


@dataclass(frozen=True)
class Feed:
    root: Path

    def folder(self, version: str) -> Path:
        folder = self.root / FEED_PATH / version
        folder.mkdir(parents=True, exist_ok=True)
        return folder


def publish(
    feed: Feed, dist: Path, version: str, iscc: Path | None, work: Path
) -> Path:
    step(f"preparing release {version} in the local feed")
    folder = feed.folder(version)
    program = stamp(dist, version, work / "stamped" / version)
    zip_program(program, folder / ZIP_NAME)
    assets = [folder / ZIP_NAME]
    if iscc is not None:
        setups = build_setup(program, folder, version, "lzma2/fast", iscc)
        assets.append(setups[0])
    write_checksums(assets, folder / CHECKSUMS_NAME)
    shutil.rmtree(work / "stamped" / version, ignore_errors=True)
    return folder


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, message_format: str, *args: Any) -> None:
        return


class RenewingApi(Api):
    def __init__(self, base_url: str) -> None:
        super().__init__(base_url)
        self.renew: Callable[[], object] | None = None

    def request(self, method: str, path: str, **kwargs: Any) -> requests.Response:
        response = super().request(method, path, **kwargs)
        if response.status_code == 401 and self.renew is not None:
            self.renew()
            response = super().request(method, path, **kwargs)
        return response


@contextmanager
def serve(feed: Feed) -> Iterator[str]:
    handler = functools.partial(QuietHandler, directory=str(feed.root))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}/{FEED_PATH}"
    finally:
        server.shutdown()


def run_setup(setup: Path, log: Path, *extra: str) -> None:
    command = [str(setup), *SETUP_SWITCHES, f"/LOG={log}", *extra]
    step(f"installing: {' '.join(command)}")
    completed = subprocess.run(command, timeout=INSTALL_TIMEOUT_SECONDS, check=False)
    check(completed.returncode == 0, f"Setup exited with {completed.returncode}")


def check_per_user(setup: Path) -> None:
    check(
        b'level="asInvoker"' in setup.read_bytes(),
        f"{setup.name} asks for administrator rights (no asInvoker manifest)",
    )


def check_installed(version: str, where: str = "") -> None:
    program = installed_program()
    step(f"checking the installation in {install_dir()}")
    check((program / EXECUTABLE).is_file(), f"no {program / EXECUTABLE}")
    check((install_dir() / "unins000.exe").is_file(), "no uninstaller")
    check(release_version(program) == version, f"{program} is not {version}")
    values = {
        name: uninstall_value(name)
        for name in (
            "DisplayName",
            "DisplayVersion",
            "Publisher",
            "DisplayIcon",
            "InstallLocation",
            "UninstallString",
            "QuietUninstallString",
        )
    }
    step(f"uninstall entry: {values}")
    check(values["DisplayVersion"] == version, f"DisplayVersion is not {version}")
    check(values["DisplayName"] == "LibrePhotos", "DisplayName is not LibrePhotos")
    check(values["Publisher"] == "LibrePhotos", "Publisher is not LibrePhotos")
    check(
        str(values["DisplayIcon"]).lower().endswith("librephotos.exe"),
        "DisplayIcon is not librephotos.exe",
    )
    check(
        os.path.normcase(str(values["InstallLocation"]).rstrip("\\"))
        == os.path.normcase(str(install_dir())),
        "InstallLocation is not the install folder",
    )
    check(values["QuietUninstallString"], "no QuietUninstallString")
    check(not machine_wide_entry(), "an uninstall entry for all users was written")
    check_shortcut(program, where)
    check(autostart_value() is None, "autostart is on although nobody chose it")
    check(not desktop_shortcut().exists(), "a desktop shortcut nobody chose")


def check_shortcut(program: Path, where: str) -> None:
    path = start_menu_shortcut()
    check(path.is_file(), f"no Start menu shortcut at {path}")
    target, arguments = shortcut(path)
    step(f"Start menu shortcut: {target} {arguments}")
    check(
        os.path.normcase(target) == os.path.normcase(str(program / EXECUTABLE)),
        f"the shortcut starts {target}",
    )
    check(where in arguments, f"the shortcut's arguments miss {where!r}")


@dataclass
class Instance:
    layout: Layout
    environment: dict[str, str]
    port: int
    password: str = ""
    api: RenewingApi = field(init=False)

    def __post_init__(self) -> None:
        self.api = RenewingApi(f"http://127.0.0.1:{self.port}")

    def app(self, program: Path) -> App:
        return App([str(program / EXECUTABLE)], self.layout, self.environment)

    def log_in(self) -> int:
        self.api.renew = None
        body = self.api.json(
            "POST",
            "/api/auth/token/obtain/",
            json={"username": ADMIN_USERNAME, "password": self.password},
        )
        self.api.renew = self.log_in
        token = body.get("access") if isinstance(body, dict) else None
        if not isinstance(token, str):
            raise SmokeError(f"the login returned no access token: {body!r}")
        self.api.authenticate(token)
        return token_user_id(token)

    def create_admin(self, app: App) -> int:
        self.password = "Smoke-" + os.urandom(12).hex()
        app.manage(
            "createadmin",
            ADMIN_USERNAME,
            ADMIN_EMAIL,
            extra={"ADMIN_PASSWORD": self.password},
        )
        return self.log_in()

    def ready(self) -> bool:
        return self.api.answers("/api/healthz/ready/")

    def wait_ready(self, still_running: Callable[[], bool] | None = None) -> None:
        wait_until(
            self.ready, READY_TIMEOUT_SECONDS, "/api/healthz/ready", still_running
        )

    def updates(self) -> dict[str, Any]:
        body = self.api.json("GET", "/api/updates/")
        check(isinstance(body, dict), f"/api/updates/ answered {body!r}")
        return body if isinstance(body, dict) else {}

    def tag(self) -> str:
        body = self.api.json("GET", "/api/imagetag/")
        return str(body.get("image_tag")) if isinstance(body, dict) else ""

    def photos(self) -> list[str]:
        found = thumbnailed_photos(self.api, 1) or []
        return sorted(str(photo["image_hash"]) for photo in found)

    def users(self) -> list[str]:
        body = self.api.json("GET", "/api/user/")
        results = body.get("results") if isinstance(body, dict) else body
        check(isinstance(results, list), f"/api/user/ answered {body!r}")
        rows = results if isinstance(results, list) else []
        return sorted(str(user["username"]) for user in rows)


def offer_release(app: App, instance: Instance, version: str) -> dict[str, Any]:
    stamp_now = datetime.datetime.now(datetime.UTC).isoformat()
    result = json.dumps(
        {
            "checked_at": stamp_now,
            "latest": version,
            "release_url": f"https://github.com/LibrePhotos/librephotos/releases/tag/{version}",
            "published_at": stamp_now,
            "error": None,
        }
    )
    code = (
        "from constance import config; config.UPDATE_CHECK = True; "
        f"config.UPDATE_CHECK_RESULT = {result!r}"
    )
    for attempt in range(OFFER_ATTEMPTS):
        app.manage("shell", "-c", code)
        time.sleep(3)
        status = instance.updates()
        if status.get("latest") == version and status.get("update_available"):
            return status
        step(f"the update check answered {status.get('latest')!r}; again ({attempt})")
        time.sleep(10)
    raise SmokeError(f"the server never offered {version}")


def install_state(instance: Instance) -> dict[str, Any]:
    install = instance.updates().get("install")
    check(isinstance(install, dict), "the status has no install part")
    return install if isinstance(install, dict) else {}


def wait_prepared(instance: Instance, kind: str) -> dict[str, Any]:
    def prepared() -> dict[str, Any] | None:
        install = install_state(instance)
        if install.get("state") == "failed":
            raise SmokeError(f"the download failed: {install.get('error')}")
        if install.get("state") == "ready" and install.get("kind", "update") == kind:
            return install
        return None

    return wait_until(prepared, DOWNLOAD_TIMEOUT_SECONDS, f"the {kind} download")


def restart(instance: Instance) -> None:
    response = instance.api.request(
        "POST", "/api/updates/restart/", json={"force": True}
    )
    check(response.status_code == 202, f"restart answered {response.status_code}")


def wait_for_release(instance: Instance, version: str, folder: Path) -> None:
    def running() -> bool:
        if not instance.ready():
            return False
        try:
            instance.log_in()
            return instance.tag() == version and bool(root_in(folder))
        except SmokeError, requests.RequestException:
            return False

    wait_until(running, READY_TIMEOUT_SECONDS, f"{version} running from {folder}")


def root_in(folder: Path) -> list[psutil.Process]:
    roots = []
    for process in processes_in(folder):
        try:
            if process.name().lower() == EXECUTABLE:
                roots.append(process)
        except psutil.Error:
            continue
    return roots


def stop_from(folder: Path) -> None:
    for root in root_in(folder):
        try:
            root.kill()
        except psutil.Error:
            continue
    wait_until(
        lambda: not processes_in(folder),
        EXIT_TIMEOUT_SECONDS,
        f"every process from {folder} to exit",
    )


def ports_environment(base: dict[str, str], source: str) -> tuple[dict[str, str], int]:
    web_port, *sidecar_ports = free_ports(1 + len(SERVICES))
    environment = app_environment(base, dict(zip(SERVICES, sidecar_ports, strict=True)))
    environment["UPDATE_RELEASE_SOURCE"] = source
    return environment, web_port


def fresh_install(context: Context) -> None:
    setup = context.feed.folder(context.version) / SETUP_NAME.format(
        version=context.version
    )
    check_per_user(setup)
    run_setup(setup, context.logs / "setup-fresh.log")
    check_installed(context.version)
    layout = Layout(context.work / "fresh")
    layout.create()
    environment, port = ports_environment(dict(os.environ), context.source)
    instance = Instance(layout, environment, port)
    app = instance.app(installed_program())
    step(f"starting the installed LibrePhotos on port {port}")
    app.start(port)
    instance.wait_ready(app.running)
    user_id = instance.create_admin(app)
    check(instance.tag() == context.version, "the installed copy is not the release")
    status = instance.updates()
    check(
        status["install"].get("layout") == "installed",
        f"the installed copy says {status['install']}",
    )
    scan_samples(app, instance.api, user_id)
    check(len(instance.photos()) >= 3, "the scanned photos are missing")
    context.fresh = (instance, app)


def update_in_place(context: Context) -> None:
    instance, app = context.fresh_instance()
    step(f"updating the installed copy to {context.next_version}")
    offer_release(app, instance, context.next_version)
    response = instance.api.request(
        "POST", "/api/updates/install/", json={"version": context.next_version}
    )
    check(response.status_code == 202, f"install answered {response.status_code}")
    wait_prepared(instance, "update")
    photos = instance.photos()
    restart(instance)
    wait_for_release(instance, context.next_version, installed_program())
    app.close_log()
    check(instance.photos() == photos, "the photos changed with the update")
    check_installed(context.next_version)
    rollback = install_dir() / "librephotos-old"
    check(release_version(rollback) == context.version, "no rollback folder")
    step(f"rollback in {rollback}: {release_version(rollback)}")
    stop_from(installed_program())


def running_librephotos() -> list[str]:
    found = []
    for process in psutil.process_iter(["name", "exe", "ppid"]):
        name = str(process.info.get("name") or "").lower()
        if name.startswith("librephotos"):
            found.append(f"{process.pid} {name} {process.info.get('exe')}")
    return found


def processes_under(folder: Path) -> list[psutil.Process]:
    prefix = os.path.normcase(str(folder)) + os.sep
    found = []
    for process in psutil.process_iter(["exe"]):
        exe = process.info.get("exe")
        if exe and os.path.normcase(exe).startswith(prefix):
            found.append(process)
    return found


def uninstall(context: Context, data: Path) -> None:
    for folder in (installed_program(), install_dir() / "librephotos-old"):
        if folder.exists():
            stop_from(folder)
    wait_until(
        lambda: not processes_under(install_dir()),
        EXIT_TIMEOUT_SECONDS,
        "the update's finisher to exit",
    )
    step(f"running LibrePhotos processes: {running_librephotos()}")
    uninstaller = install_dir() / "unins000.exe"
    check(uninstaller.is_file(), "no uninstaller")
    command = [
        str(uninstaller),
        *SETUP_SWITCHES[:3],
        f"/LOG={context.logs / 'uninstall.log'}",
    ]
    step(f"uninstalling: {' '.join(command)}")
    subprocess.run(command, timeout=UNINSTALL_TIMEOUT_SECONDS, check=False)
    wait_until(
        lambda: (
            uninstall_value("DisplayName") is None
            and not any(install_dir().glob("librephotos*"))
            and not uninstaller.exists()
        ),
        UNINSTALL_TIMEOUT_SECONDS,
        "the uninstaller to finish",
    )
    check(not start_menu_shortcut().exists(), "the Start menu shortcut is left")
    check(autostart_value() is None, "the autostart entry is left")
    check(not install_dir().exists(), f"{install_dir()} is left")
    check((data / "db").is_dir(), f"the data folder {data} was deleted")
    step(f"uninstalled; the data folder {data} is kept")


def stage_for_old_release(program: Path, feed_folder: Path, version: str) -> Path:
    staged = program.parent / f"librephotos-{version}"
    with zipfile.ZipFile(feed_folder / ZIP_NAME) as archive:
        archive.extractall(program.parent / "staging")
    (program.parent / "staging" / "librephotos").rename(staged)
    shutil.rmtree(program.parent / "staging")
    marker = {"version": version, "sha256": "", "signed": False}
    (staged / UPDATE_MARKER).write_text(json.dumps(marker), encoding="utf-8")
    return staged


@dataclass(frozen=True)
class ZipCopy:
    layout: Layout
    app_dir: Path
    instance: Instance
    photos: list[str]
    users: list[str]

    @property
    def program(self) -> Path:
        return self.app_dir / "librephotos"


def start_previous_release(context: Context) -> ZipCopy:
    layout = Layout(context.work / "migrate")
    layout.create()
    app_dir = context.work / "migrate" / "app"
    app_dir.mkdir()
    check(context.previous_zip is not None, "migrate needs --previous-zip")
    with zipfile.ZipFile(context.previous_zip or "") as archive:
        archive.extractall(app_dir)
    program = app_dir / "librephotos"
    environment, port = ports_environment(dict(os.environ), context.source)
    instance = Instance(layout, environment, port)
    old_app = instance.app(program)
    step(f"starting {release_version(program)} from {program} on port {port}")
    old_app.start(port)
    instance.wait_ready(old_app.running)
    user_id = instance.create_admin(old_app)
    scan_samples(old_app, instance.api, user_id)
    copy = ZipCopy(layout, app_dir, instance, instance.photos(), instance.users())
    step(f"it has {len(copy.photos)} photos and the users {copy.users}")
    stage_for_old_release(
        program, context.feed.folder(context.version), context.version
    )
    offer_release(old_app, instance, context.version)
    wait_prepared(instance, "update")
    step(f"Restart to update to {context.version}, by the release that runs")
    restart(instance)
    wait_for_release(instance, context.version, program)
    old_app.close_log()
    return copy


def check_zip_update(copy: ZipCopy) -> None:
    check(
        (copy.app_dir / "librephotos-old" / EXECUTABLE).is_file(), "no librephotos-old"
    )
    backups = sorted((copy.layout.data / "db" / "backups").glob("*"))
    step(f"database backups: {[path.name for path in backups]}")
    check(backups, "no database backup before the migrations")
    install = install_state(copy.instance)
    step(f"the zip copy says {install}")
    check(install.get("layout") == "portable", "the zip copy is not portable")
    check(install.get("move_supported"), f"no move offered: {install}")


def move_to_installed(context: Context, copy: ZipCopy) -> None:
    instance = copy.instance
    step("Move to the installed version")
    response = instance.api.request("POST", "/api/updates/move/")
    check(response.status_code == 202, f"move answered {response.status_code}")
    wait_prepared(instance, "move")
    restart(instance)
    wait_for_release(instance, context.version, installed_program())
    wait_until(
        lambda: not processes_in(copy.program),
        EXIT_TIMEOUT_SECONDS,
        "the move's finisher to exit",
    )


def check_moved(context: Context, copy: ZipCopy) -> None:
    instance, data = copy.instance, copy.layout.data
    check(install_state(instance).get("layout") == "installed", "not installed")
    check(instance.photos() == copy.photos, "the photos differ after the move")
    check(instance.users() == copy.users, "the users differ after the move")
    check_installed(context.version, where=f'--data-dir "{data}"')
    root = root_in(installed_program())[0]
    check(str(data) in root.cmdline(), "the installed copy has another data folder")
    for folder in (copy.program, copy.app_dir / "librephotos-old"):
        check((folder / EXECUTABLE).is_file(), f"{folder} was not kept")
        check(not processes_in(folder), f"something still runs from {folder}")
    check((data / MOVE_RECORD_NAME).is_file(), "no move record")
    check(not (data / "updates").exists(), "the installer was not deleted")


def migrate(context: Context) -> None:
    copy = start_previous_release(context)
    check_zip_update(copy)
    move_to_installed(context, copy)
    check_moved(context, copy)
    check_forwarding(copy.instance, copy.program, copy.instance.port)
    stop_from(installed_program())
    uninstall(context, copy.layout.data)


def check_forwarding(instance: Instance, zip_program_dir: Path, port: int) -> None:
    step("the old zip copy hands a start over to the installed version")
    forwarded = instance.app(zip_program_dir)
    forwarded.start(port)
    process = forwarded.process
    check(process is not None, "the old copy did not start")
    if process is not None:
        code = process.wait(FORWARD_TIMEOUT_SECONDS)
        check(code == 0, f"the old copy exited with {code}")
    forwarded.close_log()
    check(not processes_in(zip_program_dir), "the old copy kept running")
    check(instance.ready(), "the installed copy stopped")


@dataclass
class Context:
    work: Path
    logs: Path
    feed: Feed
    source: str
    version: str
    next_version: str
    previous_zip: Path | None
    fresh: tuple[Instance, App] | None = None

    def fresh_instance(self) -> tuple[Instance, App]:
        if self.fresh is None:
            raise SmokeError("the fresh install did not run")
        return self.fresh


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Install, update, migrate to and uninstall the Windows installer"
    )
    parser.add_argument("dist", type=Path, help="the build's librephotos folder or zip")
    parser.add_argument("--previous-zip", type=Path, help="a published release's zip")
    parser.add_argument("--work-dir", type=Path)
    parser.add_argument("--iscc", help="path of ISCC.exe")
    parser.add_argument("--version", default="98.0.0")
    parser.add_argument("--next-version", default="98.0.1")
    parser.add_argument(
        "--scenarios", default=",".join(SCENARIOS), help="comma separated, in order"
    )
    return parser.parse_args(argv)


def run(context: Context, scenarios: Sequence[str], dist: Path, iscc: Path) -> None:
    publish(context.feed, dist, context.version, iscc, context.work)
    if "update" in scenarios:
        publish(context.feed, dist, context.next_version, None, context.work)
    if "fresh" in scenarios:
        fresh_install(context)
    if "update" in scenarios:
        update_in_place(context)
    if "uninstall" in scenarios:
        uninstall(context, Layout(context.work / "fresh").data)
    if "migrate" in scenarios:
        migrate(context)


def clean_up(work: Path) -> None:
    folders = [installed_program(), install_dir() / "librephotos-old"]
    folders += [path for path in work.glob("*/app/*") if path.is_dir()]
    for folder in folders:
        kill_all(processes_in(folder))


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    if isinstance(sys.stdout, io.TextIOWrapper):
        sys.stdout.reconfigure(errors="replace")
    work = (
        args.work_dir or Path(tempfile.mkdtemp(prefix="librephotos-installer-"))
    ).resolve()
    logs = work / "logs"
    logs.mkdir(parents=True, exist_ok=True)
    feed = Feed(work / "feed")
    scenarios = [name for name in args.scenarios.split(",") if name]
    with serve(feed) as source:
        context = Context(
            work,
            logs,
            feed,
            source,
            args.version,
            args.next_version,
            args.previous_zip.resolve() if args.previous_zip else None,
        )
        try:
            dist = program_folder(args.dist.resolve(), work)
            run(context, scenarios, dist, find_iscc(args.iscc))
        except (
            SmokeError,
            OSError,
            requests.RequestException,
            subprocess.SubprocessError,
        ) as error:
            for folder in work.glob("*/data/logs"):
                dump_logs(folder)
            dump_logs(logs)
            print(f"installer smoke: FAILED: {error}", file=sys.stderr, flush=True)
            return 1
        finally:
            clean_up(work)
    print(f"installer smoke: passed (logs in {work})", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
