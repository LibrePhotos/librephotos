"""One running standalone LibrePhotos per data folder (#2316).

A second double-click used to start a second full instance while the first
was still migrating: it truncated the first one's console.log, ran migrate on
the same SQLite file, started duplicate sidecars and a second job cluster, and
on its way out stopped the first one's sidecars. The health check on the web
server port only answers once the first instance is fully up, minutes later
after an update, so it could not prevent any of that.

The lock is an OS file lock on ``<data folder>/librephotos.lock``, held for
the life of the process. The OS drops it when the process ends, however it
ends, so a crash leaves nothing stale behind. The file also says where the
holder serves, so a second start can open the browser there even when it was
given another ``--port``.
"""

from __future__ import annotations

import json
import os
import sys
from typing import IO

LOCK_NAME = "librephotos.lock"
# Windows file locks are mandatory: a locked byte cannot be read by anyone
# else. The lock covers one byte far past the content, so the URL stays
# readable for the second start.
_LOCKED_OFFSET = 1 << 20


def lock_path(data_dir: str) -> str:
    return os.path.join(data_dir, LOCK_NAME)


def _try_lock(handle: IO[bytes]) -> bool:
    if sys.platform == "win32":
        import msvcrt

        handle.seek(_LOCKED_OFFSET)
        try:
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            return False
        return True
    import fcntl

    try:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        return False
    return True


class InstanceLock:
    """The held lock; released when the process ends, or by ``release``."""

    def __init__(self, handle: IO[bytes]) -> None:
        self._handle = handle

    def release(self) -> None:
        # Closing the handle drops the lock on every platform.
        self._handle.close()


def acquire(data_dir: str, url: str) -> InstanceLock | None:
    """Take the data folder's lock and record ``url`` in it, or return None
    when another process holds it. Writes nothing in that case."""
    os.makedirs(data_dir, exist_ok=True)
    # "a+b": opening must not truncate what the holder wrote.
    handle = open(lock_path(data_dir), "a+b")  # noqa: SIM115 - held for the process's life
    if not _try_lock(handle):
        handle.close()
        return None
    handle.seek(0)
    handle.truncate()
    handle.write(json.dumps({"url": url, "pid": os.getpid()}).encode("utf-8"))
    handle.flush()
    return InstanceLock(handle)


def holder_url(data_dir: str) -> str | None:
    """Where the instance holding the lock serves, as it wrote it; None when
    the file is missing or unreadable."""
    try:
        with open(lock_path(data_dir), "rb") as handle:
            content = handle.read(4096)
    except OSError:
        return None
    try:
        record = json.loads(content.decode("utf-8"))
    except ValueError:
        return None
    url = record.get("url") if isinstance(record, dict) else None
    return url if isinstance(url, str) and url else None
