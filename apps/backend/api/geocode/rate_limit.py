"""Per-provider request rate limiting for reverse geocoding.

Nominatim's public terms of use require at most one request per second per
client. LibrePhotos fires reverse-geocode calls as fast as the
geolocation_job loop hands out photos, which is faster than nominatim
tolerates — they respond with slow or empty replies that then time out,
which the loop interprets as "move on" and pounds the server harder.

This module enforces a per-provider minimum delay between successive calls.
The last call of each provider is a row in a small SQLite database under
BASE_DATA, so the django-q2 worker processes coordinate through it: without
that, an N-worker deployment would scale the request rate by N and re-create
the original abuse pattern.

Each check is one ``BEGIN IMMEDIATE`` transaction: it takes SQLite's write
lock, so one process at a time reads the provider's last call and, if the
delay has passed, records its own. A process that has to wait sleeps outside
the transaction and checks again: if another worker claimed the slot during
the sleep, it waits for the next one. SQLite holds the lock in the
operating system's file locks, which a killed process gives up, and its
journal rolls back a transaction a crash interrupted. A connection is opened
per check, so nothing is shared across fork or threads.

``RateLimitStore`` holds the logic and takes any database path (the tests run
it in several processes); ``wait`` is the store under BASE_DATA.
"""

import logging
import os
import shutil
import sqlite3
import time

from django.conf import settings

logger = logging.getLogger(__name__)

# Minimum seconds between successive calls to each provider. Nominatim's
# public terms of use call for >=1 req/sec; commercial providers tolerate
# much higher rates, but a small floor here protects against accidentally
# hammering them while still letting the geolocation job make progress.
# ExifTool's lookup runs on this server (#2302): nothing to protect, no wait.
_MIN_DELAY_PER_PROVIDER = {
    "exiftool": 0,
    "nominatim": 1.1,
    "mapbox": 0.05,
    "maptiler": 0.05,
    "tomtom": 0.05,
    "opencage": 0.05,
}
_DEFAULT_MIN_DELAY = 0.05

_DATABASE_NAME = "geocode_rate_limit.sqlite3"
# Up to 1.6.0 the timestamps lived in a diskcache directory of this name.
_LEGACY_DIRECTORY = "geocode_rate_limit"
# How long a check waits for another process's transaction (milliseconds of
# work) before it gives up with sqlite3.OperationalError.
_LOCK_TIMEOUT_SECONDS = 30.0


def _now() -> float:
    """Wall-clock indirection so tests can patch the clock."""
    return time.time()


def _sleep(seconds: float) -> None:
    """Sleep indirection — patched alongside :func:`_now` in tests."""
    time.sleep(seconds)


def _delay_for(provider: str) -> float:
    return _MIN_DELAY_PER_PROVIDER.get(provider, _DEFAULT_MIN_DELAY)


class RateLimitStore:
    """The last call of each provider, in the SQLite database at ``path``."""

    def __init__(self, path: str) -> None:
        self.path = path

    def _connect(self) -> sqlite3.Connection:
        # isolation_level=None: transactions are begun and ended here, not by
        # the sqlite3 module.
        connection = sqlite3.connect(
            self.path, timeout=_LOCK_TIMEOUT_SECONDS, isolation_level=None
        )
        connection.execute(
            "CREATE TABLE IF NOT EXISTS last_call "
            "(provider TEXT PRIMARY KEY, called_at REAL NOT NULL)"
        )
        return connection

    def claim(self, provider: str, delay: float) -> float:
        """Record a call of ``provider`` now if ``delay`` has passed since the
        last one; answer 0, else the seconds left (nothing recorded)."""
        connection = self._connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT called_at FROM last_call WHERE provider = ?", (provider,)
            ).fetchone()
            now = _now()
            elapsed = now - (row[0] if row else 0.0)
            if elapsed < delay:
                connection.execute("ROLLBACK")
                return delay - elapsed
            connection.execute(
                "INSERT INTO last_call (provider, called_at) VALUES (?, ?) "
                "ON CONFLICT (provider) DO UPDATE SET called_at = excluded.called_at",
                (provider, now),
            )
            connection.execute("COMMIT")
            return 0.0
        finally:
            connection.close()

    def wait(self, provider: str, delay: float) -> None:
        """Block until ``delay`` seconds have passed since the last recorded
        call of ``provider``, then record this one."""
        while (remaining := self.claim(provider, delay)) > 0:
            # Outside the transaction, so other workers are not held up.
            _sleep(remaining)


def _store() -> RateLimitStore:
    base = str(settings.BASE_DATA)
    os.makedirs(base, exist_ok=True)
    legacy = os.path.join(base, _LEGACY_DIRECTORY)
    if os.path.isdir(legacy):
        # The diskcache of 1.6.0 and earlier: a few timestamps, no longer read.
        shutil.rmtree(legacy, ignore_errors=True)
        logger.info("removed the old geocoding rate limit cache")
    return RateLimitStore(os.path.join(base, _DATABASE_NAME))


def wait(provider: str) -> None:
    """Block until ``_delay_for(provider)`` seconds have passed since the
    last call recorded against ``provider`` by any worker process.

    Safe to call concurrently from multiple worker processes; SQLite's write
    lock serialises the read-modify-write of the timestamp, and losers in the
    race re-check after sleeping.
    """
    delay = _delay_for(provider)
    if delay <= 0:
        return
    _store().wait(provider, delay)
