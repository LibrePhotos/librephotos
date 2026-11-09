"""The thread that saves and sends error reports, off the thread that failed.

An error can happen anywhere: inside a transaction that is about to roll back,
on the ASGI event loop, in a worker that is shutting down. Saving it there
could fail or be undone, so the capture hands each error to this one thread,
which has its own database connection. Sentry's ``BackgroundWorker`` starts
the thread again in a forked process (the django-q workers).
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable

from django.db import connections
from sentry_sdk.worker import BackgroundWorker, Worker

logger = logging.getLogger(__name__)

# Errors queued but not handled yet; past it new ones are dropped.
QUEUE_SIZE = 100

_worker: Worker = BackgroundWorker(queue_size=QUEUE_SIZE)


def run_in_background(job: Callable[[], None]) -> None:
    """Queue ``job``; a failure in it is logged here and never raised."""

    def guarded() -> None:
        try:
            job()
        except Exception:
            # This logger is never reported (capture.IGNORED_LOGGERS).
            logger.exception("Could not save or send an error report")
        finally:
            if threading.current_thread() is not threading.main_thread():
                # Errors are rare: do not keep a database connection open
                # for this thread between them.
                connections.close_all()

    if not _worker.submit(guarded):
        logger.warning("Dropped an error report: too many are waiting")


def flush(timeout: float) -> None:
    """Wait up to ``timeout`` seconds for the queued reports."""
    _worker.flush(timeout)
