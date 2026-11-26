from __future__ import annotations

import logging
import os
import signal
import subprocess
import threading
from collections import deque
from collections.abc import Callable
from typing import TYPE_CHECKING

from librephotos import release_layout

if TYPE_CHECKING:
    from types import FrameType

logger = logging.getLogger(__name__)

OSASCRIPT = "/usr/bin/osascript"
OPEN = "/usr/bin/open"
APP_TITLE = "LibrePhotos"
CONFIRM_BUTTON = "Restart"
CANCEL_BUTTON = "Cancel"
SERVE_POLL_SECONDS = 0.2
TERMINATE_WAIT_SECONDS = 60.0
APPLICATION_SHOULD_TERMINATE = "applicationShouldTerminate_"

Task = Callable[[], None]


def applescript_text(text: str) -> str:
    escaped = text.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def alert_script(message: str, title: str = APP_TITLE) -> str:
    return (
        f"display alert {applescript_text(title)} "
        f"message {applescript_text(message)} as critical"
    )


def confirm_script(title: str, text: str) -> str:
    buttons = (
        f"{{{applescript_text(CANCEL_BUTTON)}, {applescript_text(CONFIRM_BUTTON)}}}"
    )
    return (
        f"display dialog {applescript_text(text)} "
        f"with title {applescript_text(title)} buttons {buttons} "
        f"default button {applescript_text(CONFIRM_BUTTON)} "
        f"cancel button {applescript_text(CANCEL_BUTTON)}"
    )


def launched_by_launch_services(environ: dict[str, str] | None = None) -> bool:
    values = os.environ if environ is None else environ
    return values.get("__CFBundleIdentifier") == release_layout.BUNDLE_ID


def notification_script(title: str, message: str) -> str:
    return (
        f"display notification {applescript_text(message)} "
        f"with title {applescript_text(title)}"
    )


def _osascript(script: str) -> None:
    try:
        subprocess.Popen([OSASCRIPT, "-e", script])
    except OSError:
        logger.warning("osascript could not show a message")


def alert(message: str) -> None:
    _osascript(alert_script(message))


def notify(title: str, message: str) -> None:
    _osascript(notification_script(title, message))


def confirm(title: str, text: str) -> bool:
    completed = subprocess.run(
        [OSASCRIPT, "-e", confirm_script(title, text)],
        capture_output=True,
        check=False,
    )
    return completed.returncode == 0


def open_path(path: str) -> None:
    subprocess.Popen([OPEN, path])


class MainThread:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._pending: deque[Task] = deque()
        self._wake = threading.Event()
        self._appkit = False
        self.finished = threading.Event()

    def submit(self, task: Task) -> None:
        with self._lock:
            if not self._appkit:
                self._pending.append(task)
                self._wake.set()
                return
        _call_after(task)

    def call[T](self, task: Callable[[], T]) -> T:
        if threading.current_thread() is threading.main_thread():
            return task()
        results: list[T] = []
        done = threading.Event()

        def run() -> None:
            try:
                results.append(task())
            finally:
                done.set()

        self.submit(run)
        done.wait()
        if not results:
            raise RuntimeError("a menu bar task failed on the main thread")
        return results[0]

    def _take_pending(self) -> list[Task]:
        with self._lock:
            tasks = list(self._pending)
            self._pending.clear()
            self._wake.clear()
        return tasks

    def serve(self) -> None:
        while not self.finished.is_set():
            self._wake.wait(SERVE_POLL_SECONDS)
            for task in self._take_pending():
                try:
                    task()
                except Exception:
                    logger.exception("A menu bar task failed")

    def enter_appkit(self) -> None:
        with self._lock:
            self._appkit = True
            tasks = list(self._pending)
            self._pending.clear()
        for task in tasks:
            _call_after(task)

    def leave_appkit(self) -> None:
        with self._lock:
            self._appkit = False

    def finish(self) -> None:
        self.finished.set()
        self._wake.set()


def _call_after(task: Task) -> None:
    from PyObjCTools import AppHelper

    AppHelper.callAfter(task)


class Termination:
    def __init__(self, on_quit: Task, finished: threading.Event) -> None:
        self.on_quit = on_quit
        self.finished = finished
        self.requested = False

    def request(self) -> bool:
        if self.requested:
            return False
        self.requested = True
        self.on_quit()
        return True

    def reply_when_finished(self, reply: Task) -> None:
        self.finished.wait(TERMINATE_WAIT_SECONDS)
        _call_after(reply)


def install_quit_handlers(termination: Termination) -> None:
    import AppKit
    import Foundation
    from PyObjCTools import MachSignals

    def should_terminate(delegate: object, sender: object) -> int:
        if not termination.request():
            return int(AppKit.NSTerminateNow)
        application = AppKit.NSApplication.sharedApplication()
        threading.Thread(
            target=termination.reply_when_finished,
            args=(lambda: application.replyToApplicationShouldTerminate_(True),),
            daemon=True,
            name="terminate",
        ).start()
        return int(AppKit.NSTerminateLater)

    delegate_class = type(Foundation.NSObject)(
        "LibrePhotosAppDelegate",
        (Foundation.NSObject,),
        {APPLICATION_SHOULD_TERMINATE: should_terminate},
    )
    delegate = delegate_class.alloc().init()
    application = AppKit.NSApplication.sharedApplication()
    application.setDelegate_(delegate)
    application.setActivationPolicy_(AppKit.NSApplicationActivationPolicyAccessory)
    _delegates.append(delegate)

    def on_signal(*_: object) -> None:
        termination.request()

    MachSignals.signal(signal.SIGTERM, on_signal)


_delegates: list[object] = []


def quit_on_signal(on_quit: Task) -> None:
    def handler(signum: int, frame: FrameType | None) -> None:
        on_quit()

    signal.signal(signal.SIGTERM, handler)
    signal.signal(signal.SIGINT, handler)
