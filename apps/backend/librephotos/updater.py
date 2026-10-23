"""Swapping the Windows app's program folder for a new release (#2788).

``api.updates.stage`` prepared the new release next to the running one, in
``librephotos-1.5.0``. On Restart to update the running instance starts that
release's ``librephotos.exe finish-update`` (``start_finisher``) and quits
normally. The finisher, running from the new folder:

1. waits until the old instance and every process from the old program
   folder have exited (stragglers are ended after a minute);
2. renames ``librephotos`` to ``librephotos-old`` and ``librephotos-1.5.0``
   to ``librephotos``; an earlier ``librephotos-old`` is moved aside first.
   Windows lets a folder be renamed while a program in it runs, which is how
   the finisher renames its own; any failed rename is undone and the old
   release started again;
3. starts ``librephotos.exe`` from the new folder with the arguments,
   working directory and environment the old one was started with, and waits
   until it answers ``/api/healthz/ready``;
4. only then deletes the earlier ``librephotos-old``. ``librephotos-old``
   itself stays: it is the way back (the docs' "Going back").

The data folder is not touched: the updater refuses a data folder inside the
program folder (``api.updates.install``). If the new release does not become
ready, nothing is deleted and a message box says where the old one is.

The finisher's arguments are a contract between two releases (the old one
starts the new one's finisher): only ever add options, with defaults.
Standard library, psutil and requests only: it runs before Django is set up.
"""

from __future__ import annotations

import argparse
import datetime
import json
import os
import shutil
import subprocess
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path

import psutil
import requests

EXECUTABLE = "librephotos.exe"
FINISH_COMMAND = "finish-update"
ROLLBACK_SUFFIX = "-old"
LOG_NAME = "update.log"
OLD_EXIT_TIMEOUT_SECONDS = 300.0
LEFTOVER_TIMEOUT_SECONDS = 60.0
# Migrations after a big update can take a long time.
READY_TIMEOUT_SECONDS = 30 * 60.0
READY_POLL_SECONDS = 2.0
GOING_BACK_URL = (
    "https://docs.librephotos.com/docs/installation/windows-standalone#going-back"
)

MESSAGE_OLD_RUNNING = (
    "LibrePhotos did not stop within five minutes, so the update was not "
    "installed. The new release is ready in {staged}; choose Restart to update "
    "again later."
)
MESSAGE_SWAP_FAILED = (
    "LibrePhotos could not replace its program folder ({error}), so the update "
    "was not installed and the release you had was started again. The new "
    "release is ready in {staged}."
)
MESSAGE_NOT_READY = (
    "The new release of LibrePhotos did not start. The release you had is in "
    "{rollback}. To go back to it, see {url}"
)

Notify = Callable[[str], None]


@dataclass(frozen=True)
class Launch:
    """How this instance was started: the new release starts the same way."""

    argv: tuple[str, ...]
    environ: dict[str, str]
    cwd: str

    @classmethod
    def capture(cls, argv: Sequence[str]) -> Launch:
        """Before anything changes the environment (``prepare_environment``
        adds the old folder's tools to PATH and the old release's version)."""
        return cls(tuple(argv), dict(os.environ), os.getcwd())


def finisher_command(
    staged: Path, old_dir: Path, url: str, log: Path, launch: Launch
) -> list[str]:
    return [
        str(staged / EXECUTABLE),
        FINISH_COMMAND,
        "--old-pid",
        str(os.getpid()),
        "--old-dir",
        str(old_dir),
        "--url",
        url,
        "--log",
        str(log),
        "--cwd",
        launch.cwd,
        "--relaunch",
        json.dumps(list(launch.argv)),
    ]


def _spawn(
    command: Sequence[str], environ: dict[str, str], cwd: Path, flags: int
) -> subprocess.Popen[bytes]:
    # No standard handles are passed on: a child without them binds its output
    # to NUL and so writes console.log, as after a double-click.
    return subprocess.Popen(command, env=environ, cwd=str(cwd), creationflags=flags)


def start_finisher(
    staged: Path, old_dir: Path, url: str, log: Path, launch: Launch
) -> bool:
    """Start the prepared release's finisher. True when it left this
    instance's job object, whose kill-on-close would end it together with
    this instance; False when Windows refused that (LibrePhotos itself runs
    in a job that forbids it), and the caller has to lift kill-on-close
    before it exits."""
    command = finisher_command(staged, old_dir, url, log, launch)
    # Not inside the old folder: a working directory there blocks its rename.
    cwd = staged.parent
    breakaway = getattr(subprocess, "CREATE_BREAKAWAY_FROM_JOB", 0)
    if breakaway:
        try:
            _spawn(command, launch.environ, cwd, breakaway)
            return True
        except OSError:
            pass
    _spawn(command, launch.environ, cwd, 0)
    return False


@dataclass(frozen=True)
class FinishRequest:
    """``finish-update``'s arguments; ``staged`` is the finisher's own folder."""

    old_pid: int
    old_dir: Path
    staged: Path
    url: str
    log: Path
    cwd: str
    relaunch: tuple[str, ...]

    @classmethod
    def from_arguments(cls, args: argparse.Namespace, staged: Path) -> FinishRequest:
        relaunch = json.loads(args.relaunch)
        if not isinstance(relaunch, list) or not all(
            isinstance(arg, str) for arg in relaunch
        ):
            raise SystemExit("--relaunch is not a JSON list of strings")
        return cls(
            old_pid=args.old_pid,
            old_dir=args.old_dir,
            staged=staged,
            url=args.url,
            log=args.log,
            cwd=args.cwd,
            relaunch=tuple(relaunch),
        )


class Log:
    """Lines with a time in ``<data folder>/logs/update.log``; never raises."""

    def __init__(self, path: Path) -> None:
        self.path = path

    def __call__(self, message: str) -> None:
        stamp = datetime.datetime.now().isoformat(timespec="seconds")
        try:
            with open(self.path, "a", encoding="utf-8") as handle:
                handle.write(f"{stamp} {message}\n")
        except OSError:
            pass


@dataclass(frozen=True)
class SwapPlan:
    """The renames that put the new release in place, in order."""

    current: Path
    staged: Path
    rollback: Path
    superseded: Path | None

    def renames(self) -> list[tuple[Path, Path]]:
        moves = [(self.current, self.rollback), (self.staged, self.current)]
        if self.superseded is not None:
            moves.insert(0, (self.rollback, self.superseded))
        return moves


def plan_swap(current: Path, staged: Path, stamp: str) -> SwapPlan:
    """``stamp`` names the place an earlier ``librephotos-old`` moves to."""
    if staged.parent != current.parent or staged == current:
        raise ValueError("the new release is not next to the program folder")
    rollback = current.with_name(current.name + ROLLBACK_SUFFIX)
    superseded = (
        rollback.with_name(f"{rollback.name}.superseded-{stamp}")
        if os.path.lexists(rollback)
        else None
    )
    return SwapPlan(current, staged, rollback, superseded)


def apply_swap(plan: SwapPlan, log: Callable[[str], None]) -> None:
    """Rename as planned; on a failure undo what was done and raise."""
    done: list[tuple[Path, Path]] = []
    try:
        for source, target in plan.renames():
            os.rename(source, target)
            done.append((source, target))
            log(f"renamed {source} to {target}")
    except OSError:
        for source, target in reversed(done):
            try:
                os.rename(target, source)
            except OSError as error:
                log(f"could not undo the rename of {source}: {error}")
        raise


def wait_for_exit(pid: int, timeout: float) -> bool:
    try:
        psutil.Process(pid).wait(timeout)
    except psutil.NoSuchProcess:
        return True
    except psutil.TimeoutExpired:
        return False
    return True


def _runs_from(process: psutil.Process, folder: str) -> bool:
    executable = process.info.get("exe")
    if not executable or process.pid == os.getpid():
        return False
    return os.path.commonpath([os.path.realpath(executable), folder]) == folder


def processes_in(folder: Path) -> list[psutil.Process]:
    """Processes whose executable lies in ``folder``: the old release's
    sidecars, workers and job cluster run under its hard-linked names."""
    real = os.path.realpath(folder)
    return [
        process for process in psutil.process_iter(["exe"]) if _runs_from(process, real)
    ]


def stop_leftovers(folder: Path, timeout: float, log: Callable[[str], None]) -> None:
    _, alive = psutil.wait_procs(processes_in(folder), timeout=timeout)
    for process in alive:
        log(f"ending process {process.pid}, still running from {folder}")
        try:
            process.kill()
        except psutil.Error:
            pass
    psutil.wait_procs(alive, timeout=10)


def launch_release(folder: Path, request: FinishRequest) -> subprocess.Popen[bytes]:
    """Start ``librephotos.exe`` from ``folder`` as the old one was started."""
    cwd = Path(request.cwd) if request.cwd and os.path.isdir(request.cwd) else None
    return _spawn(
        [str(folder / EXECUTABLE), *request.relaunch],
        dict(os.environ),
        cwd or folder.parent,
        0,
    )


def _answers_ready(url: str) -> bool:
    try:
        return requests.get(f"{url}api/healthz/ready", timeout=5).status_code == 200
    except requests.RequestException:
        return False


def wait_ready(
    url: str,
    process: subprocess.Popen[bytes],
    timeout: float,
    sleep: Callable[[float], None] = time.sleep,
) -> bool:
    """Whether the started release answers ready before ``timeout``; False
    as soon as it exits."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if _answers_ready(url):
            return True
        if process.poll() is not None:
            return False
        sleep(READY_POLL_SECONDS)
    return False


def remove_superseded(plan: SwapPlan, log: Callable[[str], None]) -> None:
    """Delete the earlier ``librephotos-old``, if it is a LibrePhotos folder."""
    if plan.superseded is None:
        return
    if not (plan.superseded / EXECUTABLE).is_file():
        log(f"left {plan.superseded} alone: it holds no {EXECUTABLE}")
        return
    shutil.rmtree(plan.superseded, ignore_errors=True)
    if os.path.lexists(plan.superseded):
        log(f"could not delete all of {plan.superseded}")
    else:
        log(f"deleted {plan.superseded}")


def _swap_or_restore(
    request: FinishRequest, notify: Notify, log: Log
) -> SwapPlan | None:
    """The swap done, or None after starting the old release again."""
    stamp = datetime.datetime.now().strftime("%Y%m%d%H%M%S")
    plan = plan_swap(request.old_dir, request.staged, stamp)
    try:
        apply_swap(plan, log)
    except OSError as error:
        log(f"the swap failed: {error}")
        launch_release(request.old_dir, request)
        notify(MESSAGE_SWAP_FAILED.format(error=error, staged=request.staged))
        return None
    return plan


def finish_update(request: FinishRequest, notify: Notify) -> int:
    """``librephotos.exe finish-update``: the steps in the module docstring.
    ``notify`` tells the user why it failed (a message box). Returns the exit
    code."""
    log = Log(request.log)
    log(f"update: {request.staged} replaces {request.old_dir}")
    if not wait_for_exit(request.old_pid, OLD_EXIT_TIMEOUT_SECONDS):
        log(f"process {request.old_pid} did not exit")
        notify(MESSAGE_OLD_RUNNING.format(staged=request.staged))
        return 1
    stop_leftovers(request.old_dir, LEFTOVER_TIMEOUT_SECONDS, log)
    plan = _swap_or_restore(request, notify, log)
    if plan is None:
        return 1
    process = launch_release(plan.current, request)
    log(f"started {plan.current / EXECUTABLE} (process {process.pid})")
    if not wait_ready(request.url, process, READY_TIMEOUT_SECONDS):
        log("the new release did not become ready; nothing was deleted")
        notify(MESSAGE_NOT_READY.format(rollback=plan.rollback, url=GOING_BACK_URL))
        return 1
    remove_superseded(plan, log)
    log("the update is done")
    return 0
