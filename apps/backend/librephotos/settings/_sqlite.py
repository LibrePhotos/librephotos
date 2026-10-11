"""The SQLite ``DATABASES`` entry shared by every settings module that uses it.

``production_noproxy`` (the unified image, and through it the Windows
standalone build) and ``dev_windows`` used to write this block out separately,
and the copies drifted: one waited 5 s for a lock, the other 30 s, and only one
set the mmap and journal-size pragmas. Both build it here now.
"""

# Production-oriented pragmas, following
# https://alldjango.com/articles/definitive-guide-to-using-django-sqlite-in-production
_INIT_COMMAND = """
    PRAGMA journal_mode=WAL;
    PRAGMA synchronous=NORMAL;
    PRAGMA mmap_size=134217728;
    PRAGMA journal_size_limit=27103364;
    PRAGMA cache_size=2000;
"""

# Seconds a connection waits for another one's write lock before giving up
# with "database is locked". The scan workers, the web server and the
# sidecar-facing jobs all write, and 5 s was too short on the Windows dev
# server, so every SQLite deployment gets the 30 s that server needed.
SQLITE_TIMEOUT_SECONDS = 30


def sqlite_database(path: str) -> dict[str, object]:
    """The ``DATABASES["default"]`` entry for an SQLite file at ``path``."""
    return {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": path,
        "OPTIONS": {
            "transaction_mode": "IMMEDIATE",
            "timeout": SQLITE_TIMEOUT_SECONDS,
            "init_command": _INIT_COMMAND,
        },
    }
