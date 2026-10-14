"""What the daily cleanup schedule purges, and emptying the trash.

The schedules are created by ``start_cleaning_service``, which stores them by
dotted path (``api.photos.retention.<name>``); migration 0157 moved the
existing rows here from ``api.services``:

* ``empty_expired_trash``: photos in the trash longer than the admin's
  ``TRASH_RETENTION_DAYS`` (off by default), files and all (#2203);
* ``cleanup_deleted_photos``: the rows of photos whose files are gone;
* ``prune_deletion_log``: old sync tombstones.

``empty_trash_job`` is the Empty trash button's job: every photo in one
user's trash, deleted outside the request.
"""

import logging
from datetime import timedelta

from constance import config as site_config
from django.db.models import Q, QuerySet
from django.utils import timezone

from api.models import DeletionLog, LongRunningJob, Photo, User
from api.models.long_running_job import JobCancelledError
from api.photos.files import Removal, remove_photos

logger = logging.getLogger(__name__)

# The failed photos a job lists in its result; the count covers the rest.
MAX_JOB_ERRORS = 20


def cleanup_deleted_photos() -> None:
    """Delete the rows of photos removed more than 30 days ago.

    One row that fails to delete is logged and skipped, so it cannot stop the
    rest of the day's sweep.
    """
    deleted_photos = Photo.objects.filter(
        Q(removed=True) & Q(last_modified__lte=timezone.now() - timedelta(days=30))
    )
    for photo in deleted_photos:
        try:
            photo.delete()
        except Exception:
            logger.exception(
                "Could not delete removed photo %s, skipping it.", photo.image_hash
            )


def trash_retention_days() -> int:
    """How many days a photo stays in the trash; 0 keeps it until emptied."""
    return max(0, int(site_config.TRASH_RETENTION_DAYS))


def expired_trash(days: int) -> QuerySet[Photo]:
    """Every user's photos trashed more than ``days`` days ago.

    A photo with no ``trashed_at`` (a writer that skipped ``trash_photos``)
    never expires.
    """
    return Photo.objects.filter(
        in_trashcan=True,
        removed=False,
        trashed_at__lte=timezone.now() - timedelta(days=days),
    )


def expired_trash_counts(days: int) -> tuple[int, int]:
    """How many photos, of how many users, a retention of ``days`` deletes now.

    The admin's confirmation before turning the retention on or shortening it.
    """
    photos = expired_trash(days)
    return photos.count(), photos.values("owner_id").distinct().count()


def empty_expired_trash() -> int:
    """Permanently delete the photos past the trash retention (#2203).

    Runs daily. Nothing happens while ``TRASH_RETENTION_DAYS`` is 0, the
    default. Otherwise each expired photo goes the way of Delete permanently
    (``remove_photos``): its files are deleted from disk. A photo that fails
    is logged, skipped and tried again the next day. Returns the number of
    photos deleted.
    """
    days = trash_retention_days()
    if days == 0:
        return 0
    removal = remove_photos(expired_trash(days))
    logger.info(
        "Trash retention (%s days): deleted %s photos, %s failed.",
        days,
        removal.removed,
        len(removal.failed),
    )
    return removal.removed


def _job_details(removal: Removal) -> dict[str, object]:
    """The counts an Empty trash job keeps, with the first failed photos."""
    return {
        "deleted": removal.removed,
        "failed_count": len(removal.failed),
        "failed": [photo.image_hash for photo in removal.failed[:MAX_JOB_ERRORS]],
    }


def empty_trash_job(user: User, job_id: str | None = None) -> None:
    """Permanently delete every photo in ``user``'s trash, as a job (#2203).

    Only ``user``'s own photos. Progress is one step per photo, and a cancel
    stops the job after the photo it is on; the photos deleted until then
    stay deleted. The job fails, with the counts, when a photo could not be
    deleted.
    """
    job = LongRunningJob.claim(user, LongRunningJob.JOB_EMPTY_TRASH, job_id)
    if job is None:
        return
    photos = list(Photo.objects.owned_by(user).filter(in_trashcan=True, removed=False))
    job.update_progress(0, len(photos))

    def report(done: int) -> None:
        job.update_progress(done)
        job.stop_if_cancelled()

    try:
        removal = remove_photos(photos, progress=report)
    except JobCancelledError:
        logger.info("job %s was cancelled", job.job_id)
        return
    details = _job_details(removal)
    if removal.failed:
        logger.warning(
            "job %s: %s photos could not be deleted", job.job_id, len(removal.failed)
        )
        job.fail(
            f"Deleted {removal.removed} photos; {len(removal.failed)} could not"
            " be deleted.",
            details=details,
        )
        return
    job.complete(result={"status": "completed", **details})


def prune_deletion_log() -> int:
    """Drop tombstones past the mobile-v2 sync horizon (doc 04 §2).

    A client whose cursor predates the oldest surviving tombstone can no longer
    trust the delta feed to tell it what was deleted, so it must reseed; the
    sync endpoints answer such a cursor with ``410 cursor_expired``. Keeping
    tombstones beyond that horizon only grows the table.
    """
    horizon = timezone.now() - timedelta(days=DeletionLog.PRUNE_HORIZON_DAYS)
    deleted, _ = DeletionLog.objects.filter(deleted_at__lt=horizon).delete()
    return deleted
