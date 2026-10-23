"""The Windows app's built-in updater, as the web app and the tray drive it (#2788).

Only the compiled Windows app can replace its own program folder: its root
process calls ``enable`` once the server runs (``librephotos.standalone``).
Everywhere else (Docker, a source checkout) ``install_state`` says the install
is not supported, and the update steps in the docs apply.

The download runs on a thread of the root process, which also serves the API
and draws the tray, so both read the one ``Installer``: idle, downloading,
verifying, extracting, ready (``api.updates.stage`` prepared the folder),
restarting (``librephotos.updater`` took over), or failed with a code. It is
not a job of the queue on purpose: a scan holds both workers for hours, and
only the root process may swap the program folder it runs from.
"""

from __future__ import annotations

import dataclasses
import logging
import os
import tempfile
import threading
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import TypedDict

import requests
from django.conf import settings

from api.models.library_folder import LibraryFolder
from api.models.long_running_job import LongRunningJob
from api.models.user import User

from . import signature
from .download import DownloadError
from .stage import (
    EXTRACTING,
    VERIFYING,
    ProgramFolder,
    Reporter,
    is_staged,
    stage_release,
)

logger = logging.getLogger(__name__)

IDLE = "idle"
DOWNLOADING = "downloading"
READY = "ready"
RESTARTING = "restarting"
FAILED = "failed"
BUSY = frozenset({DOWNLOADING, VERIFYING, EXTRACTING, RESTARTING})

# Why the updater cannot run here; the update steps in the docs apply instead.
NOT_WINDOWS_APP = "not_windows_app"
READ_ONLY = "read_only"
DATA_IN_PROGRAM_FOLDER = "data_in_program_folder"
LIBRARY_IN_PROGRAM_FOLDER = "library_in_program_folder"
# A failure no DownloadError names; the log has the traceback.
UNEXPECTED = "unexpected"

# restart(prepared folder): start librephotos.updater from it, then quit.
RestartHook = Callable[[Path], None]
# The folders of every user's library (library_dirs).
Libraries = Callable[[], Sequence[Path]]


class InstallState(TypedDict):
    """The updater's part of ``GET /api/updates/``."""

    supported: bool
    reason: str | None
    state: str
    version: str | None
    received_bytes: int
    total_bytes: int | None
    error: str | None
    signature_checked: bool


Listener = Callable[[InstallState], None]


class InstallError(Exception):
    """An update cannot start or restart now; ``code`` says why."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclasses.dataclass(frozen=True)
class _Progress:
    state: str = IDLE
    version: str | None = None
    received_bytes: int = 0
    total_bytes: int | None = None
    error: str | None = None


def _as_state(progress: _Progress, reason: str | None = None) -> InstallState:
    return InstallState(
        supported=reason is None,
        reason=reason,
        state=progress.state,
        version=progress.version,
        received_bytes=progress.received_bytes,
        total_bytes=progress.total_bytes,
        error=progress.error,
        signature_checked=bool(signature.PUBLIC_KEY),
    )


@dataclasses.dataclass(frozen=True)
class Surroundings:
    """What must not be inside the program folder: the data folders, and the
    libraries (``libraries`` asks the database each time, since an admin can
    move a scan directory at any time)."""

    data_dirs: Sequence[Path] = ()
    libraries: Libraries = lambda: ()


class Installer:
    """One program folder's updater. Every method is safe from any thread."""

    def __init__(
        self,
        folder: ProgramFolder,
        restart: RestartHook,
        surroundings: Surroundings | None = None,
        session_factory: Callable[[], requests.Session] = requests.Session,
    ) -> None:
        self.folder = folder
        self._restart = restart
        self._surroundings = surroundings or Surroundings()
        self._session_factory = session_factory
        self._lock = threading.Lock()
        self._now = _Progress()
        self._staged: Path | None = None
        self._listeners: list[Listener] = []

    def subscribe(self, listener: Listener) -> None:
        """``listener`` hears every change, progress included, on the thread
        that made it."""
        self._listeners.append(listener)

    def _publish(self, progress: _Progress) -> InstallState:
        state = _as_state(progress)
        for listener in self._listeners:
            listener(state)
        return state

    def _change(self, change: Callable[[_Progress], _Progress]) -> InstallState:
        with self._lock:
            self._now = change(self._now)
            now = self._now
        return self._publish(now)

    def blocked(self) -> str | None:
        """Why this program folder cannot be replaced now, or None."""
        surroundings = self._surroundings
        return blocked_reason(
            self.folder.path, surroundings.data_dirs, surroundings.libraries()
        )

    def _check_allowed(self) -> None:
        reason = self.blocked()
        if reason is not None:
            raise InstallError(reason)

    def state(self, latest: str | None = None) -> InstallState:
        """The state now. ``latest``, the newest release, counts as ready
        when an earlier run of LibrePhotos prepared it already."""
        with self._lock:
            now = self._now
        reason = self.blocked()
        if reason is not None:
            return _as_state(now, reason)
        if (
            latest
            and now.state in (IDLE, FAILED)
            and is_staged(self.folder.staged(latest), latest)
        ):
            self._staged = self.folder.staged(latest)
            return self._change(
                lambda now: dataclasses.replace(
                    now, state=READY, version=latest, error=None
                )
            )
        return _as_state(now)

    def start(self, version: str) -> InstallState:
        """Download, check and unpack ``version`` in the background."""
        self._check_allowed()
        with self._lock:
            now = self._now
            if now.version == version and (now.state in BUSY or now.state == READY):
                return _as_state(now)
            if now.state in BUSY:
                raise InstallError("update_in_progress")
            self._now = _Progress(state=DOWNLOADING, version=version)
            started = self._now
        threading.Thread(
            target=self._download, args=(version,), daemon=True, name="update"
        ).start()
        return self._publish(started)

    def _progress(self, received: int, total: int | None) -> None:
        self._change(
            lambda now: dataclasses.replace(
                now, received_bytes=received, total_bytes=total
            )
        )

    def _phase(self, name: str) -> None:
        self._change(lambda now: dataclasses.replace(now, state=name))

    def _settle(self, state: str, error: str | None) -> None:
        self._change(lambda now: dataclasses.replace(now, state=state, error=error))

    def _download(self, version: str) -> None:
        try:
            with self._session_factory() as session:
                staged = stage_release(
                    session,
                    self.folder,
                    version,
                    Reporter(progress=self._progress, phase=self._phase),
                )
        except DownloadError as error:
            logger.warning("Update to %s failed: %s", version, error.code)
            self._settle(FAILED, error.code)
        except OSError as error:
            logger.warning(
                "Update to %s failed on disk: errno %s", version, error.errno
            )
            self._settle(FAILED, "disk_error")
        except Exception:
            # Never leave the updater busy for good: anything else fails it.
            logger.exception("Update to %s failed unexpectedly", version)
            self._settle(FAILED, UNEXPECTED)
        else:
            self._staged = staged
            self._settle(READY, None)

    def restart(self) -> InstallState:
        """Hand over to the prepared release: LibrePhotos quits and the new
        release starts in its place."""
        self._check_allowed()
        with self._lock:
            staged = self._staged
            if self._now.state != READY or staged is None:
                raise InstallError("update_not_ready")
            self._now = dataclasses.replace(self._now, state=RESTARTING, error=None)
            restarting = self._now
        self._publish(restarting)
        try:
            self._restart(staged)
        except OSError as error:
            logger.warning("Update: the restart failed: errno %s", error.errno)
            self._settle(READY, "restart_failed")
            raise InstallError("restart_failed") from error
        return _as_state(restarting)


@dataclasses.dataclass
class _Registry:
    installer: Installer | None = None


_registry = _Registry()


def _inside(path: Path, folder: Path) -> bool:
    real_path, real_folder = os.path.realpath(path), os.path.realpath(folder)
    try:
        return os.path.commonpath([real_path, real_folder]) == real_folder
    except ValueError:
        # Different drives (D:\ and C:\) have no common path: not inside.
        return False


def _writable(folder: Path) -> bool:
    try:
        os.rmdir(tempfile.mkdtemp(prefix=".librephotos-write-test-", dir=folder))
    except OSError:
        return False
    return True


def library_dirs() -> list[Path]:
    """Every folder photos live in: the topmost photo folder (PHOTOS), each
    user's scan directory and upload folder, and their library folders."""
    folders = User.objects.values_list("scan_directory", "upload_directory")
    paths = [
        settings.DATA_ROOT,
        *(path for pair in folders for path in pair),
        *LibraryFolder.objects.values_list("path", flat=True),
    ]
    return [Path(path) for path in paths if path]


def blocked_reason(
    program_dir: Path, data_dirs: Sequence[Path], libraries: Sequence[Path] = ()
) -> str | None:
    """Why this program folder cannot be replaced, or None when it can. The
    swap moves the folder to librephotos-old, and the update after deletes
    it: nothing of the user's may be inside."""
    if any(_inside(data, program_dir) for data in data_dirs):
        return DATA_IN_PROGRAM_FOLDER
    if any(_inside(library, program_dir) for library in libraries):
        return LIBRARY_IN_PROGRAM_FOLDER
    if not _writable(program_dir.parent):
        # Program Files, or a folder the user cannot write to.
        return READ_ONLY
    return None


def enable(
    program_dir: Path, data_dirs: Sequence[Path], restart: RestartHook
) -> Installer:
    """Turn the updater on for the running program folder (the Windows app's
    root process). Whether it may replace the folder is asked each time
    (``Installer.blocked``)."""
    surroundings = Surroundings(tuple(data_dirs), library_dirs)
    _registry.installer = Installer(ProgramFolder(program_dir), restart, surroundings)
    return _registry.installer


def installer() -> Installer | None:
    return _registry.installer


def install_state(latest: str | None) -> InstallState:
    """What the updater can do for ``latest``, the newest release known."""
    current = _registry.installer
    if current is None:
        return _as_state(_Progress(), NOT_WINDOWS_APP)
    return current.state(latest)


def running_job() -> str | None:
    """The kind of job a restart would stop, if one runs (upload imports,
    which run all day for phone backups, do not count)."""
    job = LongRunningJob.objects.holding_the_queue().first()
    return job.get_job_type_display() if job is not None else None
