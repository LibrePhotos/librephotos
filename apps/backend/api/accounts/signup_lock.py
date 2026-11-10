"""One sign-up at a time, so only one of them becomes the first admin."""

from django.db import connection

# Any constant: the advisory lock's name among this database's locks.
SIGNUP_LOCK_KEY = 0x4C505355


def hold_signups() -> None:
    """Hold every other sign-up until the calling transaction ends.

    Before the first account exists there is no row to lock, so PostgreSQL
    takes a transaction-level advisory lock. SQLite's IMMEDIATE transactions
    (``librephotos/settings/_sqlite.py``) already let one writer in at a time.
    """
    if connection.vendor != "postgresql":
        return
    with connection.cursor() as cursor:
        cursor.execute("SELECT pg_advisory_xact_lock(%s)", [SIGNUP_LOCK_KEY])
