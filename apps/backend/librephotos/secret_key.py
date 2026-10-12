"""Where Django's SECRET_KEY comes from when the environment does not set one.

The key signs every session, JWT and password-reset link, and encrypts the
stored SMTP password, so a copy of it lets anyone forge a login. It is
generated on first start and kept in ``MEDIA_ROOT/secret.key``: the
protected_media volume, which every deployment keeps across container
recreation (Docker Compose, the unified image, the Kubernetes PVC, the Windows
standalone data directory) and which nobody attaches to a bug report.

Releases up to 1.3.0 kept it in BASE_LOGS, next to ownphotos.log, and people
zip that folder for bug reports (#2381). An existing BASE_LOGS/secret.key is
moved on the first start, never regenerated: a new key logs every user out.
Any start that finds the old file next to the new one holding the same key
removes it, which finishes a move whose removal failed (on Windows a file
another process is reading cannot be deleted).

The settings module runs this at import, in every process that loads Django
settings at once (the uvicorn workers, qcluster and its workers, manage.py),
so creating the file is race-safe: the key is written to a temporary file and
hard-linked into place, which fails when another process got there first, and
the loser reads the winner's key.
"""

import os
import tempfile
import time

from librephotos.logging_bootstrap import defer_warning

# How long a reader waits for a key file another process has created but not
# finished writing. Only possible on a filesystem without hard links, where
# _publish falls back to O_EXCL; a whole key is a few dozen bytes.
EMPTY_FILE_WAIT_SECONDS = 2.0

# How long removing the old key file is retried while Windows refuses because
# another process has it open (WinError 32): the processes starting together
# all read it, each for a moment.
REMOVE_RETRY_SECONDS = 2.0


class SecretKeyError(RuntimeError):
    """The key file cannot be read or written; the message names the path."""


def _read_key(path: str) -> str | None:
    """The stripped contents of ``path``, or None when it does not exist."""
    try:
        with open(path, encoding="utf-8") as handle:
            return handle.read().strip()
    except FileNotFoundError:
        return None


def _read_published_key(path: str) -> str | None:
    """Like _read_key, but wait for a key file that is still being written."""
    deadline = time.monotonic() + EMPTY_FILE_WAIT_SECONDS
    while True:
        key = _read_key(path)
        if key is None or key:
            return key
        if time.monotonic() >= deadline:
            raise SecretKeyError(
                f"The Django secret key file {path} is empty. Restore it from a "
                "backup, or delete it to have a new key generated (which logs "
                "every user out), or set the SECRET_KEY environment variable."
            )
        time.sleep(0.05)


def _create_exclusive(path: str, key: str) -> bool:
    """Create ``path`` holding ``key``; False if it exists already."""
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        return False
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(key)
        handle.flush()
        os.fsync(handle.fileno())
    return True


def _publish(path: str, key: str) -> tuple[str, bool]:
    """Store ``key`` in ``path`` unless another process stored one first.

    Returns the key ``path`` holds afterwards and whether this call wrote it.
    The hard link makes the file appear complete or not at all; filesystems
    without hard links (FAT, some network shares) get O_EXCL instead, whose
    brief empty file _read_published_key waits out.
    """
    directory = os.path.dirname(path) or "."
    try:
        os.makedirs(directory, exist_ok=True)
        fd, temporary = tempfile.mkstemp(
            prefix=".secret.key.", suffix=".tmp", dir=directory
        )
    except OSError as error:
        raise SecretKeyError(
            f"Could not write the Django secret key to {path}: {error}. Make "
            "that directory writable, or set the SECRET_KEY environment variable."
        ) from error
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(key)
            handle.flush()
            os.fsync(handle.fileno())
        try:
            os.link(temporary, path)
            created = True
        except FileExistsError:
            created = False
        except OSError:
            created = _create_exclusive(path, key)
    finally:
        try:
            os.unlink(temporary)
        except OSError:
            pass
    stored = _read_published_key(path)
    if not stored:
        raise SecretKeyError(f"The Django secret key file {path} disappeared.")
    return stored, created


def _remove_legacy_key(path: str, legacy_path: str) -> bool:
    """Remove the old key file, which ``path`` now holds a copy of.

    Retried while Windows refuses because another process has the file open;
    True once it is gone, also when another process removed it first.
    """
    deadline = time.monotonic() + REMOVE_RETRY_SECONDS
    while True:
        try:
            os.remove(legacy_path)
            return True
        except FileNotFoundError:
            return True  # another process moved it at the same time
        except PermissionError as error:
            if time.monotonic() < deadline:
                time.sleep(0.05)
                continue
            failure: OSError = error
        except OSError as error:
            failure = error
        defer_warning(
            f"Copied the Django secret key from {legacy_path} to {path} but "
            f"could not remove the old file: {failure}. Delete it by hand; it "
            "lets anyone who gets a copy of the log folder forge a login."
        )
        return False


def _move_legacy_key(path: str, legacy_path: str, legacy_key: str) -> str:
    """Copy the key from ``legacy_path`` to ``path``, then remove the old file."""
    stored, created = _publish(path, legacy_key)
    if stored != legacy_key:
        # Some other process stored a different key in the meantime. Every
        # process checks the old file before generating one, so this needs
        # something outside LibrePhotos writing the file; keep the old copy.
        _warn_both_present(path, legacy_path)
        return stored
    if not _remove_legacy_key(path, legacy_path):
        return stored
    if created:
        defer_warning(
            f"Moved the Django secret key from {legacy_path} to {path}, out of "
            "the log folder. Back up that file together with your data."
        )
    return stored


def _warn_both_present(path: str, legacy_path: str) -> None:
    defer_warning(
        f"Both {path} and {legacy_path} exist; LibrePhotos uses {path}. The old "
        "file in the log folder holds a different, unused key and is left "
        "untouched: delete it, since anyone who gets a copy of the log folder "
        "could use it."
    )


def load_or_create_secret_key(path: str, legacy_path: str | None = None) -> str:
    """The key stored in ``path``, moved there from ``legacy_path`` or generated.

    In that order: an existing ``path`` wins (a ``legacy_path`` next to it
    holding the same key is the rest of an unfinished move and is removed, one
    holding another key is reported and left alone); otherwise an existing
    ``legacy_path`` is copied to ``path`` and removed; otherwise a new key is
    generated.
    """
    key = _read_published_key(path)
    legacy_key = _read_key(legacy_path) if legacy_path else None
    if key:
        if legacy_path and legacy_key == key:
            # Another process starting at the same time copied it, and could
            # not remove it while this one was reading it (Windows), or an
            # earlier start was interrupted: finish the move.
            _remove_legacy_key(path, legacy_path)
        elif legacy_path and legacy_key:
            _warn_both_present(path, legacy_path)
        return key
    if legacy_path and legacy_key:
        return _move_legacy_key(path, legacy_path, legacy_key)

    from django.core.management.utils import get_random_secret_key

    stored, created = _publish(path, get_random_secret_key())
    if created:
        defer_warning(
            f"Generated a new Django secret key in {path}. On an existing "
            "installation this logs every user out: check that the "
            "protected_media volume is mounted."
        )
    return stored
