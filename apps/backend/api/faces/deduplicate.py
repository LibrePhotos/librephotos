"""Deleting the duplicate faces of photos (#1918, #2030).

Two faces of one photo whose boxes overlap (``FACE_OVERLAP_IOU_THRESHOLD``)
are one face found twice, for example by an old scan and by an XMP region
import. The face with a person label is kept; when both or neither have one,
the older face is. Scans no longer save such duplicates; this cleans up the
ones saved before.

Three ways in, one function: ``manage.py deduplicate_faces``, the Admin Area
job (``deduplicate_faces_job``) and the Django admin's "Deduplicate faces"
action on selected photos.
"""

import logging
import uuid
from collections import defaultdict
from collections.abc import Callable, Iterator
from dataclasses import dataclass

from django.db.models import Count

from api.faces.geometry import FACE_OVERLAP_IOU_THRESHOLD, calculate_iou
from api.models import Face, LongRunningJob, Person, Photo
from api.models.long_running_job import JobCancelledError
from api.models.user import User

logger = logging.getLogger(__name__)

# Photos are read and their faces compared this many at a time.
DEDUPLICATE_FACES_CHUNK_SIZE = 500

Progress = Callable[[int, int], object]


def _box(face: Face) -> tuple[int, int, int, int]:
    return (
        face.location_top,
        face.location_right,
        face.location_bottom,
        face.location_left,
    )


def _duplicate_of(face_a: Face, face_b: Face) -> int | None:
    """The id of the face to delete when ``face_a`` and ``face_b`` are one face.

    The labelled face stays; when both or neither are labelled, ``face_a``
    (the older one) does. Faces from two frames of a video are never one
    face, however their boxes overlap (#2761): the scan keeps one face per
    person and video already.
    """
    if face_a.video_time != face_b.video_time:
        return None
    if calculate_iou(_box(face_a), _box(face_b)) < FACE_OVERLAP_IOU_THRESHOLD:
        return None
    if face_b.person_id and not face_a.person_id:
        return face_a.id
    return face_b.id


def duplicate_face_ids(faces: list[Face]) -> set[int]:
    """The ids of the faces of one photo that duplicate another face of it.

    ``faces`` are in id order, so the older of two duplicates is first.
    """
    to_delete: set[int] = set()
    for i, face_a in enumerate(faces):
        for face_b in faces[i + 1 :]:
            if face_a.id in to_delete:
                break
            if face_b.id in to_delete:
                continue
            duplicate = _duplicate_of(face_a, face_b)
            if duplicate is not None:
                to_delete.add(duplicate)
    return to_delete


def deduplicate_faces_of_photos(photo_ids: list[uuid.UUID]) -> int:
    """Delete the duplicate faces of these photos; returns how many went.

    The people who lost a face get their count and cover again.
    """
    faces_by_photo: defaultdict[uuid.UUID | None, list[Face]] = defaultdict(list)
    # `encoding` holds a face vector per row, so it is deliberately left out.
    for face in (
        Face.objects.filter(photo_id__in=photo_ids)
        .only(
            "photo_id",
            "person_id",
            "location_top",
            "location_bottom",
            "location_left",
            "location_right",
            "video_time",
        )
        .order_by("id")
    ):
        faces_by_photo[face.photo_id].append(face)

    to_delete: set[int] = set()
    for faces in faces_by_photo.values():
        to_delete |= duplicate_face_ids(faces)
    if not to_delete:
        return 0
    deleted = Face.objects.filter(id__in=to_delete)
    person_ids = set(deleted.exclude(person=None).values_list("person_id", flat=True))
    deleted.delete()
    for person in Person.objects.filter(id__in=person_ids):
        person._calculate_face_count()
        person._set_default_cover_photo()
    return len(to_delete)


def photo_ids_with_faces(user: User | None = None) -> list[uuid.UUID]:
    """The ids of the photos with two faces or more: ``user``'s, or everyone's."""
    photos = Photo.objects.all() if user is None else Photo.objects.owned_by(user)
    return list(
        photos.filter(faces__isnull=False)
        .values("id")
        .annotate(face_count=Count("faces"))
        .filter(face_count__gt=1)
        .order_by("id")
        .values_list("id", flat=True)
    )


def _chunks(ids: list[uuid.UUID], size: int) -> Iterator[list[uuid.UUID]]:
    for start in range(0, len(ids), size):
        yield ids[start : start + size]


@dataclass(frozen=True)
class DeduplicateResult:
    """What a deduplication run went through and deleted."""

    photos: int
    deleted: int


def deduplicate_faces(
    user: User | None = None,
    chunk_size: int = DEDUPLICATE_FACES_CHUNK_SIZE,
    progress: Progress | None = None,
) -> DeduplicateResult:
    """Delete the duplicate faces of ``user``'s photos, or of every photo.

    ``progress(done, total)`` gets the photos checked after each chunk; what
    it raises (a cancelled job) stops the run between chunks.
    """
    photo_ids = photo_ids_with_faces(user)
    deleted = 0
    done = 0
    for chunk in _chunks(photo_ids, max(1, chunk_size)):
        deleted += deduplicate_faces_of_photos(chunk)
        done += len(chunk)
        if progress is not None:
            progress(done, len(photo_ids))
    return DeduplicateResult(photos=len(photo_ids), deleted=deleted)


def deduplicate_faces_job(user: User, job_id: uuid.UUID | str | None = None) -> bool:
    """The job an admin starts from the Admin Area: every user's photos (#2030).

    Returns whether it completed.
    """
    lrj = LongRunningJob.claim(user, LongRunningJob.JOB_DEDUPLICATE_FACES, job_id)
    if lrj is None:
        return False

    def report(done: int, total: int) -> None:
        lrj.update_progress(current=done, target=total)
        lrj.stop_if_cancelled()

    try:
        lrj.update_progress(current=0, target=0)
        result = deduplicate_faces(progress=report)
        logger.info(
            "Face deduplication job %s deleted %s face(s) on %s photo(s)",
            lrj.job_id,
            result.deleted,
            result.photos,
        )
        return lrj.complete(result={"photos": result.photos, "deleted": result.deleted})
    except JobCancelledError:
        logger.info("Face deduplication job %s was cancelled", lrj.job_id)
        return False
    except Exception as err:
        logger.exception("Face deduplication job %s failed", lrj.job_id)
        lrj.fail(error=err)
        return False
