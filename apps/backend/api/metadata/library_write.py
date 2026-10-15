"""Writing the edits already in the library to the files: the "Write metadata to files" job (#2287).

"Write edits to files" only writes the edits made after it was turned on.
This job writes what the database already holds for a user's photos, through
the same writers the live edits use (``api.metadata.photo_writer``): each
write is verified and recorded as LibrePhotos' own, so the next scan does not
read the photo again for it (#2678).

Only a value that says something is written: a rating above 0, a date or
position set by hand, a turn, a caption, tags, faces. A photo with none of
the chosen kinds is not part of the job, so an unrated library gets no
sidecar per photo. ``manage.py save_metadata`` writes through ``write_photos``
as well.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, field

from django.db.models import Q, QuerySet

from api.directory_watcher.utils import is_job_cancelled, update_batch_counter
from api.jobs.queue import enqueue_task
from api.metadata.photo_writer import (
    FIELD_WRITERS,
    keeps_edits,
    write_caption,
    write_keywords,
    write_location,
    write_photo_metadata,
    write_rotation,
    write_target,
)
from api.metadata.writer import MetadataWriteError, one_exiftool_process
from api.models import LongRunningJob, Photo, Tag, User
from api.models.photo import LocationSource

logger = logging.getLogger(__name__)

#: Photos per queued task: the progress and a cancel are seen per batch, and
#: one ExifTool process writes a batch.
BATCH_SIZE = 200

# Keys of the job's ``result`` next to the failed items (``error_count``,
# ``errors``): the photos written, and the ones left alone because their
# file does not keep edits (a Nextcloud copy) or the setting changed.
WRITTEN = "written"
SKIPPED = "skipped"
TYPES = "types"

Writer = Callable[[Photo, bool], None]


def _write_keywords(photo: Photo, use_sidecar: bool) -> None:
    """Add every tag of the photo to the file's keywords (``write_keywords``)."""
    names = (
        Tag.objects.owned_by(photo.owner)
        .filter(photos=photo)
        .values_list("name", flat=True)
    )
    write_keywords(photo, use_sidecar, list(names))


def _write_face_regions(photo: Photo, use_sidecar: bool) -> None:
    """Write the photo's faces as MWG regions, as labelling a face does."""
    write_photo_metadata(photo, use_sidecar=use_sidecar, metadata_types=["face_tags"])


@dataclass(frozen=True)
class WriteType:
    """One kind of metadata the job writes: the photos that carry it, and its writer."""

    carries_value: Q
    write: Writer


#: What can be written, in the order a photo's writes run. The names are the
#: ``types`` of ``POST /api/savemetadata/`` and ``manage.py save_metadata``.
WRITE_TYPES: dict[str, WriteType] = {
    "ratings": WriteType(Q(rating__gt=0), FIELD_WRITERS["rating"]),
    "dates": WriteType(Q(timestamp__isnull=False), FIELD_WRITERS["date_taken"]),
    "rotations": WriteType(~Q(local_orientation=1), write_rotation),
    "captions": WriteType(
        Q(caption_instance__captions_json__user_caption__isnull=False)
        & ~Q(caption_instance__captions_json__user_caption=""),
        write_caption,
    ),
    "locations": WriteType(
        Q(
            location_source=LocationSource.USER,
            exif_gps_lat__isnull=False,
            exif_gps_lon__isnull=False,
        ),
        write_location,
    ),
    "keywords": WriteType(Q(tags__isnull=False), _write_keywords),
    "face_tags": WriteType(Q(faces__deleted=False), _write_face_regions),
}

#: Written only when the owner also has "Write face tags to image files" on.
FACE_TAGS = "face_tags"


def writable_types(user: User) -> list[str]:
    """Every type, without face tags unless ``user`` has "Write face tags to image files" on."""
    return [
        name for name in WRITE_TYPES if name != FACE_TAGS or user.save_face_tags_to_disk
    ]


def types_written_for(user: User) -> list[str]:
    """The types ``user``'s settings write: none while "Write edits to files" is Off."""
    if write_target(user) is None:
        return []
    return writable_types(user)


def _library(user: User) -> QuerySet[Photo]:
    """``user``'s photos whose file is there to write to."""
    return (
        Photo.objects.owned_by(user)
        .filter(removed=False, main_file__isnull=False)
        .exclude(main_file__missing=True)
    )


def _carrying(types: Iterable[str]) -> Q:
    """Photos carrying a value of any of ``types``."""
    condition = Q(pk__in=[])
    for name in types:
        condition |= WRITE_TYPES[name].carries_value
    return condition


def photos_to_write(user: User, types: Sequence[str]) -> QuerySet[Photo]:
    """``user``'s photos that have something of ``types`` to write."""
    return _library(user).filter(_carrying(types)).distinct()


def count_photos_to_write(user: User, types: Sequence[str]) -> dict[str, int]:
    """How many of ``user``'s photos each of ``types`` writes."""
    library = _library(user)
    return {
        name: library.filter(WRITE_TYPES[name].carries_value).distinct().count()
        for name in types
    }


@dataclass
class WriteOutcome:
    """What ``write_photos`` did: photos written, skipped, and the failures."""

    written: int = 0
    skipped: int = 0
    errors: list[str] = field(default_factory=list)


def _types_by_photo(
    photos: QuerySet[Photo], types: Sequence[str]
) -> dict[uuid.UUID, list[str]]:
    """For each of ``photos``, the ``types`` it carries a value of, in order."""
    found: dict[uuid.UUID, list[str]] = {}
    for name in types:
        carrying = photos.filter(WRITE_TYPES[name].carries_value).values_list(
            "pk", flat=True
        )
        for pk in set(carrying):
            found.setdefault(pk, []).append(name)
    return found


def _write_photo(photo: Photo, types: Sequence[str], use_sidecar: bool) -> str | None:
    """Write ``types`` of one photo; what failed, as one line for the job page, or None."""
    assert photo.main_file is not None
    failures: list[str] = []
    for name in types:
        try:
            WRITE_TYPES[name].write(photo, use_sidecar)
        except MetadataWriteError as error:
            logger.warning(
                "The %s of photo %s were not written: %s",
                name,
                photo.image_hash,
                error,
            )
            failures.append(f"{name}: {error}")
        except Exception:
            logger.exception(
                "Failed to write the %s of photo %s", name, photo.image_hash
            )
            failures.append(f"{name}: could not be written")
    if not failures:
        return None
    return f"{photo.main_file.path}: {'; '.join(failures)}"


def write_photos(
    user: User, photo_ids: Sequence[uuid.UUID], types: Sequence[str], use_sidecar: bool
) -> WriteOutcome:
    """Write ``types`` of ``user``'s photos ``photo_ids`` in one ExifTool process.

    Each photo gets only the types it carries a value of. A photo with none,
    or whose file does not keep edits (a local copy of a Nextcloud file), is
    skipped; a photo with a failed write counts as failed, not written.
    """
    photos = (
        Photo.objects.owned_by(user)
        .filter(pk__in=photo_ids)
        .select_related("owner", "main_file")
    )
    types_of = _types_by_photo(photos, types)
    outcome = WriteOutcome()
    with one_exiftool_process():
        for photo in photos.iterator():
            carried = types_of.get(photo.pk)
            if not carried or not keeps_edits(photo):
                outcome.skipped += 1
                continue
            error = _write_photo(photo, carried, use_sidecar)
            if error is not None:
                outcome.errors.append(error)
            else:
                outcome.written += 1
    return outcome


def write_library_metadata(
    user: User, types: list[str], job_id: uuid.UUID | str | None = None
) -> None:
    """The job: queue the batches that write ``types`` of ``user``'s photos.

    Written where the user's "Write edits to files" says when the job starts;
    a batch that finds the setting changed since writes nothing. The job
    finishes when the last batch has reported (``update_batch_counter``).
    """
    job = LongRunningJob.claim(user, LongRunningJob.JOB_WRITE_METADATA, job_id)
    if job is None:
        return
    try:
        use_sidecar = write_target(user)
        if use_sidecar is None:
            job.fail(error="Write edits to files is Off")
            return
        photo_ids = list(
            photos_to_write(user, types).order_by("pk").values_list("pk", flat=True)
        )
        job.set_result({WRITTEN: 0, SKIPPED: 0, TYPES: types})
        job.update_progress(current=0, target=len(photo_ids))
        if not photo_ids:
            job.complete()
            return
        for start in range(0, len(photo_ids), BATCH_SIZE):
            if is_job_cancelled(job.job_id):
                logger.info("job %s was cancelled", job.job_id)
                return
            batch = photo_ids[start : start + BATCH_SIZE]
            enqueue_task(
                write_metadata_batch, user.pk, batch, types, use_sidecar, job.job_id
            )
    except Exception as error:
        logger.exception("job %s: could not write metadata to files", job.job_id)
        job.fail(error=error)


def write_metadata_batch(
    user_id: int,
    photo_ids: list[uuid.UUID],
    types: list[str],
    use_sidecar: bool,
    job_id: str,
) -> None:
    """Write one batch of job ``job_id`` and report it (``write_photos``).

    A batch still queued when the job was cancelled does nothing. One that
    finds the owner's write target changed (Off, or the other mode) skips its
    photos rather than write where the user no longer wants it.
    """
    if is_job_cancelled(job_id):
        return
    user = User.objects.filter(pk=user_id).first()
    if user is None or write_target(user) != use_sidecar:
        update_batch_counter(job_id, len(photo_ids), {SKIPPED: len(photo_ids)}, [])
        return
    outcome = write_photos(user, photo_ids, types, use_sidecar)
    update_batch_counter(
        job_id,
        len(photo_ids),
        {WRITTEN: outcome.written, SKIPPED: outcome.skipped},
        outcome.errors,
    )
