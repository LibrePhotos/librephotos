"""Renaming a user's photos after their capture date (#2773).

The owner gives a name pattern (``{year}{month}{day}_{hour}{minute}{second}``,
``api.photos.naming``); each photo of the selection gets the name it makes,
with all its files, in the folder it is in. ``preview_rename`` says what a
rename would do, ``rename_photos`` does it one photo at a time through
``api.photos.files.rename_photo_files``, and ``rename_photos_job`` runs it as
a job for a large selection. The refusals, the selection and the "scan
running" check are the move's (``api.photos.moves``).
"""

from __future__ import annotations

import logging
import os
import uuid
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from typing import Literal

from api.models import LongRunningJob, Photo
from api.models.long_running_job import JobCancelledError
from api.models.user import User
from api.photos.files import (
    MoveError,
    MoveOutcome,
    files_to_move,
    path_key,
    plan_rename,
    rename_photo_files,
)
from api.photos.moves import photos_to_move, refusal
from api.photos.naming import InvalidPatternError, check_name_pattern, render_name

logger = logging.getLogger(__name__)

#: How many photos the preview lists one by one; the rest are only counted.
PREVIEW_ROWS = 20

#: What a rename does with one photo, as the preview lists it.
RenameStatus = Literal["rename", "unchanged", "undated", "refused", "no_free_name"]
RENAME_STATUSES: tuple[RenameStatus, ...] = (
    "rename",
    "unchanged",
    "undated",
    "refused",
    "no_free_name",
)


@dataclass(frozen=True)
class RenameRow:
    """One photo of the preview: its name now and the name it gets."""

    photo_id: uuid.UUID
    image_hash: str
    name: str
    #: The main file's new name; None when the photo keeps its name.
    new_name: str | None
    #: How many more files (RAW, XMP, Live Photo video) get the name with it.
    other_files: int
    status: RenameStatus
    #: The `` (n)`` the new name got because the name was taken (0: none).
    number: int = 0
    #: Why a refused photo keeps its name (``api.photos.moves.REFUSAL_REASONS``).
    reason: str | None = None


@dataclass
class RenamePreview:
    """What renaming a selection would do."""

    photos: int = 0
    files: int = 0
    unchanged: int = 0
    undated: int = 0
    #: Photos that get a `` (n)``: the name was taken, often by a photo of
    #: the same second.
    numbered: int = 0
    no_free_name: int = 0
    refused: dict[str, int] = field(default_factory=dict)
    #: The ``image_hash`` of the undated photos, so the client can set their date.
    undated_hashes: list[str] = field(default_factory=list)
    rows: list[RenameRow] = field(default_factory=list)


def _main_name(photo: Photo) -> str:
    return os.path.basename(photo.main_file.path) if photo.main_file else ""


def _row(photo: Photo, status: RenameStatus, reason: str | None = None) -> RenameRow:
    return RenameRow(
        photo.pk, photo.image_hash, _main_name(photo), None, 0, status, 0, reason
    )


def _preview_photo(
    preview: RenamePreview, photo: Photo, pattern: str, reserved: set[str]
) -> RenameRow:
    """Count ``photo`` into ``preview``; ``reserved`` holds the names taken so far."""
    new_stem = render_name(pattern, photo)
    if new_stem is None:
        preview.undated += 1
        preview.undated_hashes.append(photo.image_hash)
        return _row(photo, "undated")
    reason = refusal(photo)
    if reason is not None:
        preview.refused[reason] = preview.refused.get(reason, 0) + 1
        return _row(photo, "refused", reason)
    sources = files_to_move(photo)
    try:
        planned = plan_rename(photo, sources, new_stem, reserved)
    except MoveError:
        preview.no_free_name += 1
        return _row(photo, "no_free_name")
    if planned is None:
        preview.unchanged += 1
        return _row(photo, "unchanged")
    plan, number = planned
    reserved.update(path_key(dest) for dest in plan.values())
    preview.photos += 1
    preview.files += len(sources)
    preview.numbered += 1 if number else 0
    assert photo.main_file is not None
    return RenameRow(
        photo.pk,
        photo.image_hash,
        _main_name(photo),
        os.path.basename(plan[photo.main_file.path]),
        len(sources) - 1,
        "rename",
        number,
    )


def preview_rename(photos: Iterable[Photo], pattern: str) -> RenamePreview:
    """What ``rename_photos(photos, pattern)`` would do, changing nothing.

    Names are given in the order the photos are renamed, so two photos of
    the same second get ``<name>.jpg`` and ``<name> (1).jpg``. The first
    ``PREVIEW_ROWS`` photos are listed (``rows``), all are counted.
    """
    preview = RenamePreview()
    reserved: set[str] = set()
    for photo in photos:
        row = _preview_photo(preview, photo, pattern, reserved)
        if len(preview.rows) < PREVIEW_ROWS:
            preview.rows.append(row)
    return preview


@dataclass
class RenameResult:
    """What ``rename_photos`` did, in photos."""

    renamed: int = 0
    unchanged: int = 0
    undated: int = 0
    refused: int = 0
    failed: int = 0

    def as_dict(self) -> dict[str, int]:
        return {
            "renamed": self.renamed,
            "unchanged": self.unchanged,
            "undated": self.undated,
            "refused": self.refused,
            "failed": self.failed,
        }


def _rename_one(result: RenameResult, photo: Photo, pattern: str) -> None:
    new_stem = render_name(pattern, photo)
    if new_stem is None:
        result.undated += 1
        return
    if refusal(photo) is not None:
        result.refused += 1
        return
    try:
        outcome = rename_photo_files(photo, new_stem)
    except MoveError as error:
        logger.warning("photo %s was not renamed: %s", photo.image_hash, error)
        result.failed += 1
        return
    if outcome is MoveOutcome.MOVED:
        result.renamed += 1
    else:
        result.unchanged += 1


def rename_photos(
    photos: Iterable[Photo],
    pattern: str,
    progress: Callable[[int], None] | None = None,
) -> RenameResult:
    """Give each of ``photos`` the name ``pattern`` makes, one after the other.

    ``pattern`` passed ``check_name_pattern``. A photo that cannot be
    renamed is counted, not raised: its files keep their old names, and one
    locked file does not stop the rest. ``progress`` gets the number of
    photos handled after each; an exception it raises (a job's cancel)
    stops the loop.
    """
    result = RenameResult()
    for done, photo in enumerate(photos, start=1):
        _rename_one(result, photo, pattern)
        if progress is not None:
            progress(done)
    return result


def rename_photos_job(
    user: User,
    photo_ids: list[uuid.UUID],
    pattern: str,
    job_id: uuid.UUID | str | None = None,
) -> None:
    """The "Rename Photos" job: ``rename_photos`` with progress and cancel.

    A cancel stops after the photo the job is on; the photos renamed until
    then keep their new names.
    """
    job = LongRunningJob.claim(user, LongRunningJob.JOB_RENAME_PHOTOS, job_id)
    if job is None:
        return
    try:
        check_name_pattern(pattern)
    except InvalidPatternError as error:
        job.fail(error=str(error))
        return
    photos = photos_to_move(user, photo_ids)
    job.update_progress(0, len(photos))

    def report(done: int) -> None:
        job.update_progress(done)
        job.stop_if_cancelled()

    try:
        result = rename_photos(photos, pattern, progress=report)
    except JobCancelledError:
        logger.info("job %s was cancelled", job.job_id)
        return
    job.complete(result=result.as_dict())
