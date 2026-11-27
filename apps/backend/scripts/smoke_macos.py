from __future__ import annotations

import argparse
import contextlib
import functools
import http.server
import json
import os
import plistlib
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
from collections.abc import Callable, Iterator, Sequence
from dataclasses import dataclass, field
from pathlib import Path

import psutil
import requests

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from build_standalone import sha256_of, write_checksums
from macos_bundle import (
    AD_HOC,
    Signing,
    make_dmg,
    sign_app,
    stamp,
    write_entitlements,
    zip_app,
)
from smoke_installer import (
    Feed,
    Instance,
    QuietHandler,
    check,
    install_state,
    offer_release,
    restart,
    wait_prepared,
)
from smoke_standalone import (
    ADMIN_USERNAME,
    SAMPLE_NAMES,
    App,
    Layout,
    SmokeError,
    app_environment,
    check_migrations,
    check_perceptual_hash,
    check_service,
    describe,
    dump_logs,
    enabled_services,
    scan_samples,
    step,
    wait_until,
)

from api.runtime.sidecars import SERVICES
from librephotos import login_item, release_layout

LAYOUT = release_layout.MACOS_ARM64
APPLICATIONS = Path("/Applications")
APP = APPLICATIONS / release_layout.APP_BUNDLE
ROLLBACK = APP.with_name(APP.name + "-old")
PORT = 8000
URL = f"http://127.0.0.1:{PORT}/"
VERSION = "98.0.0"
NEXT_VERSION = "98.0.1"
READY_TIMEOUT_SECONDS = 1500.0
EXIT_TIMEOUT_SECONDS = 120.0
ORPHAN_TIMEOUT_SECONDS = 90.0
FINISH_TIMEOUT_SECONDS = 600.0
UPDATE_TIMEOUT_SECONDS = 600.0
SERVICE_TIMEOUT_SECONDS = 180.0
SCENARIOS = ("fresh", "update", "autostart", "quit", "uninstall", "cask")
CASK_TEMPLATE = SCRIPTS.parents[2] / "deploy" / "homebrew" / "librephotos-server.rb"
TAP = "librephotos/smoke"


def home() -> Path:
    return Path.home()


def data_folder() -> Path:
    return home() / "Library" / "Application Support" / "LibrePhotos"


def agent_path() -> Path:
    return login_item.agent_path(home())


def launcher(app: Path = APP) -> Path:
    return LAYOUT.launcher(app)


def binary(app: Path = APP) -> Path:
    return LAYOUT.binary(app)


def release_version(app: Path) -> str:
    info = json.loads(LAYOUT.build_info(app).read_text(encoding="utf-8"))
    return str(info.get("version") or "")


def run_tool(command: Sequence[str | Path], timeout: float = 600.0) -> str:
    printable = " ".join(str(part) for part in command)
    completed = subprocess.run(
        [str(part) for part in command],
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )
    output = completed.stdout + completed.stderr
    if completed.returncode != 0:
        raise SmokeError(f"{printable} exited with {completed.returncode}:\n{output}")
    return output


def codesign_verify(app: Path) -> None:
    run_tool(["codesign", "--verify", "--deep", "--strict", "--verbose=2", app])
    step(f"codesign --verify --deep --strict: {app} is valid")


@dataclass(frozen=True)
class InstalledLayout(Layout):
    @property
    def data(self) -> Path:
        return data_folder()

    @property
    def logs(self) -> Path:
        return data_folder() / "logs"

    @property
    def photos(self) -> Path:
        return home()

    @property
    def library(self) -> Path:
        return self.work / "library"

    @property
    def run_log(self) -> Path:
        return self.work / "logs" / "smoke-run.log"

    def create(self) -> None:
        for directory in (self.work / "logs", self.library):
            directory.mkdir(parents=True, exist_ok=True)


def from_app(process: psutil.Process, app: Path) -> bool:
    try:
        exe = process.exe()
    except psutil.Error:
        return False
    return os.path.realpath(exe) == os.path.realpath(binary(app))


def app_processes(app: Path = APP) -> list[psutil.Process]:
    return [process for process in psutil.process_iter() if from_app(process, app)]


def roots(app: Path = APP) -> list[psutil.Process]:
    found = app_processes(app)
    pids = {process.pid for process in found}
    result = []
    for process in found:
        try:
            if process.ppid() not in pids:
                result.append(process)
        except psutil.Error:
            continue
    return result


class OpenedApp(App):
    def running(self) -> bool:
        return bool(roots())

    def open(self, environment: dict[str, str] | None = None) -> None:
        command = ["/usr/bin/open", "-a", str(APP)]
        for key, value in (environment or {}).items():
            command += ["--env", f"{key}={value}"]
        step(f"opening {APP} the way Finder does: {' '.join(command)}")
        run_tool(command, timeout=60)
        wait_until(roots, 60, f"{APP.name} to start")


def send_quit_event() -> tuple[int, str]:
    script = (
        "with timeout of 60 seconds\n"
        f'tell application id "{release_layout.BUNDLE_ID}" to quit\n'
        "end timeout"
    )
    try:
        completed = subprocess.run(
            ["osascript", "-e", script],
            capture_output=True,
            text=True,
            timeout=90,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return 124, "osascript got no answer in 90 s"
    return completed.returncode, completed.stderr.strip()


@dataclass
class Context:
    work: Path
    dmg: Path
    screenshots: Path
    feed: Feed
    source: str
    layout: InstalledLayout = field(init=False)
    instance: Instance = field(init=False)
    app: OpenedApp = field(init=False)
    versioned_dmg: Path | None = None

    def __post_init__(self) -> None:
        self.layout = InstalledLayout(self.work)
        self.layout.create()
        environment = app_environment(os.environ, {})
        self.instance = Instance(self.layout, environment, PORT)
        self.app = OpenedApp([str(launcher())], self.layout, environment)

    @property
    def logs(self) -> Path:
        return self.work / "logs"


class LoopbackServer(http.server.ThreadingHTTPServer):
    def server_bind(self) -> None:
        self.socket.bind(self.server_address)
        self.server_address = self.socket.getsockname()
        self.server_name = "localhost"
        self.server_port = self.server_address[1]


@contextlib.contextmanager
def serve(feed: Feed) -> Iterator[str]:
    handler = functools.partial(QuietHandler, directory=str(feed.root))
    server = LoopbackServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}/releases/download"
    finally:
        server.shutdown()


@contextlib.contextmanager
def mounted(dmg: Path, mountpoint: Path) -> Iterator[Path]:
    mountpoint.mkdir(parents=True, exist_ok=True)
    run_tool(
        ["hdiutil", "attach", "-nobrowse", "-readonly", "-mountpoint", mountpoint, dmg]
    )
    try:
        yield mountpoint
    finally:
        for attempt in range(5):
            try:
                run_tool(["hdiutil", "detach", mountpoint], timeout=120)
                break
            except SmokeError:
                if attempt == 4:
                    raise
                time.sleep(5)


def check_disk_image(volume: Path) -> Path:
    app = volume / release_layout.APP_BUNDLE
    check(app.is_dir(), f"no {app.name} on the disk image")
    applications = volume / "Applications"
    check(
        applications.is_symlink() and os.readlink(applications) == "/Applications",
        "the disk image has no Applications shortcut to drag the app onto",
    )
    codesign_verify(app)
    return app


def stamped_copy(base: Path, version: str, target: Path, signing: Signing) -> Path:
    app = target / release_layout.APP_BUNDLE
    if target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True)
    run_tool(["ditto", base, app])
    stamp(app, version)
    sign_app(app, signing)
    return app


def prepare_releases(context: Context) -> None:
    step(f"checking {context.dmg.name}, the disk image the build made")
    base = context.work / "base" / release_layout.APP_BUNDLE
    with mounted(context.dmg, context.work / "mnt-build") as volume:
        app = check_disk_image(volume)
        base.parent.mkdir(parents=True, exist_ok=True)
        run_tool(["ditto", app, base])
    signing = Signing(
        AD_HOC, None, write_entitlements(context.work / "entitlements.plist")
    )
    step(
        f"making release {VERSION} as a disk image and {NEXT_VERSION} in the local feed"
    )
    first = stamped_copy(base, VERSION, context.work / "stamped" / VERSION, signing)
    context.versioned_dmg = make_dmg(
        first, context.work / f"LibrePhotos-Server-{VERSION}-macos-arm64.dmg", signing
    )
    second = stamped_copy(
        base, NEXT_VERSION, context.work / "stamped" / NEXT_VERSION, signing
    )
    folder = context.feed.folder(NEXT_VERSION)
    archive = zip_app(second, folder / LAYOUT.archive_name)
    write_checksums([archive], folder / LAYOUT.checksums_name)
    shutil.rmtree(context.work / "stamped", ignore_errors=True)


def install_from_disk_image(dmg: Path, mountpoint: Path) -> None:
    step(f"installing {APP.name} from {dmg.name} into {APPLICATIONS}")
    with mounted(dmg, mountpoint) as volume:
        app = check_disk_image(volume)
        run_tool(["ditto", app, APP])
    check(binary().is_file(), f"no {binary()}")
    codesign_verify(APP)


def wait_ready(context: Context) -> None:
    wait_until(
        context.instance.ready,
        READY_TIMEOUT_SECONDS,
        "/api/healthz/ready",
        context.app.running,
    )


def check_data_folder() -> None:
    data = data_folder()
    step(f"checking the data folder {data}")
    check((data / "db").is_dir(), f"no database folder in {data}")
    check(
        (data / "logs" / "console.log").is_file(), "no console.log in the data folder"
    )
    found = sorted(path.name for path in data.iterdir())
    step(f"the data folder holds {found}")
    check(not (binary().parent / "db").exists(), "the database is inside the app")


def check_root_started_by_launch_services() -> psutil.Process:
    found = roots()
    check(
        len(found) == 1,
        f"expected one LibrePhotos root process, found {describe(found)}",
    )
    root = found[0]
    step(f"the root process {root.pid} runs {root.exe()} with {root.cmdline()[1:]}")
    check(root.ppid() == 1, "the root process was not started by launchd")
    return root


def check_sidecars(context: Context) -> list[str]:
    services = enabled_services(context.instance.api)
    step(f"checking the sidecars: {', '.join(services)}")
    for service in services:
        check_service(
            context.instance.api, service, SERVICES[service], context.app.running
        )
    off = sorted(set(SERVICES) - set(services))
    step(f"sidecars that are off until their feature is switched on: {off}")
    return services


def screenshot(context: Context, name: str) -> Path:
    target = context.screenshots / f"{name}.png"
    run_tool(["screencapture", "-x", target], timeout=60)
    step(f"screenshot {target}")
    return target


def crop_menu_bar(full: Path, target: Path) -> None:
    from PIL import Image

    with Image.open(full) as image:
        width, height = image.size
        bar = max(48, height // 28)
        image.crop((width // 2, 0, width, bar)).save(target)


def browser_screenshots(context: Context) -> None:
    from playwright.sync_api import Error as PlaywrightError

    try:
        take_browser_screenshots(context)
    except (PlaywrightError, SmokeError, OSError) as error:
        step(f"no browser screenshot: {error!r}")


def take_browser_screenshots(context: Context) -> None:
    from playwright.sync_api import sync_playwright

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=False)
        page = browser.new_page(viewport={"width": 1280, "height": 760})
        page.goto(URL, wait_until="networkidle")
        page.get_by_label("Username").fill(ADMIN_USERNAME)
        page.locator('input[type="password"]').fill(context.instance.password)
        page.get_by_role("button", name="Sign in").click()
        page.wait_for_url(lambda url: "/login" not in url, timeout=60000)
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(5000)
        page.screenshot(path=str(context.screenshots / "web-ui.png"))
        full = screenshot(context, "desktop")
        crop_menu_bar(full, context.screenshots / "menu-bar.png")
        browser.close()


def fresh_install(context: Context) -> None:
    check(not APP.exists(), f"{APP} exists already: this is not a fresh Mac")
    check(not data_folder().exists(), f"{data_folder()} exists already")
    check(context.versioned_dmg is not None, "no disk image to install from")
    install_from_disk_image(context.versioned_dmg or context.dmg, context.work / "mnt")
    context.app.open(
        {"UPDATE_RELEASE_SOURCE": context.source, "WORKER_CONCURRENCY": "1"}
    )
    wait_ready(context)
    check_root_started_by_launch_services()
    check_data_folder()
    check_migrations(context.app)
    user_id = context.instance.create_admin(context.app)
    check(context.instance.tag() == VERSION, f"the app does not report {VERSION}")
    install = install_state(context.instance)
    step(f"the updater says {install}")
    check(install.get("supported") is True, f"the updater is off: {install}")
    check(install.get("move_supported") is False, "a move is offered on a Mac")
    check_sidecars(context)
    check_perceptual_hash(context.app)
    scan_samples(context.app, context.instance.api, user_id)
    check(
        len(context.instance.photos()) >= len(SAMPLE_NAMES),
        "the scanned photos are missing from the API",
    )
    step(f"the API lists {len(context.instance.photos())} photos with thumbnails")
    browser_screenshots(context)
    codesign_verify(APP)
    check(not agent_path().exists(), "the login item is on although nobody chose it")


def update_log() -> str:
    try:
        return (data_folder() / "logs" / "update.log").read_text(encoding="utf-8")
    except OSError:
        return ""


def update_in_place(context: Context) -> None:
    instance = context.instance
    step(f"updating {APP.name} to {NEXT_VERSION} through the built-in updater")
    offer_release(context.app, instance, NEXT_VERSION)
    response = instance.api.request(
        "POST", "/api/updates/install/", json={"version": NEXT_VERSION}
    )
    check(response.status_code == 202, f"install answered {response.status_code}")
    wait_prepared(instance, "update")
    staged = APP.with_name(f"{APP.name}-{NEXT_VERSION}")
    check(binary(staged).is_file(), f"the update was not prepared in {staged}")
    check(LAYOUT.marker(staged).is_file(), "the prepared update has no marker")
    codesign_verify(staged)
    photos = instance.photos()
    old_roots = {process.pid for process in roots()}
    restart(instance)

    seen = [0]

    def report_progress() -> None:
        log = update_log()
        if len(log) > seen[0]:
            step(f"update.log: {log[seen[0] :].strip()}")
            seen[0] = len(log)

    def running_next() -> bool:
        report_progress()
        if not instance.ready():
            return False
        try:
            instance.log_in()
            current = {process.pid for process in roots()}
            return instance.tag() == NEXT_VERSION and bool(current - old_roots)
        except SmokeError, requests.RequestException:
            return False

    wait_until(
        running_next, UPDATE_TIMEOUT_SECONDS, f"{NEXT_VERSION} running from {APP}"
    )
    wait_until(
        lambda: "the update is done" in update_log(),
        FINISH_TIMEOUT_SECONDS,
        "the finisher to finish",
    )
    step(f"update.log:\n{update_log()}")
    wait_until(lambda: len(roots()) == 1, EXIT_TIMEOUT_SECONDS, "the finisher to exit")
    check(release_version(APP) == NEXT_VERSION, f"{APP} is not {NEXT_VERSION}")
    check(release_version(ROLLBACK) == VERSION, f"{ROLLBACK} is not {VERSION}")
    check(not staged.exists(), f"{staged} is still there")
    check(not LAYOUT.marker(staged).exists(), "the update marker is still there")
    codesign_verify(APP)
    codesign_verify(ROLLBACK)
    check(instance.photos() == photos, "the photos changed with the update")
    check_root_started_by_launch_services()
    check(
        not [
            process for process in psutil.process_iter() if from_app(process, ROLLBACK)
        ],
        "something still runs from the rollback folder",
    )
    step(f"{APP} is {NEXT_VERSION}; {ROLLBACK} keeps {VERSION} as the way back")


def start_at_login(*args: str) -> str:
    return run_tool([launcher(), "start-at-login", *args], timeout=60).strip()


def autostart(context: Context) -> None:
    step("Open at Login: off by default, then on, loaded by launchd, then off")
    check(start_at_login("status").endswith("off"), "the login item is on by default")
    start_at_login("on")
    agent = agent_path()
    check(agent.is_file(), f"no {agent}")
    run_tool(["plutil", "-lint", agent])
    with open(agent, "rb") as handle:
        plist = plistlib.load(handle)
    step(f"{agent}: {plist}")
    check(plist.get("Label") == release_layout.BUNDLE_ID, "wrong label")
    check(plist.get("RunAtLoad") is True, "the login item does not run at load")
    arguments = plist.get("ProgramArguments")
    check(
        arguments
        == ["/usr/bin/open", "-g", "-a", str(APP), "--args", "run", "--no-browser"],
        f"the login item starts {arguments}",
    )
    check(start_at_login("status").endswith("on"), "status does not say on")
    domain = f"gui/{os.getuid()}"
    run_tool(["launchctl", "bootstrap", domain, agent])
    printed = run_tool(["launchctl", "print", f"{domain}/{release_layout.BUNDLE_ID}"])
    check("/usr/bin/open" in printed, "launchd does not know the login item")
    time.sleep(10)
    check(
        len(roots()) == 1,
        f"the login item started a second instance: {describe(roots())}",
    )
    check(
        context.instance.ready(), "LibrePhotos stopped when launchd ran the login item"
    )
    start_at_login("off")
    check(not agent.exists(), f"{agent} is still there")
    gone = subprocess.run(
        ["launchctl", "print", f"{domain}/{release_layout.BUNDLE_ID}"],
        capture_output=True,
        check=False,
    )
    check(gone.returncode != 0, "launchd still has the login item")
    check(start_at_login("status").endswith("off"), "status does not say off")


def wait_all_gone(timeout: float, what: str) -> None:
    wait_until(lambda: not app_processes(), timeout, what)


def quit_scenario(context: Context) -> None:
    step("quitting with SIGTERM, as launchctl and the uninstaller do")
    root = check_root_started_by_launch_services()
    children = root.children(recursive=True)
    step(f"the instance runs {len(children) + 1} processes")
    os.kill(root.pid, signal.SIGTERM)
    wait_all_gone(
        EXIT_TIMEOUT_SECONDS, "every process of the app to exit after SIGTERM"
    )
    check(not context.instance.ready(), "the server still answers")
    console = (data_folder() / "logs" / "console.log").read_text(
        encoding="utf-8", errors="replace"
    )
    check(
        "Shutting down" in console or "Finished server process" in console,
        "uvicorn did not shut down cleanly",
    )
    step("quitting through Apple Events, as the menu bar's Quit and a logout do")
    context.app.open()
    wait_ready(context)
    quit_code, quit_error = send_quit_event()
    step(f"osascript quit: exit {quit_code} {quit_error}")
    try:
        wait_all_gone(
            EXIT_TIMEOUT_SECONDS, "every process to exit after the quit event"
        )
        step("the quit Apple Event stopped every process")
    except SmokeError:
        check(
            quit_code != 0,
            "the quit event was delivered but the app kept running",
        )
        step("this runner refused the Apple Event; SIGTERM ends the instance instead")
        for process in roots():
            os.kill(process.pid, signal.SIGTERM)
        wait_all_gone(EXIT_TIMEOUT_SECONDS, "every process to exit after SIGTERM")
    step("killing the root process with SIGKILL: its children must follow")
    context.app.open()
    wait_ready(context)
    root = check_root_started_by_launch_services()
    os.kill(root.pid, signal.SIGKILL)
    wait_all_gone(
        ORPHAN_TIMEOUT_SECONDS,
        "the sidecars and workers to exit after the root was killed",
    )
    step("no process outlived the killed root")


def uninstall(context: Context) -> None:
    step("uninstalling with the script in the app")
    context.app.open()
    wait_ready(context)
    start_at_login("on")
    script = APP / "Contents" / "Resources" / "uninstall.sh"
    check(script.is_file(), f"no {script}")
    keep = context.work / "uninstall.sh"
    shutil.copy(script, keep)
    output = run_tool([script], timeout=300)
    step(output.strip())
    check(not app_processes(), "LibrePhotos still runs after the uninstall")
    check(not APP.exists(), f"{APP} is still there")
    check(not ROLLBACK.exists(), f"{ROLLBACK} is still there")
    check(not agent_path().exists(), "the login item is still there")
    check((data_folder() / "db").is_dir(), "the uninstall deleted the library")
    step(f"uninstalled; the library in {data_folder()} is kept")


def write_cask(tap: Path, dmg: Path) -> Path:
    text = CASK_TEMPLATE.read_text(encoding="utf-8")
    text = text.replace('version "0.0.0"', f'version "{VERSION}"', 1)
    text = text.replace("sha256 :no_check", f'sha256 "{sha256_of(dmg)}"', 1)
    lines = [
        f'  url "file://{dmg}"' if line.startswith('  url "') else line
        for line in text.splitlines()
    ]
    text = "\n".join(lines) + "\n"
    casks = tap / "Casks"
    casks.mkdir(parents=True, exist_ok=True)
    target = casks / CASK_TEMPLATE.name
    target.write_text(text, encoding="utf-8")
    return target


def brew(*args: str) -> str:
    environment = {
        **os.environ,
        "HOMEBREW_NO_AUTO_UPDATE": "1",
        "HOMEBREW_NO_INSTALL_FROM_API": "1",
        "HOMEBREW_NO_ANALYTICS": "1",
    }
    printable = " ".join(args)
    completed = subprocess.run(
        ["brew", *args],
        capture_output=True,
        text=True,
        env=environment,
        timeout=900,
        check=False,
    )
    output = completed.stdout + completed.stderr
    if completed.returncode != 0:
        raise SmokeError(
            f"brew {printable} exited with {completed.returncode}:\n{output}"
        )
    return output


def cask(context: Context) -> None:
    step("installing and uninstalling with Homebrew from a local tap")
    check(context.versioned_dmg is not None, "no disk image for the cask")
    dmg = context.versioned_dmg or context.dmg
    repository = Path(brew("--repository").strip())
    tap = repository / "Library" / "Taps" / "librephotos" / "homebrew-smoke"
    if not tap.exists():
        brew("tap-new", "--no-git", TAP)
    cask_file = write_cask(tap, dmg)
    step(f"cask:\n{cask_file.read_text(encoding='utf-8')}")
    step(brew("install", "--cask", f"{TAP}/librephotos-server"))
    check(binary().is_file(), "brew did not install the app")
    codesign_verify(APP)
    check(release_version(APP) == VERSION, f"brew installed {release_version(APP)}")
    start_at_login("on")
    step(brew("uninstall", "--cask", f"{TAP}/librephotos-server"))
    check(not APP.exists(), "brew uninstall left the app")
    check(not agent_path().exists(), "brew uninstall left the login item")
    check((data_folder() / "db").is_dir(), "brew uninstall deleted the library")
    step("deleting the library too, with uninstall.sh --delete-data")
    run_tool(["sh", context.work / "uninstall.sh", "--delete-data", f"--app={APP}"])
    check(not data_folder().exists(), "uninstall.sh --delete-data kept the library")


RUNNERS: dict[str, Callable[[Context], None]] = {
    "fresh": fresh_install,
    "update": update_in_place,
    "autostart": autostart,
    "quit": quit_scenario,
    "uninstall": uninstall,
    "cask": cask,
}


def clean_up() -> None:
    for folder in (APP, ROLLBACK):
        for process in psutil.process_iter():
            if from_app(process, folder):
                with contextlib.suppress(psutil.Error):
                    process.kill()


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Install, update, start at login, quit and uninstall the Mac app"
    )
    parser.add_argument("dmg", type=Path, help="the disk image the build made")
    parser.add_argument("--work-dir", type=Path)
    parser.add_argument("--screenshots", type=Path)
    parser.add_argument("--scenarios", default=",".join(SCENARIOS))
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    work = (
        args.work_dir or Path(tempfile.mkdtemp(prefix="librephotos-macos-"))
    ).resolve()
    screenshots = (args.screenshots or work / "screenshots").resolve()
    screenshots.mkdir(parents=True, exist_ok=True)
    (work / "logs").mkdir(parents=True, exist_ok=True)
    feed = Feed(work / "feed")
    scenarios = [name for name in args.scenarios.split(",") if name]
    with serve(feed) as source:
        context = Context(work, args.dmg.resolve(), screenshots, feed, source)
        try:
            prepare_releases(context)
            for name in scenarios:
                step(f"=== {name} ===")
                RUNNERS[name](context)
                step(f"=== {name}: passed ===")
        except (
            SmokeError,
            OSError,
            requests.RequestException,
            subprocess.SubprocessError,
        ) as error:
            with contextlib.suppress(SmokeError, OSError, subprocess.SubprocessError):
                screenshot(context, "failure")
            dump_logs(data_folder() / "logs")
            dump_logs(context.logs)
            print(f"macOS smoke: FAILED: {error}", file=sys.stderr, flush=True)
            return 1
        finally:
            clean_up()
    print("macOS smoke: passed", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
