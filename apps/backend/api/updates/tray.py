"""The update check and the built-in updater in the Windows app's tray menu
(#2311, #2788).

The tray runs in the app's root process once Django is set up, so it reads
the stored check result and the updater (``api.updates.install``) directly.
While a newer release is known, its update item says what can be done:

* **Update to 1.5.0 available...** where the app cannot replace itself
  (``install.supported`` is false): it opens the update steps in the docs;
* **Download LibrePhotos 1.5.0**, then greyed **Downloading 1.5.0 (42 %)**
  and **Preparing 1.5.0...**, then **Restart to update to 1.5.0**, which asks
  first when a job runs, since the restart stops it.

**Check for updates** asks GitHub at once and answers with a notification. A
new release is announced once by a notification of its own;
``UPDATE_CHECK_NOTIFIED_RELEASE`` remembers which one was, so a restart does
not announce it again. A release an admin skipped on the Admin page is not
announced. The end of a download (ready, or failed and why) is announced too.

``TrayUpdates`` takes anything with the tray's ``set_update``, ``notify``,
``confirm`` and ``enable_update_check`` (``librephotos.tray.Tray``), so this
module needs neither pystray nor Windows.
"""

from __future__ import annotations

import functools
import logging
import threading
import webbrowser
from collections.abc import Callable
from typing import Protocol

from constance import config as site_config
from django.db import close_old_connections

from .check import (
    AVAILABLE,
    DEVELOPMENT,
    FAILED,
    LOCKED,
    NOT_CHECKED,
    OFF,
    SKIPPED,
    UP_TO_DATE,
    UpdateStatus,
    check_for_updates,
    update_status,
)
from .install import (
    DOWNLOADING,
    READY,
    RESTARTING,
    Installer,
    InstallError,
    InstallState,
    installer,
    running_job,
)
from .install import FAILED as INSTALL_FAILED
from .stage import EXTRACTING, VERIFYING

logger = logging.getLogger(__name__)

# How often the tray reads the stored result: the daily check runs in the job
# cluster, a site setting may change in the browser.
POLL_SECONDS = 60 * 60

MENU_LABEL = "Update to {version} available..."
MENU_DOWNLOAD = "Download LibrePhotos {version}"
MENU_DOWNLOADING = "Downloading {version} ({percent} %)"
MENU_DOWNLOADING_UNSIZED = "Downloading {version}..."
MENU_PREPARING = "Preparing {version}..."
MENU_RESTART = "Restart to update to {version}"
MENU_RESTARTING = "Restarting to update..."
# What choosing the update item does.
OPEN_DOCS, DOWNLOAD, RESTART = "docs", "download", "restart"

Notice = tuple[str, str]
NOTICE_AVAILABLE = (
    "LibrePhotos {version} is available",
    "Right-click the LibrePhotos icon to update.",
)
NOTICE_DOWNLOADING = (
    "Downloading LibrePhotos {version}",
    "LibrePhotos keeps running meanwhile. You are told when the update is ready.",
)
NOTICE_READY = (
    "LibrePhotos {version} is ready",
    "Right-click the LibrePhotos icon and choose Restart to update.",
)
NOTICE_FAILED = "LibrePhotos {version} could not be installed"
NOTICE_FAILED_UNNAMED = "The update could not be installed"
CONFIRM_RESTART = (
    "Restart to update?",
    "A job is running ({job}). Restarting stops it; you can start it again "
    "afterwards. Restart now?",
)
# Why a download failed, by DownloadError code; FAILURE_DEFAULT for the rest.
FAILURES = {
    "checksum_mismatch": "The download was damaged and was deleted. Try again.",
    "missing_sha256sums": "This release has no checksums to check the download "
    "against. Update by hand instead.",
    "no_checksum": "This release has no checksum for the Windows download. "
    "Update by hand instead.",
    "bad_signature": "The download is not signed by LibrePhotos, so it was not "
    "installed.",
    "disk_full": "There is not enough free disk space next to the program "
    "folder: LibrePhotos needs 3 GB.",
    "disk_error": "LibrePhotos could not write next to its program folder.",
    "folder_in_the_way": "A folder with the new release's name is already next "
    "to the program folder. Move it away and try again.",
    "restart_failed": "LibrePhotos could not start the new release. Try again, "
    "or update by hand.",
}
FAILURE_DEFAULT = "Try again later, or update by hand (see the documentation)."
# What Check for updates answers when there is nothing to install, by status.
CHECK_ANSWERS: dict[str, Notice] = {
    UP_TO_DATE: (
        "LibrePhotos is up to date",
        "You have {current}, the newest release.",
    ),
    FAILED: (
        "Could not check for updates",
        "github.com did not answer. LibrePhotos tries again tomorrow.",
    ),
    NOT_CHECKED: (
        "Could not check for updates",
        "github.com did not answer. LibrePhotos tries again tomorrow.",
    ),
    OFF: (
        "Update checks are off",
        "Turn on Check for new releases in the site settings of the Admin Area.",
    ),
    LOCKED: (
        "Update checks are off",
        "UPDATE_CHECK is turned off in the environment LibrePhotos runs in.",
    ),
    DEVELOPMENT: (
        "Update checks are off",
        "This is a development build, which has no release to compare.",
    ),
}

Action = Callable[[], None]


def _open_page(url: str) -> None:
    webbrowser.open(url)


class UpdateTray(Protocol):
    def set_update(self, label: str | None, action: Action | None) -> None: ...

    def notify(self, title: str, message: str) -> None: ...

    def confirm(self, title: str, text: str) -> bool: ...

    def enable_update_check(self, on_check: Callable[[], None]) -> None: ...


def _downloading(install: InstallState, version: str) -> str:
    total = install["total_bytes"]
    if not total:
        return MENU_DOWNLOADING_UNSIZED.format(version=version)
    percent = min(100, install["received_bytes"] * 100 // total)
    return MENU_DOWNLOADING.format(version=version, percent=percent)


def _install_entry(install: InstallState, latest: str) -> tuple[str, str | None]:
    version = install["version"] or latest
    state = install["state"]
    if state == READY:
        return MENU_RESTART.format(version=version), RESTART
    if state == DOWNLOADING:
        return _downloading(install, version), None
    if state in (VERIFYING, EXTRACTING):
        return MENU_PREPARING.format(version=version), None
    if state == RESTARTING:
        return MENU_RESTARTING, None
    return MENU_DOWNLOAD.format(version=latest), DOWNLOAD


def menu_entry(status: UpdateStatus) -> tuple[str | None, str | None]:
    """The update item's label (None hides it) and what choosing it does:
    OPEN_DOCS, DOWNLOAD, RESTART, or None (greyed out)."""
    latest = status["latest"]
    if not status["update_available"] or latest is None:
        return None, None
    if not status["install"]["supported"]:
        return MENU_LABEL.format(version=latest), OPEN_DOCS
    return _install_entry(status["install"], latest)


def release_to_announce(status: UpdateStatus) -> str | None:
    """The release a notification should announce now: newer, not skipped,
    and not announced before."""
    latest = status["latest"]
    if status["status"] != AVAILABLE or latest is None:
        return None
    if latest == str(site_config.UPDATE_CHECK_NOTIFIED_RELEASE):
        return None
    return latest


def available_notice(version: str) -> Notice:
    title, text = NOTICE_AVAILABLE
    return title.format(version=version), text


def check_answer(status: UpdateStatus) -> Notice:
    """What Check for updates says after asking GitHub."""
    if status["status"] in (AVAILABLE, SKIPPED) and status["latest"] is not None:
        return available_notice(status["latest"])
    title, text = CHECK_ANSWERS.get(status["status"], CHECK_ANSWERS[FAILED])
    return title, text.format(current=status["current"])


def failure_notice(version: str | None, code: str | None) -> Notice:
    title = NOTICE_FAILED.format(version=version) if version else NOTICE_FAILED_UNNAMED
    return title, FAILURES.get(code or "", FAILURE_DEFAULT)


def install_notice(install: InstallState) -> Notice | None:
    """What the end of a download says: ready, or failed and why."""
    version = install["version"]
    if install["state"] == READY:
        title, text = NOTICE_READY
        return title.format(version=version), text
    if install["state"] == INSTALL_FAILED:
        return failure_notice(version, install["error"])
    return None


class TrayUpdates:
    """Keeps the tray's update item current, announces new releases and
    drives the updater from the menu."""

    def __init__(self, tray: UpdateTray, updater: Installer | None = None) -> None:
        self.tray = tray
        self.updater = updater
        self._lock = threading.Lock()
        self._status: UpdateStatus | None = None
        self._entry: tuple[str | None, str | None] | None = None
        self._install_state: str | None = None
        if updater is not None:
            updater.subscribe(self._install_changed)

    def _action(self, kind: str | None, status: UpdateStatus) -> Action | None:
        if kind == OPEN_DOCS:
            return functools.partial(_open_page, status["how_to_update_url"])
        if kind == DOWNLOAD and status["latest"] is not None:
            return functools.partial(self.download, status["latest"])
        return self.restart if kind == RESTART else None

    def _show_menu(self, status: UpdateStatus) -> None:
        """Called with the lock held; the menu changes only when the item does
        (not on every downloaded megabyte)."""
        self._status = status
        entry = menu_entry(status)
        if entry != self._entry:
            self._entry = entry
            self.tray.set_update(entry[0], self._action(entry[1], status))

    def show(self, status: UpdateStatus) -> None:
        """Bring the menu up to date and announce a new release once."""
        with self._lock:
            self._show_menu(status)
            version = release_to_announce(status)
            if version is not None:
                site_config.UPDATE_CHECK_NOTIFIED_RELEASE = version
                self.tray.notify(*available_notice(version))

    def _install_changed(self, install: InstallState) -> None:
        """The updater's listener: progress, and the end of a download."""
        with self._lock:
            if self._status is not None:
                status = self._status.copy()
                status["install"] = install
                self._show_menu(status)
            previous, self._install_state = self._install_state, install["state"]
        notice = install_notice(install) if previous != install["state"] else None
        if notice is not None:
            self.tray.notify(*notice)

    def refresh(self) -> None:
        """Read the stored result (the hourly poll)."""
        try:
            self.show(update_status())
        except Exception:
            logger.exception("Update check: the tray could not read the result")

    def check_now(self) -> None:
        """Check for updates in the tray menu: ask GitHub, then say what it found."""
        try:
            status = check_for_updates()
            version = release_to_announce(status)
            if version is not None:
                # The answer below is that release's announcement.
                site_config.UPDATE_CHECK_NOTIFIED_RELEASE = version
            with self._lock:
                self._show_menu(status)
            self.tray.notify(*check_answer(status))
        except Exception:
            logger.exception("Update check: Check for updates failed")

    def check_in_thread(self) -> None:
        """Check for updates on a thread of its own, which then lets its
        database connection go."""
        try:
            self.check_now()
        finally:
            close_old_connections()

    def download(self, version: str) -> None:
        """Download LibrePhotos 1.5.0: start the updater in the background."""
        if self.updater is None:
            return
        try:
            self.updater.start(version)
        except InstallError as error:
            self.tray.notify(*failure_notice(version, error.code))
            return
        title, text = NOTICE_DOWNLOADING
        self.tray.notify(title.format(version=version), text)

    def restart(self) -> None:
        """Restart to update; asks first while a job runs."""
        if self.updater is None:
            return
        try:
            job = running_job()
        finally:
            close_old_connections()
        if job is not None:
            title, text = CONFIRM_RESTART
            if not self.tray.confirm(title, text.format(job=job)):
                return
        try:
            self.updater.restart()
        except InstallError as error:
            self.tray.notify(*failure_notice(None, error.code))

    def poll(self, stop: threading.Event) -> None:
        """Refresh now and every hour until ``stop`` is set."""
        while True:
            self.refresh()
            close_old_connections()
            if stop.wait(POLL_SECONDS):
                return


def watch_updates(tray: UpdateTray, stop: threading.Event) -> TrayUpdates:
    """Add Check for updates to the tray and keep its update item current."""
    updates = TrayUpdates(tray, installer())
    tray.enable_update_check(updates.check_in_thread)
    threading.Thread(
        target=updates.poll, args=(stop,), daemon=True, name="tray-updates"
    ).start()
    return updates
