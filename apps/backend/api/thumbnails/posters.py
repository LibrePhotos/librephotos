"""Make the still posters of the videos an older release scanned (#2026).

A scan now gives every video WebP stills beside its clips, and the grid shows
them until a tile is pointed at. Videos scanned before have only the clips; this
job resizes their stills from the big thumbnail each video already has (its
first frame), so no ffmpeg runs and no original file is read. A video without
a big thumbnail has nothing to make them from and is skipped: a rescan makes
all of its thumbnails.
"""

import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from django.db.models import QuerySet

from api.lazy_import import LazyModule
from api.models import LongRunningJob, Thumbnail
from api.models.long_running_job import JobCancelledError
from api.models.user import User
from api.thumbnails import render

# Loaded when a poster fails: the API server imports this module for the
# upgrade task list and never renders.
if TYPE_CHECKING:
    import pyvips
else:
    pyvips = LazyModule("pyvips")

logger = logging.getLogger(__name__)

# Progress is reported after this many videos: often enough for the job's
# progress bar and its cancel check, rarely enough not to write the row for
# every video.
PROGRESS_EVERY = 100
# How many failed videos a job keeps in its result.
MAX_JOB_ERRORS = 100

Progress = Callable[[int, int], object]


@dataclass
class PosterResult:
    """What a run did: posters made, videos skipped and the ones that failed."""

    made: int = 0
    skipped: int = 0
    errors: list[str] = field(default_factory=list)


def videos_without_posters() -> QuerySet[Thumbnail]:
    """The thumbnails of videos that have no still poster yet, oldest first."""
    return Thumbnail.objects.filter(photo__video=True, video_poster=False).order_by(
        "pk"
    )


def _make_poster(thumbnail: Thumbnail, result: PosterResult) -> None:
    photo_hash = thumbnail.photo.image_hash
    if render.big_thumbnail_size(photo_hash) is None:
        result.skipped += 1
        return
    try:
        render.create_video_posters(thumbnail)
    except (pyvips.Error, OSError, ValueError) as error:
        logger.warning("could not make the poster of video %s: %s", photo_hash, error)
        result.errors.append(f"{photo_hash}: {error}")
        return
    thumbnail.save(update_fields=["video_poster"])
    result.made += 1


def make_video_posters(
    progress: Progress | None = None, progress_every: int = PROGRESS_EVERY
) -> PosterResult:
    """Give every video without a still poster one, where it has a big thumbnail.

    ``progress(done, total)`` is called at the start, every ``progress_every``
    videos and at the end; what it raises (a cancelled job) stops the run.
    """
    result = PosterResult()
    thumbnails = list(videos_without_posters().select_related("photo"))
    total = len(thumbnails)
    if progress:
        progress(0, total)
    for done, thumbnail in enumerate(thumbnails, start=1):
        _make_poster(thumbnail, result)
        if progress and (done % progress_every == 0 or done == total):
            progress(done, total)
    return result


def _job_result(result: PosterResult) -> dict[str, object]:
    return {
        "status": "completed",
        "made": result.made,
        "skipped": result.skipped,
        "error_count": len(result.errors),
        "errors": result.errors[:MAX_JOB_ERRORS],
    }


def make_video_posters_job(user: User, job_id: str | None = None) -> None:
    """The upgrade task's job: posters for the videos of every user.

    A video that fails keeps the clip-only tile it had and is listed in the
    result; it does not fail the job, since nothing is lost without a poster.
    """
    job = LongRunningJob.claim(user, LongRunningJob.JOB_MAKE_VIDEO_POSTERS, job_id)
    if job is None:
        return

    def report(done: int, total: int) -> None:
        job.update_progress(done, total)
        job.stop_if_cancelled()

    try:
        result = make_video_posters(progress=report)
    except JobCancelledError:
        logger.info("job %s was cancelled", job.job_id)
        return
    except Exception as error:
        logger.exception("job %s: could not make video posters", job.job_id)
        job.fail(error=error)
        return
    logger.info(
        "job %s: made %d video posters, skipped %d, %d failed",
        job.job_id,
        result.made,
        result.skipped,
        len(result.errors),
    )
    job.complete(result=_job_result(result))
