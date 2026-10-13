"""Background rating writes for bulk rating edits.

A rating edit is written to the photo's XMP sidecar or media file when its
owner has ``save_metadata_to_disk`` on. Bulk edits change the rating with a
single queryset ``update()``; they queue ``write_photo_ratings`` so the files
are written off the request.
"""

from __future__ import annotations

import logging
import uuid
from typing import TYPE_CHECKING

from api.jobs.queue import enqueue_task

if TYPE_CHECKING:
    from api.models import User

logger = logging.getLogger(__name__)


def queue_rating_write(user: User, photo_ids: list[uuid.UUID]) -> None:
    """Queue the rating write for these photos.

    Follows the owner's ``save_metadata_to_disk`` setting (``write_target``):
    nothing when it is off, the XMP sidecar or the media file otherwise. A
    failure to queue is logged and swallowed; the database change it follows
    has already been made and is what the request reports.
    """
    from api.metadata.photo_writer import write_target

    use_sidecar = write_target(user)
    if not photo_ids or use_sidecar is None:
        return
    try:
        enqueue_task(write_photo_ratings, list(photo_ids), use_sidecar)
    except Exception:
        logger.exception(
            "Could not queue the rating write for %s photos of user %s",
            len(photo_ids),
            user.id,
        )


def write_photo_ratings(photo_ids: list[uuid.UUID], use_sidecar: bool) -> int:
    """Write each photo's current rating to its file or sidecar.

    One ExifTool process writes them all. A photo whose write fails is
    logged and skipped; returns how many failed.
    """
    from api.metadata.photo_writer import write_photo_metadata
    from api.metadata.writer import MetadataWriteError, one_exiftool_process
    from api.models import Photo

    photos = Photo.objects.filter(id__in=photo_ids).select_related("main_file")
    failures = 0
    with one_exiftool_process():
        for photo in photos.iterator():
            try:
                write_photo_metadata(
                    photo, modified_fields=["rating"], use_sidecar=use_sidecar
                )
            except MetadataWriteError as error:
                failures += 1
                logger.warning(
                    "The rating of photo %s was not written: %s",
                    photo.image_hash,
                    error,
                )
            except Exception:
                failures += 1
                logger.exception(
                    "Failed to write the rating of photo %s", photo.image_hash
                )
    if failures:
        logger.warning("%s of %s rating writes failed", failures, len(photo_ids))
    return failures
