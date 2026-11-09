"""Give the photos an older release scanned their grid placeholder (ThumbHash).

A scan now stores each photo's ThumbHash beside its dominant colour, and the
grid shows it until the thumbnail has loaded instead of loading a small
thumbnail first. Photos scanned before have none; this job samples it from the
thumbnails they already have, so no original file is read. A photo whose
thumbnail cannot be read keeps its dominant colour as the placeholder.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass

from django.db.models import QuerySet

from api.models import LongRunningJob, Thumbnail
from api.models.long_running_job import JobCancelledError
from api.models.user import User
from api.thumbnails import render

logger = logging.getLogger(__name__)

# Photos read and written per round: one query to read them, one to save.
BATCH_SIZE = 500

Progress = Callable[[int, int], object]


@dataclass
class PlaceholderResult:
    """What a run did: placeholders made, and photos whose thumbnail was unreadable."""

    made: int = 0
    skipped: int = 0


def thumbnails_without_thumbhash() -> QuerySet[Thumbnail]:
    """The thumbnails of photos that have no ThumbHash yet, in key order."""
    return Thumbnail.objects.filter(thumbhash__isnull=True).order_by("pk")


def make_thumbhashes(
    progress: Progress | None = None, batch_size: int = BATCH_SIZE
) -> PlaceholderResult:
    """Give every photo without a ThumbHash one, from its thumbnail.

    ``progress(done, total)`` is called at the start and after every batch;
    what it raises (a cancelled job) stops the run. Pages by key, so the
    photos that stay without one (unreadable) are not read again.
    """
    result = PlaceholderResult()
    pending = thumbnails_without_thumbhash()
    total = pending.count()
    if progress:
        progress(0, total)
    done = 0
    last_pk = None
    while True:
        page = pending.select_related("photo")
        if last_pk is not None:
            page = page.filter(pk__gt=last_pk)
        batch = list(page[:batch_size])
        if not batch:
            break
        last_pk = batch[-1].pk
        made = []
        for thumbnail in batch:
            thumbnail.thumbhash = render.thumbhash_of(thumbnail)
            if thumbnail.thumbhash is None:
                result.skipped += 1
            else:
                made.append(thumbnail)
        Thumbnail.objects.bulk_update(made, ["thumbhash"])
        result.made += len(made)
        done += len(batch)
        if progress:
            progress(min(done, total), total)
    return result


def make_thumbhashes_job(user: User, job_id: str | None = None) -> None:
    """The upgrade task's job: placeholders for the photos of every user.

    A photo whose thumbnail cannot be read is counted in the result; it does
    not fail the job, since its tile keeps the dominant colour.
    """
    job = LongRunningJob.claim(user, LongRunningJob.JOB_MAKE_THUMBHASHES, job_id)
    if job is None:
        return

    def report(done: int, total: int) -> None:
        job.update_progress(done, total)
        job.stop_if_cancelled()

    try:
        result = make_thumbhashes(progress=report)
    except JobCancelledError:
        logger.info("job %s was cancelled", job.job_id)
        return
    except Exception as error:
        logger.exception("job %s: could not make photo placeholders", job.job_id)
        job.fail(error=error)
        return
    logger.info(
        "job %s: made %d photo placeholders, %d thumbnails unreadable",
        job.job_id,
        result.made,
        result.skipped,
    )
    job.complete(
        result={"status": "completed", "made": result.made, "skipped": result.skipped}
    )
