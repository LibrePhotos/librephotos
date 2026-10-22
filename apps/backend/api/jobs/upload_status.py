"""What an upload UI follows once the bytes are sent (#2739).

``GET /api/upload/status/`` answers three things, all scoped to the caller:

- ``import_jobs_to_show``: their upload import jobs that are still open or
  processing (uploads from any client, the phone's included), plus the jobs a
  client names (``POST /api/upload/complete/`` answered their ``job_id``), so
  it sees them finish;
- ``ready_photo_ids``: which of the named photos are ready, meaning they have
  their thumbnails and show in the timeline;
- the follow-ups' state (``api.jobs.upload_followups.followup_status``).
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import TypedDict
from uuid import UUID

from api.jobs.upload_followups import FollowupStatus, followup_status
from api.models import LongRunningJob, Photo, User
from api.models.long_running_job import LongRunningJobQuerySet

# The most unfinished import jobs listed besides the named ones. One is open
# at a time; sealed ones finish within minutes, or as lost after half an hour.
MAX_IMPORTS_SHOWN = 20


def import_jobs_to_show(
    jobs: LongRunningJobQuerySet, user: User, job_ids: Sequence[str]
) -> list[LongRunningJob]:
    """The user's import jobs among ``jobs`` named in ``job_ids``, and their newest unfinished ones.

    Every named job is listed; the unnamed unfinished ones up to
    ``MAX_IMPORTS_SHOWN``. Newest first.
    """
    imports = (
        jobs.owned_by(user)
        .filter(job_type=LongRunningJob.JOB_IMPORT_UPLOADS)
        .order_by("-queued_at")
    )
    named = list(imports.filter(job_id__in=job_ids)) if job_ids else []
    unfinished = imports.filter(finished=False).exclude(job_id__in=job_ids)
    listed = named + list(unfinished[:MAX_IMPORTS_SHOWN])
    return sorted(listed, key=lambda job: job.queued_at, reverse=True)


def ready_photo_ids(user: User, photo_ids: Sequence[UUID]) -> list[UUID]:
    """Those of ``photo_ids`` that are the user's and have their thumbnails."""
    if not photo_ids:
        return []
    return list(
        Photo.objects.owned_by(user)
        .filter(pk__in=photo_ids, thumbnail__aspect_ratio__isnull=False)
        .values_list("pk", flat=True)
    )


class UploadStatus(TypedDict):
    """``GET /api/upload/status/``."""

    imports: list[LongRunningJob]
    ready_photo_ids: list[UUID]
    followups: FollowupStatus


def upload_status(
    jobs: LongRunningJobQuerySet,
    user: User,
    job_ids: Sequence[str],
    photo_ids: Sequence[UUID],
) -> UploadStatus:
    """The user's imports among ``jobs``, which of ``photo_ids`` are ready, the follow-ups.

    The jobs are read before the photos: a job seen finished then has every
    photo it processed ready, so a client may take a photo that is not ready
    as one that will never be.
    """
    imports = import_jobs_to_show(jobs, user, job_ids)
    return {
        "imports": imports,
        "ready_photo_ids": ready_photo_ids(user, photo_ids),
        "followups": followup_status(user),
    }
