from __future__ import annotations

import argparse
import json
import logging
import os
import shutil
import subprocess
import traceback
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path

from librephotos.installation import (
    DOWNLOADS_DIR_NAME,
    MoveRecord,
    Registry,
    UninstallEntry,
    installed_program,
    release_version,
    setup_command,
    where_options,
    write_move_record,
)
from librephotos.updater import (
    EXECUTABLE,
    LEFTOVER_TIMEOUT_SECONDS,
    OLD_EXIT_TIMEOUT_SECONDS,
    READY_TIMEOUT_SECONDS,
    Launch,
    Log,
    Notify,
    Started,
    launch_release,
    spawn_outside_job,
    stop_leftovers,
    wait_for_exit,
    wait_ready,
)

logger = logging.getLogger(__name__)

FINISH_MOVE_COMMAND = "finish-move"
SETUP_LOG_NAME = "setup.log"
SETUP_TIMEOUT_SECONDS = 30 * 60.0
STOP_TIMEOUT_SECONDS = 30.0
MOVE_DOCS_URL = (
    "https://docs.librephotos.com/docs/installation/windows-standalone"
    "#moving-to-the-installed-version"
)

MESSAGE_OLD_RUNNING = (
    "LibrePhotos did not stop within five minutes, so it was not moved to the "
    "installed version. Choose Restart to finish moving again later."
)
MESSAGE_SETUP_FAILED = (
    "The LibrePhotos installer did not finish ({reason}), so LibrePhotos was "
    "started again from {old}. Its log is {log}; see {url}"
)
MESSAGE_NOT_READY = (
    "The installed version of LibrePhotos did not start, so LibrePhotos was "
    "started again from {old}. See {url}"
)
MESSAGE_FAILED = (
    "Moving LibrePhotos to the installed version failed ({error}). LibrePhotos "
    "was started again from {old}. See {url}"
)

SetupRunner = Callable[[Sequence[str], float], int]


@dataclass(frozen=True)
class MoveRequest:
    old_pid: int
    old_dir: Path
    setup: Path
    data_dir: Path
    url: str
    log: Path
    cwd: str
    relaunch: tuple[str, ...]

    @classmethod
    def from_arguments(cls, args: argparse.Namespace) -> MoveRequest:
        relaunch = json.loads(args.relaunch)
        if not isinstance(relaunch, list) or not all(
            isinstance(arg, str) for arg in relaunch
        ):
            raise SystemExit("--relaunch is not a JSON list of strings")
        return cls(
            old_pid=args.old_pid,
            old_dir=args.old_dir,
            setup=args.setup,
            data_dir=args.data,
            url=args.url,
            log=args.log,
            cwd=args.cwd,
            relaunch=tuple(relaunch),
        )


def add_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--old-pid", type=int, required=True)
    parser.add_argument("--old-dir", type=Path, required=True)
    parser.add_argument("--setup", type=Path, required=True)
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--url", required=True)
    parser.add_argument("--log", type=Path, required=True)
    parser.add_argument("--cwd", default="")
    parser.add_argument("--relaunch", default="[]")


@dataclass(frozen=True)
class MoveStart:
    executable: Path
    setup: Path
    data_dir: Path
    url: str
    log: Path


def move_finisher_command(start: MoveStart, launch: Launch) -> list[str]:
    return [
        str(start.executable),
        FINISH_MOVE_COMMAND,
        "--old-pid",
        str(os.getpid()),
        "--old-dir",
        str(start.executable.parent),
        "--setup",
        str(start.setup),
        "--data",
        str(start.data_dir),
        "--url",
        start.url,
        "--log",
        str(start.log),
        "--cwd",
        launch.cwd,
        "--relaunch",
        json.dumps(list(launch.argv)),
    ]


def start_move_finisher(start: MoveStart, launch: Launch) -> bool:
    return spawn_outside_job(
        move_finisher_command(start, launch), launch.environ, start.data_dir
    )


def run_setup(command: Sequence[str], timeout: float) -> int:
    completed = subprocess.run(list(command), timeout=timeout, check=False)
    return completed.returncode


def _setup_failure(
    request: MoveRequest, runner: SetupRunner, log: Log, stop_at: Sequence[str]
) -> str | None:
    setup_log = request.log.with_name(SETUP_LOG_NAME)
    where = where_options(request.relaunch, request.cwd, stop_at)
    command = setup_command(request.setup, setup_log, where)
    log(f"running {' '.join(command)}")
    try:
        code = runner(command, SETUP_TIMEOUT_SECONDS)
    except (OSError, subprocess.SubprocessError) as error:
        return f"it could not run: {error}"
    log(f"the installer exited with {code}")
    return None if code == 0 else f"exit code {code}"


def _start_old(request: MoveRequest, log: Log) -> None:
    try:
        launch_release(request.old_dir, request)
        log(f"started {request.old_dir / EXECUTABLE} again")
    except OSError as error:
        log(f"could not start {request.old_dir / EXECUTABLE}: {error}")


def _stop(process: Started, folder: Path, log: Log) -> None:
    try:
        process.kill()
        process.wait(STOP_TIMEOUT_SECONDS)
    except (OSError, subprocess.SubprocessError) as error:
        log(f"could not stop process {process.pid}: {error}")
    stop_leftovers(folder, STOP_TIMEOUT_SECONDS, log)


def _discard_setup(setup: Path, log: Log) -> None:
    try:
        setup.unlink()
    except OSError as error:
        log(f"could not delete {setup}: {error}")
        return
    if setup.parent.name == DOWNLOADS_DIR_NAME and not any(setup.parent.iterdir()):
        shutil.rmtree(setup.parent, ignore_errors=True)


def _record_move(request: MoveRequest, target: Path, log: Log) -> None:
    record = MoveRecord.now(request.old_dir, target, release_version(target))
    try:
        write_move_record(request.data_dir, record)
    except OSError as error:
        log(f"could not write the move record: {error}")


@dataclass(frozen=True)
class MoveTools:
    registry: Registry
    runner: SetupRunner
    stop_at: Sequence[str] = ()


def _move(request: MoveRequest, notify: Notify, log: Log, tools: MoveTools) -> int:
    log(f"move: {request.old_dir} to the installed version, with {request.setup}")
    if not wait_for_exit(request.old_pid, OLD_EXIT_TIMEOUT_SECONDS):
        log(f"process {request.old_pid} did not exit")
        notify(MESSAGE_OLD_RUNNING)
        return 1
    stop_leftovers(request.old_dir, LEFTOVER_TIMEOUT_SECONDS, log)
    failure = _setup_failure(request, tools.runner, log, tools.stop_at)
    target = installed_program(tools.registry) if failure is None else None
    if target is None:
        reason = failure or "it registered no program folder"
        log(f"the installer did not finish: {reason}")
        _start_old(request, log)
        notify(
            MESSAGE_SETUP_FAILED.format(
                reason=reason,
                old=request.old_dir,
                log=request.log.with_name(SETUP_LOG_NAME),
                url=MOVE_DOCS_URL,
            )
        )
        return 1
    process = launch_release(target, request)
    log(f"started {target / EXECUTABLE} (process {process.pid})")
    if not wait_ready(request.url, process, READY_TIMEOUT_SECONDS):
        log("the installed version did not become ready")
        _stop(process, target, log)
        _start_old(request, log)
        notify(MESSAGE_NOT_READY.format(old=request.old_dir, url=MOVE_DOCS_URL))
        return 1
    _record_move(request, target, log)
    _discard_setup(request.setup, log)
    log(f"the move is done; {request.old_dir} is no longer used")
    return 0


def finish_move(
    request: MoveRequest, notify: Notify, tools: MoveTools | None = None
) -> int:
    log = Log(request.log)
    tools = tools or MoveTools(UninstallEntry(), run_setup)
    try:
        return _move(request, notify, log, tools)
    except Exception as error:
        logger.exception("Moving to the installed version failed")
        log(f"the move failed:\n{traceback.format_exc()}")
        _start_old(request, log)
        notify(
            MESSAGE_FAILED.format(error=error, old=request.old_dir, url=MOVE_DOCS_URL)
        )
        return 1
