"""Delete the small square thumbnails older releases made.

Up to 1.6 every photo got a 250 px square beside its 500 px one, which the grid
only ever showed as a blurred preview while the bigger one loaded. The
ThumbHash took that over, the scan stopped making them, and their URLs now
answer with the square (``LEGACY_SQUARE_DIR`` in the media view). This job
frees the space they took: every file in the folder, then the folder.
"""

from __future__ import annotations

import logging
import os
from collections.abc import Callable
from dataclasses import dataclass, field

from django.conf import settings

from api.models import LongRunningJob
from api.models.long_running_job import JobCancelledError
from api.models.thumbnail import LEGACY_SQUARE_DIR
from api.models.user import User

logger = logging.getLogger(__name__)

# Progress is reported after this many files.
PROGRESS_EVERY = 1000
# How many failed files a job keeps in its result.
MAX_JOB_ERRORS = 100

Progress = Callable[[int, int], object]


@dataclass
class RemovalResult:
    """What a run did: files removed, the bytes they took, and the ones that failed."""

    removed: int = 0
    freed_bytes: int = 0
    errors: list[str] = field(default_factory=list)


def legacy_folder() -> str:
    return os.path.join(settings.MEDIA_ROOT, LEGACY_SQUARE_DIR)


def legacy_squares_exist() -> bool:
    """Whether the folder of small squares still holds a file the job would delete.

    Stops at the first one. A subfolder the job leaves alone (a NAS's index
    folder, say) does not count, so it cannot hold the task open for good.
    """
    try:
        with os.scandir(legacy_folder()) as entries:
            return any(not entry.is_dir(follow_symlinks=False) for entry in entries)
    except FileNotFoundError, NotADirectoryError:
        return False


def remove_small_thumbnails(
    progress: Progress | None = None, progress_every: int = PROGRESS_EVERY
) -> RemovalResult:
    """Delete every file in the small squares' folder, then the folder.

    Only regular files directly inside it; a link is removed, never followed.
    ``progress(done, total)`` is called at the start, every ``progress_every``
    files and at the end; what it raises (a cancelled job) stops the run.
    """
    result = RemovalResult()
    folder = legacy_folder()
    try:
        with os.scandir(folder) as scanned:
            entries = [
                entry for entry in scanned if not entry.is_dir(follow_symlinks=False)
            ]
    except FileNotFoundError:
        return result
    total = len(entries)
    if progress:
        progress(0, total)
    for done, entry in enumerate(entries, start=1):
        try:
            size = entry.stat(follow_symlinks=False).st_size
            os.remove(entry.path)
        except OSError as error:
            result.errors.append(f"{entry.name}: {error}")
        else:
            result.removed += 1
            result.freed_bytes += size
        if progress and (done % progress_every == 0 or done == total):
            progress(done, total)
    try:
        os.rmdir(folder)
    except OSError as error:
        # Not empty (a failed file, or something that is not ours): kept.
        logger.info("kept %s: %s", folder, error)
    return result


def remove_small_thumbnails_job(user: User, job_id: str | None = None) -> None:
    """The upgrade task's job. A file that cannot be deleted is listed in the result."""
    job = LongRunningJob.claim(user, LongRunningJob.JOB_REMOVE_SMALL_THUMBNAILS, job_id)
    if job is None:
        return

    def report(done: int, total: int) -> None:
        job.update_progress(done, total)
        job.stop_if_cancelled()

    try:
        result = remove_small_thumbnails(progress=report)
    except JobCancelledError:
        logger.info("job %s was cancelled", job.job_id)
        return
    except Exception as error:
        logger.exception("job %s: could not remove the small thumbnails", job.job_id)
        job.fail(error=error)
        return
    logger.info(
        "job %s: removed %d small thumbnails (%d bytes), %d failed",
        job.job_id,
        result.removed,
        result.freed_bytes,
        len(result.errors),
    )
    job.complete(
        result={
            "status": "completed",
            "removed": result.removed,
            "freed_bytes": result.freed_bytes,
            "error_count": len(result.errors),
            "errors": result.errors[:MAX_JOB_ERRORS],
        }
    )
