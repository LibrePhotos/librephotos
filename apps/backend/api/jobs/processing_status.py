"""How far the processing of a user's library got, stage by stage (#2741).

``GET /api/library/processing-status/`` lists one row per processing stage
that is turned on: how many of the user's photos (faces, for the face
recognition data) the stage still has to do, its job while one runs, and
what its last run left failed. ``POST /api/library/processing-status/run/``
starts the stage's job for what is left, the job its own trigger or the
scan's follow-ups start, never a new kind of job.

Each stage counts with the same ``Q`` its job selects with
(``needs_things``, ``needs_ocr``, ...), so a finished run brings the count
to zero. The photo counts are one aggregate over the user's photos, the
face count one more query, and the jobs two: the cost does not grow with
the library.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Literal, TypedDict, get_args

from django.db.models import Count, OuterRef, Q, Subquery
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from api.classification.captioning import captioning_available
from api.directory_watcher import scan_photos
from api.directory_watcher.processing_jobs import (
    MISSING_BIG_THUMBNAIL,
    active_ocr_model,
    add_geolocation,
    faces_missing_encoding,
    generate_captions,
    generate_face_embeddings,
    generate_ocr,
    generate_tags,
    needs_caption,
    needs_face_scan,
    needs_ocr,
    needs_things,
    scan_faces,
)
from api.faces.classify import cluster_all_faces
from api.geocode.photo_location import needs_geocoding
from api.jobs.queue import JobStep
from api.jobs.start import start_job, start_jobs
from api.models import LongRunningJob, Photo, User
from api.photos.library_files import rescan_targets
from api.runtime.features import feature_enabled
from api.runtime.ml_models import (
    captioning_model_prerequisites,
    missing_models_prerequisites,
)
from api.search.embedding_jobs import (
    batch_calculate_clip_embedding,
    needs_search_embedding,
)

StageKey = Literal[
    "thumbnails",
    "things",
    "search",
    "places",
    "face_detection",
    "face_recognition",
    "text",
    "captions",
]
STAGE_KEYS: tuple[StageKey, ...] = get_args(StageKey)

J = LongRunningJob


# The photos the status counts: not in the trash, their file not gone.
IN_LIBRARY = Q(removed=False, in_trashcan=False)


def needs_thumbnails() -> Q:
    """Photos with a file but no big thumbnail; a rescan of their files makes it."""
    return Q(removed=False) & MISSING_BIG_THUMBNAIL


def _always() -> bool:
    return True


def _ocr_on() -> bool:
    return active_ocr_model() is not None


def _needs_text() -> Q:
    model = active_ocr_model()
    # Only asked while OCR is on; no photo needs an engine that is off.
    return needs_ocr(model) if model is not None else Q(pk__in=[])


def _start_thumbnails(user: User) -> Response:
    """Read the files of the photos without a big thumbnail again (as a rescan)."""
    photo_ids = Photo.objects.owned_by(user).filter(needs_thumbnails())
    targets = rescan_targets(user, photo_ids.values_list("pk", flat=True))
    if not targets.paths:
        raise ValidationError(
            "None of the photos without a thumbnail has a file in your library.",
            code="no_files_to_scan",
        )
    return start_job(
        user,
        J.JOB_SCAN_PHOTOS,
        scan_photos,
        user,
        False,
        scan_files=targets.paths,
        force_files=True,
        description="making the missing thumbnails",
        prerequisites=missing_models_prerequisites(user),
    )


def _start_things(user: User) -> Response:
    return start_job(
        user,
        J.JOB_GENERATE_TAGS,
        generate_tags,
        user,
        description="finding things",
        prerequisites=missing_models_prerequisites(user),
    )


def _start_search(user: User) -> Response:
    return start_job(
        user,
        J.JOB_CALCULATE_CLIP_EMBEDDINGS,
        batch_calculate_clip_embedding,
        user,
        description="the search embeddings",
        prerequisites=missing_models_prerequisites(user),
    )


def _start_places(user: User) -> Response:
    return start_job(
        user,
        J.JOB_ADD_GEOLOCATION,
        add_geolocation,
        user,
        description="looking up places",
    )


def _start_face_detection(user: User) -> Response:
    return start_job(
        user,
        J.JOB_SCAN_FACES,
        scan_faces,
        user,
        description="the face scan",
        prerequisites=missing_models_prerequisites(user),
    )


def _start_face_recognition(user: User) -> Response:
    """Encode the faces without an encoding, then group them when grouping is on."""
    steps = [JobStep(J.JOB_GENERATE_FACE_EMBEDDINGS, generate_face_embeddings, (user,))]
    if feature_enabled("FACE_CLUSTER"):
        steps.append(JobStep(J.JOB_CLUSTER_ALL_FACES, cluster_all_faces, (user,)))
    return start_jobs(
        user,
        steps,
        "the face recognition data",
        prerequisites=missing_models_prerequisites(user),
    )


def _start_text(user: User) -> Response:
    return start_job(
        user, J.JOB_GENERATE_OCR, generate_ocr, user, description="text recognition"
    )


def _start_captions(user: User) -> Response:
    return start_job(
        user,
        J.JOB_GENERATE_CAPTIONS,
        generate_captions,
        user,
        description="caption generation",
        prerequisites=captioning_model_prerequisites(user),
    )


@dataclass(frozen=True)
class Stage:
    """One row of the status: when it applies, what it counts, which job does it.

    ``needs`` selects the photos the stage still has to do; ``None`` for the
    face recognition data, which counts faces.
    """

    key: StageKey
    job_type: int
    enabled: Callable[[], bool]
    needs: Callable[[], Q] | None
    start: Callable[[User], Response]


STAGES: tuple[Stage, ...] = (
    Stage(
        "thumbnails", J.JOB_SCAN_PHOTOS, _always, needs_thumbnails, _start_thumbnails
    ),
    Stage(
        "things",
        J.JOB_GENERATE_TAGS,
        lambda: feature_enabled("SCENE_CLASSIFICATION"),
        needs_things,
        _start_things,
    ),
    Stage(
        "search",
        J.JOB_CALCULATE_CLIP_EMBEDDINGS,
        _always,
        needs_search_embedding,
        _start_search,
    ),
    Stage(
        "places",
        J.JOB_ADD_GEOLOCATION,
        lambda: feature_enabled("REVERSE_GEOCODING"),
        needs_geocoding,
        _start_places,
    ),
    Stage(
        "face_detection",
        J.JOB_SCAN_FACES,
        lambda: feature_enabled("FACE_DETECTION"),
        needs_face_scan,
        _start_face_detection,
    ),
    Stage(
        "face_recognition",
        J.JOB_GENERATE_FACE_EMBEDDINGS,
        lambda: feature_enabled("FACE_DETECTION"),
        None,
        _start_face_recognition,
    ),
    Stage("text", J.JOB_GENERATE_OCR, _ocr_on, _needs_text, _start_text),
    Stage(
        "captions",
        J.JOB_GENERATE_CAPTIONS,
        captioning_available,
        needs_caption,
        _start_captions,
    ),
)
STAGES_BY_KEY = {stage.key: stage for stage in STAGES}


class RunningJob(TypedDict):
    job_id: str
    progress_current: int
    progress_target: int


class LastRun(TypedDict):
    job_id: str
    finished_at: datetime | None
    failed: bool
    error_count: int


class StageStatus(TypedDict):
    key: StageKey
    remaining: int
    running_job: RunningJob | None
    last_run: LastRun | None


class ProcessingStatus(TypedDict):
    """``GET /api/library/processing-status/`` (``ProcessingStatusSerializer``)."""

    photo_count: int
    stages: list[StageStatus]


def _remaining(user: User, stages: list[Stage]) -> tuple[int, dict[StageKey, int]]:
    """The user's photos and what each stage has left of them.

    Photos in the trash or whose file is gone are left out, as on the
    timeline; the jobs take them along, so a finished run leaves no count.
    """
    counts = {
        stage.key: Count("pk", filter=stage.needs())
        for stage in stages
        if stage.needs is not None
    }
    totals = (
        Photo.objects.owned_by(user)
        .filter(IN_LIBRARY)
        .aggregate(photos=Count("pk"), **counts)
    )
    remaining: dict[StageKey, int] = {
        stage.key: totals[stage.key] for stage in stages if stage.needs is not None
    }
    if any(stage.needs is None for stage in stages):
        faces = faces_missing_encoding(user).filter(
            photo__in_trashcan=False, photo__removed=False
        )
        remaining["face_recognition"] = faces.count()
    return totals["photos"], remaining


def _running_jobs(user: User, job_types: list[int]) -> dict[int, LongRunningJob]:
    """The oldest running job of each of ``job_types`` the user started."""
    running = (
        J.objects.owned_by(user)
        .running()
        .filter(job_type__in=job_types)
        .order_by("-queued_at")
    )
    # Newest first, so the oldest of a type is written last and stays.
    return {job.job_type: job for job in running}


def _last_runs(user: User, job_types: list[int]) -> dict[int, LongRunningJob]:
    """The newest finished job of each of ``job_types`` the user started; one query."""
    mine = J.objects.owned_by(user)
    newest = (
        mine.filter(job_type=OuterRef("job_type"), finished=True)
        .order_by("-finished_at", "-id")
        .values("pk")[:1]
    )
    rows = mine.filter(job_type__in=job_types, pk=Subquery(newest))
    return {job.job_type: job for job in rows}


def _running(job: LongRunningJob | None) -> RunningJob | None:
    if job is None:
        return None
    return {
        "job_id": str(job.job_id),
        "progress_current": job.progress_current,
        "progress_target": job.progress_target,
    }


def _error_count(job: LongRunningJob) -> int:
    result = job.result if isinstance(job.result, dict) else {}
    count = result.get("error_count", 0)
    return count if isinstance(count, int) else 0


def _last_run(job: LongRunningJob | None) -> LastRun | None:
    if job is None:
        return None
    return {
        "job_id": str(job.job_id),
        "finished_at": job.finished_at,
        "failed": job.failed,
        "error_count": _error_count(job),
    }


def processing_status(user: User) -> ProcessingStatus:
    """Each turned-on stage with what is left of the user's library, in pipeline order."""
    stages = [stage for stage in STAGES if stage.enabled()]
    photo_count, remaining = _remaining(user, stages)
    job_types = [stage.job_type for stage in stages]
    running = _running_jobs(user, job_types)
    last = _last_runs(user, job_types)
    return {
        "photo_count": photo_count,
        "stages": [
            {
                "key": stage.key,
                "remaining": remaining[stage.key],
                "running_job": _running(running.get(stage.job_type)),
                "last_run": _last_run(last.get(stage.job_type)),
            }
            for stage in stages
        ],
    }


def start_stage(user: User, key: StageKey) -> Response:
    """Start the job that does what is left of the stage; 403 while it is off.

    A second start while the job runs is a 409 ``job_already_running`` with
    that job's id (``api.jobs.start``).
    """
    stage = STAGES_BY_KEY[key]
    if not stage.enabled():
        raise PermissionDenied("This processing stage is turned off.", code="stage_off")
    return stage.start(user)
