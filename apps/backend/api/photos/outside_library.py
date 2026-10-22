"""A user's photos whose files lie outside their library (#2036).

When an admin points a user at another scan directory, the photos scanned
from the old one stay the user's: nothing is re-assigned to anybody. The user
edit dialog says how many photos the change leaves outside the new library
(``photos_outside_library``) and offers to move them to the user's trash
(``trash_photos_outside_library_job``), from where they can be restored until
the trash is emptied. Files on disk are never touched.

Outside means: the photo's main file is under none of the user's library
roots (scan directory, further library folders of #123, upload folder) and is
not a Nextcloud copy, which the Nextcloud scan keeps in a folder of its own.
Photos already in the trash, and removed ones, are left out. Removing a
further library folder leaves its photos outside in the same way.
"""

import copy
import logging

from django.db.models import Q, QuerySet

from api.models import LongRunningJob, Photo, User
from api.models.album_thing import (
    album_thing_ids_for_photos,
    refresh_album_thing_photo_counts,
)
from api.models.long_running_job import JobCancelledError
from api.models.photo import trash_photos
from api.models.tag import refresh_tag_photo_counts, tag_ids_for_photos
from api.photos.paths import folder_path_q, library_roots, nextcloud_media_root

logger = logging.getLogger(__name__)

#: Photos moved to the trash per step; progress and a cancel land between steps.
BATCH_SIZE = 500


def _inside_any(roots: list[str]) -> Q:
    query = Q()
    for root in roots:
        query |= folder_path_q("main_file__path", root)
    return query


def photos_outside_library(
    user: User,
    scan_directory: str | None = None,
    upload_directory: str | None = None,
) -> QuerySet[Photo]:
    """``user``'s photos outside their library, or outside the one they would have.

    ``scan_directory`` and ``upload_directory`` stand for values not saved
    yet (the edit dialog asks before Save); left out, the stored ones count.
    A user without a scan directory has no library, so nothing is outside it.
    """
    library = copy.copy(user)
    if scan_directory is not None:
        library.scan_directory = scan_directory
    if upload_directory is not None:
        library.upload_directory = upload_directory
    roots = library_roots(library)
    if not roots:
        return Photo.objects.none()
    return (
        Photo.objects.owned_by(user)
        .filter(in_trashcan=False, removed=False, main_file__isnull=False)
        .exclude(_inside_any([*roots, nextcloud_media_root()]))
    )


def _trash(photos: QuerySet[Photo]) -> int:
    """Trash ``photos`` and refresh the counts a queryset update leaves stale."""
    tag_ids = tag_ids_for_photos(photos)
    thing_ids = album_thing_ids_for_photos(photos)
    count = trash_photos(photos)
    refresh_tag_photo_counts(tag_ids)
    refresh_album_thing_photo_counts(thing_ids)
    return count


def trash_photos_outside_library_job(user: User, job_id: str | None = None) -> None:
    """Move ``user``'s photos outside their current library to their trash (#2036).

    Reads the library as it is when the job runs, so it follows the scan
    directory the admin just saved. Only ``user``'s own photos, in steps of
    ``BATCH_SIZE``; a cancel keeps the photos already moved in the trash.
    """
    job = LongRunningJob.claim(
        user, LongRunningJob.JOB_TRASH_PHOTOS_OUTSIDE_LIBRARY, job_id
    )
    if job is None:
        return
    ids = list(photos_outside_library(user).values_list("pk", flat=True))
    job.update_progress(0, len(ids))
    moved = 0
    try:
        for start in range(0, len(ids), BATCH_SIZE):
            batch = Photo.objects.owned_by(user).filter(
                pk__in=ids[start : start + BATCH_SIZE]
            )
            moved += _trash(batch)
            job.update_progress(min(start + BATCH_SIZE, len(ids)))
            job.stop_if_cancelled()
    except JobCancelledError:
        logger.info("job %s was cancelled after %s photos", job.job_id, moved)
        return
    logger.info("job %s moved %s photos to the trash", job.job_id, moved)
    job.complete(result={"status": "completed", "trashed_count": moved})
