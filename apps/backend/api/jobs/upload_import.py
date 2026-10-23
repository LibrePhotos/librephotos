"""An import job per user for uploads (#2737, #2191 Phase 1).

Uploads had no job: nothing could say "processing 12 of 40", and the error of
a photo whose processing failed was only in the log. Every upload that makes
a photo is now counted in its user's open **Import Uploads** job
(``LongRunningJob.JOB_IMPORT_UPLOADS``):

- ``attach_upload(user)``: ``/api/upload/complete/`` calls it once the photo
  row exists. It adds one to the open job's target, or opens the job; the
  ``lrj_one_open_upload_import`` constraint keeps it to one per user.
  Duplicates, refused files and files that make no photo (a sidecar,
  embedded media) are not counted.
- ``import_uploaded_photo(...)``: the task that runs the upload's steps
  (``UPLOAD_STEPS``) and then counts it on the job once, done or failed.
- ``seal_upload_imports(jobs)``: the jobs take no more files, so they can
  finish; a file after that opens a new job. The web app seals when its
  upload queue drains (``POST /api/upload/seal/``). ``sweep_upload_imports``
  (every minute) seals jobs that took no file for ``IDLE_SEAL``, the path of
  mobile backup, which uploads one file at a time with no end.
- A sealed job finishes once every file is counted
  (``finish_job_if_complete``), and requests the user's follow-ups
  (``on_import_finished``, ``api.jobs.upload_followups``).
- ``sweep_upload_imports`` also finishes lost jobs: sealed, short of their
  target, no progress for ``LOST_AFTER`` and nothing waiting in the queue, so
  a worker died holding their tasks. The missing files count as failed and the
  follow-ups still run.

What a client reads from the job row (``GET /api/jobs/``):
``progress_target`` uploads counted, ``progress_current`` of them processed
(done or failed; a task that ran after the job was finished as lost can push
it past the target, so clamp it), and in ``result``:

- ``stages``: per step of ``UPLOAD_STEPS``, how many photos went through it
  without an error (a step with nothing to do counts as done);
- ``failed_files``: the last ``FAILED_FILES_KEPT`` photos with an error,
  ``{"photo_id", "file", "stage", "error"}``, ``stage`` being the first step
  that failed (``photo_id`` is what ``/api/upload/complete/`` answered);
- ``error_count``, ``errors``, ``status``: as every job has them;
- ``lost``: files never processed, set when the sweeper finished a lost job;
- ``followups_requested``: true once the job finished and asked for the
  follow-ups.
"""

from __future__ import annotations

import logging
import os
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from django.db import IntegrityError, transaction
from django.db.models import F, Q
from django.utils import timezone

from api.albums.user_albums import add_photo_to_user_album
from api.directory_watcher.file_handlers import (
    apply_device_timestamp_fallback,
    process_uploaded_photo,
)
from api.directory_watcher.utils import (
    finish_job_if_complete,
    record_item_error,
    update_job_result,
)
from api.faces.photo_faces import extract_faces
from api.geocode.photo_location import add_location_to_album_dates, geolocate_photo
from api.jobs.queue import tasks_are_waiting
from api.jobs.upload_followups import request_upload_followups
from api.metadata.datetime_rules import CaptureTime
from api.models import LongRunningJob, Photo, User
from api.models.long_running_job import LongRunningJobQuerySet
from api.models.photo_caption import PhotoCaption
from api.search import semantic

logger = logging.getLogger(__name__)

# A job that took no file for this long is sealed by the sweeper.
IDLE_SEAL = timedelta(minutes=3)
# A sealed job with no progress for this long, while the queue is empty, has
# lost tasks. One upload's steps (a long video) must fit in it.
LOST_AFTER = timedelta(minutes=30)
# How many failed photos ``result["failed_files"]`` keeps, the newest.
FAILED_FILES_KEPT = 100

SWEEP_FUNC = "api.jobs.upload_import.sweep_upload_imports"


def _import_jobs() -> LongRunningJobQuerySet:
    return LongRunningJob.objects.filter(job_type=LongRunningJob.JOB_IMPORT_UPLOADS)


def _count_in_open_job(user: User, now: datetime) -> LongRunningJob | None:
    """Add one upload to the user's open job; ``None`` when there is none."""
    open_jobs = LongRunningJob.objects.owned_by(user).open_upload_imports()
    job = open_jobs.only("pk", "job_id").first()
    if job is None:
        return None
    # Conditional: a seal between the read and this write leaves the job
    # alone, and the upload goes into a new one.
    if open_jobs.filter(pk=job.pk).update(
        progress_target=F("progress_target") + 1, last_file_at=now
    ):
        return job
    return None


def _open_job(user: User, now: datetime) -> LongRunningJob:
    """A new open job counting one upload; ``IntegrityError`` when one exists."""
    with transaction.atomic():
        return LongRunningJob.objects.create(
            started_by=user,
            job_id=str(uuid.uuid4()),
            job_type=LongRunningJob.JOB_IMPORT_UPLOADS,
            queued_at=now,
            started_at=now,
            sealed=False,
            last_file_at=now,
            progress_target=1,
            result={"stages": {}},
        )


def attach_upload(user: User) -> LongRunningJob:
    """Count one more upload in the user's open import job, opening one if needed."""
    now = timezone.now()
    job = _count_in_open_job(user, now)
    if job is not None:
        return job
    try:
        return _open_job(user, now)
    except IntegrityError:
        # A concurrent upload opened it first.
        job = _count_in_open_job(user, now)
        if job is None:
            raise
        return job


def release_upload(job_id: str) -> None:
    """Take back an upload counted by ``attach_upload`` whose task was not queued."""
    _import_jobs().filter(job_id=job_id, progress_target__gt=0).update(
        progress_target=F("progress_target") - 1
    )
    finish_job_if_complete(job_id)


def seal_upload_imports(jobs: LongRunningJobQuerySet) -> list[str]:
    """Seal the open upload import jobs among ``jobs``; the ids it sealed.

    Each is written with ``jobs``' conditions again, so a job that took a
    file since it was read (the sweeper's idle condition) stays open. A
    sealed job finishes when its files are all counted.
    """
    candidates = jobs.open_upload_imports()
    sealed = []
    for pk, job_id in candidates.values_list("pk", "job_id"):
        if candidates.filter(pk=pk).update(sealed=True):
            sealed.append(job_id)
            finish_job_if_complete(job_id)
    return sealed


def _finish_lost(job_id: str, user_id: int | None) -> None:
    """Finish a lost job, counting its missing files as failed."""
    now = timezone.now()
    lost_now = _import_jobs().filter(job_id=job_id, finished=False)
    if not lost_now.update(finished=True, finished_at=now):
        return  # Its last task came in, or another sweep finished it.

    def record_lost(result: dict[str, Any], job: LongRunningJob) -> dict[str, Any]:
        missing = max(job.progress_target - job.progress_current, 0)
        result["lost"] = missing
        failed = False
        for _ in range(missing):
            failed = record_item_error(
                result,
                f"{missing} uploads were not processed: their task was lost",
                job.progress_target,
            )
        return {"failed": failed} if missing else {}

    update_job_result(job_id, record_lost)
    logger.warning("job %s: finished as lost, some uploads were not processed", job_id)
    on_import_finished(job_id, user_id)


def _lost_jobs(now: datetime) -> LongRunningJobQuerySet:
    cutoff = now - LOST_AFTER
    return (
        _import_jobs()
        .filter(
            sealed=True,
            finished=False,
            progress_current__lt=F("progress_target"),
            last_file_at__lt=cutoff,
        )
        .filter(Q(last_progress_at__isnull=True) | Q(last_progress_at__lt=cutoff))
    )


def sweep_upload_imports() -> None:
    """Every minute: seal idle import jobs and finish lost ones."""
    now = timezone.now()
    seal_upload_imports(_import_jobs().filter(last_file_at__lt=now - IDLE_SEAL))
    lost = list(_lost_jobs(now).values_list("job_id", "started_by_id"))
    # Tasks still waiting may be these jobs', queued behind a scan.
    if lost and not tasks_are_waiting():
        for job_id, user_id in lost:
            _finish_lost(job_id, user_id)


def on_import_finished(job_id: UUID | str, user_id: int | None) -> None:
    """The import job is done: request its user's follow-ups.

    Not for a deleted user's job, which the ``deleted`` account took over.
    """
    if user_id is None:
        return
    user = User.objects.filter(pk=user_id, is_active=True).first()
    if user is None:
        return
    request_upload_followups(user)

    def mark(result: dict[str, Any], job: LongRunningJob) -> None:
        result["followups_requested"] = True

    update_job_result(job_id, mark)


@dataclass
class UploadedPhoto:
    """One upload, as its import task works on it."""

    photo: Photo
    path: str
    job_id: str
    device_time: CaptureTime | None = None
    album_id: int | None = None


def _media(upload: UploadedPhoto) -> None:
    process_uploaded_photo(upload.photo, upload.path, upload.job_id)


def _album(upload: UploadedPhoto) -> None:
    # Right after the media, so the photo shows in the album while its
    # tags, place and faces are still being worked out.
    if upload.album_id is not None:
        add_photo_to_user_album(upload.photo, upload.album_id)


def _date(upload: UploadedPhoto) -> None:
    apply_device_timestamp_fallback(upload.photo, upload.device_time)


def _tags(upload: UploadedPhoto) -> None:
    caption, _created = PhotoCaption.objects.get_or_create(photo=upload.photo)
    semantic.generate_photo_tags(caption, commit=True)


def _places(upload: UploadedPhoto) -> None:
    geolocate_photo(upload.photo)
    add_location_to_album_dates(upload.photo)


def _faces(upload: UploadedPhoto) -> None:
    extract_faces(upload.photo)


# The steps of one upload, in order. Each checks its own feature flag; one
# that fails does not stop the others.
UPLOAD_STEPS: tuple[tuple[str, Callable[[UploadedPhoto], None]], ...] = (
    ("media", _media),
    ("album", _album),
    ("date", _date),
    ("tags", _tags),
    ("places", _places),
    ("faces", _faces),
)


@dataclass
class UploadOutcome:
    """What the steps of one upload came to."""

    photo_id: str
    path: str
    done: list[str] = field(default_factory=list)
    failed_stage: str | None = None
    error: str | None = None

    def fail(self, stage: str, error: Exception) -> None:
        if self.failed_stage is None:
            self.failed_stage, self.error = stage, str(error)

    def failed_file(self) -> dict[str, str | None]:
        return {
            "photo_id": self.photo_id,
            "file": os.path.basename(self.path),
            "stage": self.failed_stage,
            "error": self.error,
        }


def run_upload_steps(upload: UploadedPhoto) -> UploadOutcome:
    """Run ``UPLOAD_STEPS`` on one upload, every one even after a failure."""
    outcome = UploadOutcome(str(upload.photo.pk), upload.path)
    for stage, step in UPLOAD_STEPS:
        try:
            step(upload)
        except Exception as error:
            logger.exception(
                "job %s: step %s failed for photo %s",
                upload.job_id,
                stage,
                upload.photo.pk,
            )
            outcome.fail(stage, error)
        else:
            outcome.done.append(stage)
    return outcome


def record_upload(job_id: str, outcome: UploadOutcome) -> None:
    """Count one processed upload on its job, with its stages and its error."""

    def add(result: dict[str, Any], job: LongRunningJob) -> dict[str, Any]:
        stages = result.setdefault("stages", {})
        for stage in outcome.done:
            stages[stage] = stages.get(stage, 0) + 1
        fields: dict[str, Any] = {
            "progress_current": F("progress_current") + 1,
            "last_progress_at": timezone.now(),
        }
        if outcome.failed_stage is not None:
            text = f"{os.path.basename(outcome.path)}: {outcome.failed_stage}: {outcome.error}"
            fields["failed"] = record_item_error(result, text, job.progress_target)
            failed_files = result.setdefault("failed_files", [])
            failed_files.append(outcome.failed_file())
            result["failed_files"] = failed_files[-FAILED_FILES_KEPT:]
        return fields

    if update_job_result(job_id, add) is None:
        return
    finish_job_if_complete(job_id)


def import_uploaded_photo(
    photo_id: str,
    path: str,
    job_id: str,
    device_time: CaptureTime | None = None,
    album_id: int | None = None,
) -> None:
    """Process one upload whose photo row exists, then count it on ``job_id``.

    A photo deleted before the task ran still counts, so the job finishes.
    """
    # The id comes from the upload's own completion, which made the photo.
    photo = Photo.objects.filter(pk=photo_id).first()
    if photo is None:
        logger.info("job %s: photo %s is gone, nothing to import", job_id, photo_id)
        record_upload(job_id, UploadOutcome(str(photo_id), path))
        return
    upload = UploadedPhoto(photo, path, job_id, device_time, album_id)
    record_upload(job_id, run_upload_steps(upload))
