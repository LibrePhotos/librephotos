"""Faces imported a quarter turn off the face, moved onto it once (#2887).

An exporter that turns the pixels and resets Orientation can keep the MWG-RS
face regions of the picture before the turn. Up to 1.5.0 the scan saved such a
region's face where the region says, 90 degrees away from the face: it never
got an encoding, and the face service's detection of the face was saved as a
second, unnamed face. A scan now turns such a region onto the detected face
(``extractor.extract_from_exif``, #2899), but faces saved before stay where
they are: Scan Faces gives the region's name to the detected face and keeps
the face a quarter turn off.

This applies the scan's rule to them, with the faces the photo has that carry
an encoding (the face service found them on this big thumbnail) as the
detections, so the face service is not needed. A face is repaired when

- it has no encoding, is not deleted and is on the big thumbnail;
- its box is exactly where a face region of the file puts it as written, and
  the scan's rule turns that region (its ``AppliedToDimensions`` are a quarter
  turn off the picture, it is on no face with an encoding, and exactly one of
  the two quarter turns is);
- exactly one other face of the photo is on that turn, and it is unnamed or
  labelled with the same person (and was not marked as not that person).

An unnamed face there is the same face found twice: the face takes the turned
box, that face's encoding and a new crop, and the unnamed face is deleted. A
face there with the same person (Scan Faces named it) makes the face a quarter
turn off a duplicate, which is deleted. Every other face stays as it is.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from functools import partial

import PIL.Image
from django.db import transaction
from django.db.models import QuerySet

from api.faces import extractor
from api.faces.geometry import FACE_OVERLAP_IOU_THRESHOLD, calculate_iou
from api.faces.photo_faces import cut_crop
from api.metadata.reader import MetadataReadError, sidecar_files_for_photo
from api.models import Face, LongRunningJob, Person, Photo, User
from api.models.long_running_job import JobCancelledError
from api.thumbnails.face_boxes import FACE_BOX_FIELDS

logger = logging.getLogger(__name__)

# Photos are read this many at a time, each batch in full before its first
# write (an open read cursor and a write lock SQLite, #2890).
BATCH_SIZE = 100

Progress = Callable[[int, int], object]

FaceBox = tuple[int, int, int, int]


@dataclass
class TurnedFaceRepair:
    """What a run read and changed."""

    # Photos whose face regions were read.
    photos: int = 0
    # Faces moved onto the face found there, or deleted as its duplicate.
    repaired: int = 0
    # Faces a quarter turn off that stay: no single face to move them onto.
    skipped: int = 0
    # Photos whose file or big thumbnail could not be read.
    unreadable: int = 0


def photos_to_check(user: User) -> QuerySet[Photo]:
    """``user``'s photos with a face without an encoding and one with.

    Only on such a photo can a face be a quarter turn off a face the face
    service found.
    """
    faces = Face.objects.owned_by(user).filter(deleted=False, video_time__isnull=True)
    return (
        Photo.objects.owned_by(user)
        .filter(pk__in=faces.filter(encoding="").values("photo_id"))
        .filter(pk__in=faces.exclude(encoding="").values("photo_id"))
        .filter(thumbnail__thumbnail_big__isnull=False, main_file__isnull=False)
    )


def _box(face: Face) -> FaceBox:
    return (
        face.location_top,
        face.location_right,
        face.location_bottom,
        face.location_left,
    )


def _regions(
    photo: Photo, detected: list[extractor.FaceLocation] | None
) -> list[extractor.FaceLocation]:
    """The photo's face regions, as the scan reads them with ``detected``."""
    assert photo.main_file is not None  # photos_to_check
    return (
        extractor.extract_from_exif(
            photo.main_file.path,
            photo.thumbnail.thumbnail_big.path,
            sidecar_files_for_photo(photo),
            local_orientation=photo.local_orientation,
            detected_faces=detected,
        )
        or []
    )


def turned_regions(photo: Photo, faces: list[Face]) -> list[tuple[FaceBox, FaceBox]]:
    """(as written, turned) of each region of the photo the scan's rule turns.

    The faces with an encoding are the detections.
    """
    written = _regions(photo, None)
    detected: list[extractor.FaceLocation] = [
        (*_box(face), None) for face in faces if face.encoding
    ]
    checked = _regions(photo, detected)
    if len(written) != len(checked):
        # The file changed between the two reads.
        return []
    pairs = []
    for as_written, as_checked in zip(written, checked, strict=True):
        written_box: FaceBox = as_written[:4]
        turned_box: FaceBox = as_checked[:4]
        if written_box != turned_box:
            pairs.append((written_box, turned_box))
    return pairs


def _the_face_on(turned_box: FaceBox, stale: Face, faces: list[Face]) -> Face | None:
    """The one face ``stale`` can be merged with on ``turned_box``, if there is one."""
    on_turn = [
        face
        for face in faces
        if face.pk != stale.pk
        and calculate_iou(_box(face), turned_box) >= FACE_OVERLAP_IOU_THRESHOLD
    ]
    if len(on_turn) != 1:
        return None
    (face,) = on_turn
    if not face.encoding:
        return None
    if face.person_id is None:
        return face
    if face.person_id == stale.person_id:
        return face
    return None


def _merge(stale: Face, turned_box: FaceBox, found: Face) -> Face:
    """Make ``stale`` the face ``found`` is; returns the one deleted."""
    if found.person_id is not None:
        # Scan Faces already gave the region's name to the face found there,
        # which becomes the cover where the face a quarter turn off was.
        Person.objects.filter(cover_face=stale).update(cover_face=found)
        stale.delete()
        person = Person.objects.get(pk=found.person_id)
        person._calculate_face_count()
        person._set_default_cover_photo()
        return stale
    old_crop = stale.image.name if stale.image else None
    (
        stale.location_top,
        stale.location_right,
        stale.location_bottom,
        stale.location_left,
    ) = turned_box
    stale.encoding = found.encoding
    # A new box and encoding: the face model's earlier "no face here" was
    # about the box a quarter turn off (#2888).
    stale.unmatched_by = ""
    stale.save(update_fields=[*FACE_BOX_FIELDS, "encoding", "unmatched_by"])
    found.delete()
    if cut_crop(stale) and old_crop and old_crop != stale.image.name:
        transaction.on_commit(partial(stale.image.storage.delete, old_crop))
    return found


def _repair_photo(photo: Photo, apply: bool, result: TurnedFaceRepair) -> None:
    faces = list(
        Face.objects.filter(
            photo=photo, deleted=False, video_time__isnull=True
        ).order_by("id")
    )
    for written_box, turned_box in turned_regions(photo, faces):
        stale = next(
            (f for f in faces if not f.encoding and _box(f) == written_box), None
        )
        if stale is None:
            continue
        found = _the_face_on(turned_box, stale, faces)
        if found is None or (
            stale.person_id is not None
            and found.rejected_persons.filter(pk=stale.person_id).exists()
        ):
            result.skipped += 1
            continue
        result.repaired += 1
        if not apply:
            continue
        logger.info(
            "image %s: face %s is a quarter turn off; merged with face %s (#2887)",
            photo.image_hash,
            stale.pk,
            found.pk,
        )
        with transaction.atomic():
            deleted = _merge(stale, turned_box, found)
        faces = [face for face in faces if face is not deleted]


def _photo_ids(users: Iterable[User]) -> list[tuple[User, list[uuid.UUID]]]:
    return [
        (user, list(photos_to_check(user).order_by("pk").values_list("pk", flat=True)))
        for user in users
    ]


def repair_turned_faces(
    users: Iterable[User], apply: bool = True, progress: Progress | None = None
) -> TurnedFaceRepair:
    """Repair the faces a quarter turn off of ``users``' photos.

    Without ``apply`` nothing is written: the result says what would be.
    ``progress(done, total)`` gets the photos read so far; what it raises (a
    cancelled job) stops the run.
    """
    result = TurnedFaceRepair()
    photo_ids = _photo_ids(users)
    total = sum(len(ids) for _, ids in photo_ids)
    if progress:
        progress(0, total)
    for user, ids in photo_ids:
        for start in range(0, len(ids), BATCH_SIZE):
            batch = list(
                photos_to_check(user)
                .filter(pk__in=ids[start : start + BATCH_SIZE])
                .select_related("thumbnail", "main_file")
                .order_by("pk")
            )
            for photo in batch:
                result.photos += 1
                try:
                    _repair_photo(photo, apply, result)
                except MetadataReadError, OSError, PIL.Image.DecompressionBombError:
                    # The file, its sidecar or the big thumbnail; the run goes on.
                    logger.warning(
                        "image %s: could not check its faces for a quarter turn",
                        photo.image_hash,
                        exc_info=True,
                    )
                    result.unreadable += 1
            if progress:
                progress(result.photos, max(total, result.photos))
    return result


def repair_turned_faces_job(user: User, job_id: uuid.UUID | str | None = None) -> None:
    """Repair the faces a quarter turn off of every user's photos; an admin starts it.

    Started from the Finish the upgrade card (``api.jobs.upgrade_tasks``).
    """
    job = LongRunningJob.claim(user, LongRunningJob.JOB_REPAIR_TURNED_FACES, job_id)
    if job is None:
        return

    def report(done: int, total: int) -> None:
        job.update_progress(done, total)
        job.stop_if_cancelled()

    try:
        result = repair_turned_faces(User.objects.order_by("pk"), progress=report)
    except JobCancelledError:
        logger.info("job %s was cancelled", job.job_id)
        return
    except Exception as error:
        logger.exception("job %s: could not repair the turned faces", job.job_id)
        job.fail(error=error)
        return
    logger.info(
        "job %s: %s face(s) repaired, %s left, on %s photo(s)",
        job.job_id,
        result.repaired,
        result.skipped,
        result.photos,
    )
    job.complete(
        result={
            "status": "completed",
            "photos": result.photos,
            "repaired": result.repaired,
            "skipped": result.skipped,
            "unreadable": result.unreadable,
        }
    )
