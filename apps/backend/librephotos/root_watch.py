from __future__ import annotations

import logging
import os
import signal
import sys
import threading
import time
from collections.abc import Callable, Mapping

ROOT_PID_ENV = "LIBREPHOTOS_ROOT_PID"
ROOT_POLL_SECONDS = 2.0
ROOT_GONE_GRACE_SECONDS = 20.0
CHILDREN_STOP_SECONDS = 5.0

logger = logging.getLogger(__name__)
_watching: list[threading.Thread] = []


def mark_root(environ: dict[str, str] | os._Environ[str] = os.environ) -> None:
    environ[ROOT_PID_ENV] = str(os.getpid())


def root_pid(environ: Mapping[str, str]) -> int | None:
    value = environ.get(ROOT_PID_ENV, "")
    if not value.isdigit():
        return None
    pid = int(value)
    return None if pid == os.getpid() else pid


def watch_root() -> threading.Thread | None:
    if sys.platform == "win32" or _watching:
        return None
    pid = root_pid(os.environ)
    if pid is None:
        return None
    thread = threading.Thread(
        target=exit_with_root, args=(pid,), daemon=True, name="root-watch"
    )
    _watching.append(thread)
    thread.start()
    return thread


def root_alive(pid: int) -> bool:
    import psutil

    try:
        return psutil.Process(pid).status() != psutil.STATUS_ZOMBIE
    except psutil.Error:
        return False


def stop_children() -> None:
    import psutil

    try:
        children = psutil.Process().children(recursive=True)
    except psutil.Error:
        return
    for child in children:
        try:
            child.terminate()
        except psutil.Error:
            continue
    _, alive = psutil.wait_procs(children, timeout=CHILDREN_STOP_SECONDS)
    for child in alive:
        try:
            child.kill()
        except psutil.Error:
            continue


def exit_with_root(
    pid: int,
    alive: Callable[[int], bool] = root_alive,
    sleep: Callable[[float], None] = time.sleep,
) -> None:
    while alive(pid):
        sleep(ROOT_POLL_SECONDS)
    logger.warning("Process %s that started this one is gone; exiting", pid)
    stop_children()
    os.kill(os.getpid(), signal.SIGTERM)
    sleep(ROOT_GONE_GRACE_SECONDS)
    os._exit(1)
