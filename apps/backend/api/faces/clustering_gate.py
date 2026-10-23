"""When the upload follow-ups may recluster a user's faces (#2738).

Faces from uploads sat among the unknown faces until someone reclustered by
hand. The upload follow-ups (``api.jobs.upload_followups``) now queue
**Find Similar Faces** (``cluster_all_faces``) themselves, but only when it is
worth it and does not get in the way, because a rebuild deletes and renumbers
the user's clusters:

- enough new faces: at least ``MIN_NEW_FACES`` and ``NEW_FACE_SHARE`` of the
  user's faces arrived since the last clustering (``face_watermark``, the
  highest face id it saw);
- at most once per ``CLUSTER_INTERVAL``;
- ``UPLOAD_QUIET`` after the last uploaded file, ``LABEL_QUIET`` after the
  user last labelled a face, and no scan, face scan, clustering, training or
  open upload import of the user's running.

``record_clustering`` (every clustering, whoever started it) and
``record_face_label`` (every face labelling) keep the state these gates read
on the user's ``UploadFollowupState``.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta

from django.db.models import Max
from django.utils import timezone

from api.models import Face, LongRunningJob, UploadFollowupState, User

# New faces since the last clustering that make a rebuild worth it: this many,
# and this share of all the user's faces, so a large library is not rebuilt
# for every few photos.
MIN_NEW_FACES = 20
NEW_FACE_SHARE = 0.02
# At most one follow-up clustering per this long.
CLUSTER_INTERVAL = timedelta(hours=1)
# How long after the last uploaded file: more are likely on their way.
UPLOAD_QUIET = timedelta(minutes=30)
# How long after the user last labelled a face: a rebuild renumbers the
# clusters they are working through.
LABEL_QUIET = timedelta(minutes=15)
# How long to wait before looking again while one of ``BUSY_JOB_TYPES`` runs.
BUSY_RETRY = timedelta(minutes=15)
# Jobs of the user's that add faces or cluster them already. A scan of photos
# or faces clusters at its end itself.
BUSY_JOB_TYPES = (
    LongRunningJob.JOB_SCAN_PHOTOS,
    LongRunningJob.JOB_SCAN_FACES,
    LongRunningJob.JOB_CLUSTER_ALL_FACES,
    LongRunningJob.JOB_TRAIN_FACES,
    LongRunningJob.JOB_IMPORT_UPLOADS,
)


def _state_of(user: User) -> UploadFollowupState:
    """The user's follow-up state, created on first use."""
    state, _ = UploadFollowupState.objects.get_or_create(user=user)
    return state


def latest_face_id(user: User) -> int:
    """The highest id among the user's faces; 0 when there is none."""
    latest: int | None = Face.objects.owned_by(user).aggregate(latest=Max("pk"))[
        "latest"
    ]
    return latest or 0


def record_clustering(user: User, watermark: int) -> None:
    """A clustering of ``user``'s faces up to id ``watermark`` just ran."""
    _state_of(user)
    UploadFollowupState.objects.owned_by(user).update(
        face_watermark=watermark, last_clustered_at=timezone.now()
    )


def record_face_label(user: User) -> None:
    """``user`` just labelled, deleted or restored faces."""
    _state_of(user)
    UploadFollowupState.objects.owned_by(user).update(last_face_label_at=timezone.now())


def _watermark(user: User, state: UploadFollowupState) -> int:
    """The highest face id the last clustering saw.

    A state that no clustering has written yet (a library from before #2738)
    takes the newest face a clustering put in a cluster, so the first upload
    after the upgrade does not count every face as new. A library never
    clustered has none: all its faces are new.
    """
    if state.last_clustered_at is not None or state.face_watermark:
        return state.face_watermark
    clustered: int | None = (
        Face.objects.owned_by(user)
        .filter(cluster__isnull=False)
        .aggregate(latest=Max("pk"))["latest"]
    )
    return clustered or 0


def enough_new_faces(user: User, state: UploadFollowupState) -> bool:
    """Whether enough faces arrived since the last clustering to cluster again."""
    faces = Face.objects.owned_by(user).for_recognition()
    new = faces.filter(pk__gt=_watermark(user, state)).count()
    if new < MIN_NEW_FACES:
        return False
    return new >= math.ceil(NEW_FACE_SHARE * faces.count())


def _last_upload_at(user: User) -> datetime | None:
    """When the user's newest uploaded file was taken into an import job."""
    latest: datetime | None = (
        LongRunningJob.objects.owned_by(user)
        .filter(job_type=LongRunningJob.JOB_IMPORT_UPLOADS)
        .aggregate(latest=Max("last_file_at"))["latest"]
    )
    return latest


def _busy(user: User) -> bool:
    """Whether a job of the user's is adding or clustering faces."""
    return (
        LongRunningJob.objects.owned_by(user)
        .running()
        .filter(job_type__in=BUSY_JOB_TYPES)
        .exists()
    )


def clustering_allowed_at(
    user: User, state: UploadFollowupState, now: datetime
) -> datetime:
    """The earliest time a follow-up may cluster; ``now`` when nothing waits."""
    waits = (
        (state.last_clustered_at, CLUSTER_INTERVAL),
        (state.last_face_label_at, LABEL_QUIET),
        (_last_upload_at(user), UPLOAD_QUIET),
    )
    allowed = [since + wait for since, wait in waits if since is not None]
    if _busy(user):
        allowed.append(now + BUSY_RETRY)
    return max([now, *allowed])
