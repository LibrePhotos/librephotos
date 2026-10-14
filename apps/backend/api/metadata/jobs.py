"""Background write-back of a user's edits: ratings, captions, locations and tags.

An edit is written to the photo's XMP sidecar or media file when its owner
has ``save_metadata_to_disk`` on. The edit service (``api.metadata.edits``)
queues the write, and the job writes each photo's value as it is when the
job runs, so the files stay off the request and a later edit of the same
photo is never overwritten by an earlier one.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Callable, Collection
from typing import TYPE_CHECKING

from django.db import transaction

from api.jobs.queue import enqueue_task

if TYPE_CHECKING:
    from api.models import Photo, User

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


def queue_field_write(user: User, photo_ids: list[uuid.UUID], field: str) -> None:
    """Queue the write of ``field`` ("caption", "location") for these photos.

    Like ``queue_rating_write``, and queued once the edit commits: a
    rolled-back edit writes nothing, and the job never reads the value from
    before the edit.
    """
    from api.metadata.photo_writer import FIELD_WRITERS, write_target

    if field not in FIELD_WRITERS:
        raise ValueError(f"{field} is not written to files")
    use_sidecar = write_target(user)
    if not photo_ids or use_sidecar is None:
        return
    ids = list(photo_ids)

    def queue() -> None:
        try:
            enqueue_task(write_photo_fields, ids, field, use_sidecar)
        except Exception:
            logger.exception(
                "Could not queue the %s write for %s photos of user %s",
                field,
                len(ids),
                user.id,
            )

    transaction.on_commit(queue)


def queue_keyword_write(
    user: User, photo_ids: list[uuid.UUID], names: Collection[str]
) -> None:
    """Queue the write of the tags ``names`` of these photos as file keywords.

    One job for the whole edit, queued once it commits, like
    ``queue_field_write``. The job writes whether each photo has each tag
    when it runs (``photo_writer.write_keywords``).
    """
    from api.metadata.photo_writer import write_target

    use_sidecar = write_target(user)
    if not photo_ids or not names or use_sidecar is None:
        return
    ids = list(photo_ids)
    tag_names = sorted(set(names))

    def queue() -> None:
        try:
            enqueue_task(write_photo_keywords, ids, tag_names, use_sidecar)
        except Exception:
            logger.exception(
                "Could not queue the keyword write for %s photos of user %s",
                len(ids),
                user.id,
            )

    transaction.on_commit(queue)


def write_photo_ratings(photo_ids: list[uuid.UUID], use_sidecar: bool) -> int:
    """Write each photo's current rating to its file or sidecar; return the failures."""
    return write_photo_fields(photo_ids, "rating", use_sidecar)


def write_photo_keywords(
    photo_ids: list[uuid.UUID], names: list[str], use_sidecar: bool
) -> int:
    """Write the tags ``names`` of each photo as its file keywords; return the failures."""
    from api.metadata.photo_writer import write_keywords

    def write(photo: Photo, use_sidecar: bool) -> None:
        write_keywords(photo, use_sidecar, names)

    return _write_each(photo_ids, "keywords", write, use_sidecar)


def write_photo_fields(
    photo_ids: list[uuid.UUID], field: str, use_sidecar: bool
) -> int:
    """Write each photo's current ``field`` to its file or sidecar.

    One ExifTool process writes them all. A photo whose write fails is
    logged and skipped; returns how many failed.
    """
    from api.metadata.photo_writer import FIELD_WRITERS

    return _write_each(photo_ids, field, FIELD_WRITERS[field], use_sidecar)


def _write_each(
    photo_ids: list[uuid.UUID],
    field: str,
    write: Callable[[Photo, bool], None],
    use_sidecar: bool,
) -> int:
    """Run ``write`` for each photo in one ExifTool process; return the failures."""
    from api.metadata.writer import MetadataWriteError, one_exiftool_process
    from api.models import Photo

    photos = Photo.objects.filter(id__in=photo_ids).select_related("main_file", "owner")
    failures = 0
    with one_exiftool_process():
        for photo in photos.iterator():
            try:
                write(photo, use_sidecar)
            except MetadataWriteError as error:
                failures += 1
                logger.warning(
                    "The %s of photo %s was not written: %s",
                    field,
                    photo.image_hash,
                    error,
                )
            except Exception:
                failures += 1
                logger.exception(
                    "Failed to write the %s of photo %s", field, photo.image_hash
                )
    if failures:
        logger.warning("%s of %s %s writes failed", failures, len(photo_ids), field)
    return failures
