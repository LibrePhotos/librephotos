"""The update check in the Windows app's tray menu (#2311).

The tray runs in the app's root process once Django is set up, so it reads
the stored check result directly. It shows **Update to 1.5.0 available...**
while a newer release is known (it opens the Windows update steps), and
**Check for updates**, which asks GitHub at once and answers with a
notification. A new release is also announced once by a notification of its
own; ``UPDATE_CHECK_NOTIFIED_RELEASE`` remembers which one was, so a restart
does not announce it again. A release an admin skipped on the Admin page is
not announced.

``TrayUpdates`` takes anything with the tray's ``set_update``, ``notify`` and
``enable_update_check`` (``librephotos.tray.Tray``), so this module needs
neither pystray nor Windows.
"""

from __future__ import annotations

import logging
import threading
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

logger = logging.getLogger(__name__)

# How often the tray reads the stored result: the daily check runs in the job
# cluster, a site setting may change in the browser.
POLL_SECONDS = 60 * 60

MENU_LABEL = "Update to {version} available..."
Notice = tuple[str, str]
NOTICE_AVAILABLE = (
    "LibrePhotos {version} is available",
    "Right-click the LibrePhotos icon to update.",
)
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


class UpdateTray(Protocol):
    def set_update(self, label: str | None, url: str) -> None: ...

    def notify(self, title: str, message: str) -> None: ...

    def enable_update_check(self, on_check: Callable[[], None]) -> None: ...


def menu_label(status: UpdateStatus) -> str | None:
    """The tray's update item while a newer release is known; None hides it."""
    if not status["update_available"] or status["latest"] is None:
        return None
    return MENU_LABEL.format(version=status["latest"])


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


class TrayUpdates:
    """Keeps the tray's update item current and announces new releases."""

    def __init__(self, tray: UpdateTray) -> None:
        self.tray = tray
        self._lock = threading.Lock()

    def show(self, status: UpdateStatus) -> None:
        """Bring the menu up to date and announce a new release once."""
        with self._lock:
            self.tray.set_update(menu_label(status), status["how_to_update_url"])
            version = release_to_announce(status)
            if version is not None:
                site_config.UPDATE_CHECK_NOTIFIED_RELEASE = version
                self.tray.notify(*available_notice(version))

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
                self.tray.set_update(menu_label(status), status["how_to_update_url"])
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

    def poll(self, stop: threading.Event) -> None:
        """Refresh now and every hour until ``stop`` is set."""
        while True:
            self.refresh()
            close_old_connections()
            if stop.wait(POLL_SECONDS):
                return


def watch_updates(tray: UpdateTray, stop: threading.Event) -> TrayUpdates:
    """Add Check for updates to the tray and keep its update item current."""
    updates = TrayUpdates(tray)
    tray.enable_update_check(updates.check_in_thread)
    threading.Thread(
        target=updates.poll, args=(stop,), daemon=True, name="tray-updates"
    ).start()
    return updates
