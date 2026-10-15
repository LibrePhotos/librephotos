"""Applying the owner's current date rules to the photos already in the library (#437).

Changing the date rules only affects photos scanned afterwards; this job reads
the date of every photo again with the rules as they are now, without the rest
of a rescan. A date the user set by hand stays (#2254), nothing is written to
the files, and each photo whose date changes moves to its new day album and
syncs to the phone again (``last_modified``).
"""

from __future__ import annotations

import logging
import uuid

from django.db import transaction
from django.db.models import QuerySet

from api.directory_watcher.utils import is_job_cancelled, update_batch_counter
from api.jobs.queue import enqueue_task
from api.metadata import takeout
from api.metadata.photo_datetime import reapply_date_rules
from api.models import LongRunningJob, Photo, User

logger = logging.getLogger(__name__)

#: Photos per queued task: the progress and a cancel are seen per batch.
BATCH_SIZE = 200

# Keys of the job's ``result``: the photos that moved to another date, the
# ones whose date stayed, and the ones that keep the date set by hand.
MOVED = "moved"
UNCHANGED = "unchanged"
KEPT_HAND_SET = "kept_hand_set"


def photos_with_hand_set_date(user: User) -> QuerySet[Photo]:
    """The user's photos whose date was set by hand: the rules leave them alone."""
    return Photo.objects.owned_by(user).filter(timestamp__isnull=False)


def photos_to_redate(user: User) -> QuerySet[Photo]:
    """The user's photos the date rules decide the date of.

    Those without a hand-set date whose main file is still there: a photo
    whose file is gone keeps the date it was scanned with.
    """
    return (
        Photo.objects.owned_by(user)
        .filter(timestamp__isnull=True, removed=False, main_file__isnull=False)
        .exclude(main_file__missing=True)
    )


def reapply_date_rules_job(user: User, job_id: uuid.UUID | str | None = None) -> None:
    """Queue the batches that read each photo's date again (``reapply_date_rules``).

    The job finishes when the last batch has reported (``update_batch_counter``);
    its result counts the photos moved, unchanged and kept with a hand-set date.
    """
    job = LongRunningJob.claim(user, LongRunningJob.JOB_REAPPLY_DATE_RULES, job_id)
    if job is None:
        return
    try:
        photo_ids = list(
            photos_to_redate(user).order_by("pk").values_list("pk", flat=True)
        )
        kept = photos_with_hand_set_date(user).count()
        job.set_result({MOVED: 0, UNCHANGED: 0, KEPT_HAND_SET: kept})
        job.update_progress(current=0, target=len(photo_ids))
        if not photo_ids:
            job.complete()
            return
        for start in range(0, len(photo_ids), BATCH_SIZE):
            if is_job_cancelled(job.job_id):
                logger.info("job %s was cancelled", job.job_id)
                return
            batch = photo_ids[start : start + BATCH_SIZE]
            enqueue_task(reapply_date_rules_batch, batch, job.job_id)
    except Exception as error:
        logger.exception("job %s: could not apply the date rules", job.job_id)
        job.fail(error=error)


def reapply_date_rules_batch(photo_ids: list[uuid.UUID], job_id: str) -> None:
    """Read the date of ``photo_ids`` again and report the batch to job ``job_id``.

    A batch still queued when the job was cancelled does nothing. A photo
    whose date cannot be read is a failed item of the job; the others go on.
    A directory is listed at most once a batch for Google Takeout JSON.
    """
    if is_job_cancelled(job_id):
        return
    with takeout.directory_listings():
        _reapply_batch(photo_ids, job_id)


def _reapply_batch(photo_ids: list[uuid.UUID], job_id: str) -> None:
    moved = unchanged = 0
    errors: list[str] = []
    photos = Photo.objects.filter(pk__in=photo_ids).select_related("owner", "main_file")
    for photo in photos:
        try:
            with transaction.atomic():
                changed = reapply_date_rules(photo)
        except Exception as error:
            logger.exception(
                "job %s: could not read the date of %s", job_id, photo.image_hash
            )
            errors.append(f"Photo {photo.image_hash}: {error}")
            continue
        if changed:
            moved += 1
        else:
            unchanged += 1
    update_batch_counter(
        job_id, len(photo_ids), {MOVED: moved, UNCHANGED: unchanged}, errors
    )
