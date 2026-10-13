"""
Repair jobs for fixing ungrouped file variants.

This module contains jobs that repair data inconsistencies, such as
RAW files that weren't properly grouped with their JPEG counterparts
due to race conditions in previous scans.
"""

import logging
from uuid import UUID

from api.directory_watcher.file_grouping import find_matching_jpeg_photo
from api.models import File, LongRunningJob, Photo, User
from api.models.long_running_job import JobCancelledError

logger = logging.getLogger(__name__)


def _promote_image_main_file(raw_photo: Photo) -> bool:
    image_file = raw_photo.files.filter(type=File.IMAGE).first()
    if not image_file:
        return False

    raw_photo.main_file = image_file
    raw_photo.video = False
    raw_photo.save(update_fields=["main_file", "video"])
    return True


def _merge_raw_into_jpeg_photo(raw_photo: Photo, user: User, job_id: UUID) -> bool:
    # Only called for photos picked by ``main_file__type=RAW_FILE``, which
    # requires a main file.
    assert raw_photo.main_file is not None
    jpeg_photo = find_matching_jpeg_photo(raw_photo.main_file.path, user)
    if not jpeg_photo or jpeg_photo.id == raw_photo.id:
        return False

    for f in raw_photo.files.all():
        if not jpeg_photo.files.filter(hash=f.hash).exists():
            jpeg_photo.files.add(f)

    jpeg_photo.save()
    raw_photo.delete()
    logger.info(
        "job %s: Merged RAW photo into JPEG photo %s", job_id, jpeg_photo.image_hash
    )
    return True


def repair_ungrouped_file_variants(user: User, job_id: UUID) -> None:
    """
    Post-scan job to fix any ungrouped file variants.

    This handles:
    1. Race conditions from previous scans where RAW+JPEG weren't grouped
    2. Rescans where files were added incrementally
    3. Any orphaned RAW/metadata files that should be attached to existing Photos

    Strategy: Find Photos with RAW-only main_file, look for matching JPEG Photos,
    merge the RAW file into the JPEG Photo and delete the RAW-only Photo.

    Args:
        user: The user whose photos to repair
        job_id: Job ID for tracking progress
    """
    lrj = LongRunningJob.claim(user, LongRunningJob.JOB_REPAIR_FILE_VARIANTS, job_id)
    if lrj is None:
        return

    try:
        # Find Photos where main_file is RAW (potential orphans)
        raw_only_photos = Photo.objects.owned_by(user).filter(
            main_file__type=File.RAW_FILE
        )

        lrj.update_progress(current=0, target=raw_only_photos.count())

        merged_count = 0
        fixed_main_file_count = 0

        for raw_photo in raw_only_photos:
            lrj.stop_if_cancelled()
            if _promote_image_main_file(raw_photo):
                fixed_main_file_count += 1
            elif _merge_raw_into_jpeg_photo(raw_photo, user, job_id):
                merged_count += 1

        logger.info(
            "job %s: Repaired %s ungrouped file variants, "
            "fixed %s main_file priorities",
            job_id,
            merged_count,
            fixed_main_file_count,
        )
        lrj.complete()

    except JobCancelledError:
        logger.info("job %s: repairing file variants was cancelled", job_id)
    except Exception as e:
        logger.exception("job %s: Error repairing file variants: %s", job_id, e)
        lrj.fail(error=e)
