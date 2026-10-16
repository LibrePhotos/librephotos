from __future__ import annotations

import logging
import time
import uuid
from datetime import datetime, timedelta
from typing import Any

from django.conf import settings
from django.db import models
from django.db.models.functions import Coalesce
from django.db.models.lookups import GreaterThanOrEqual, LessThan
from django.utils import timezone

from api.models.scopes import OwnedQuerySet
from api.models.user import User, get_deleted_user

logger = logging.getLogger(__name__)


def stuck_job_hours() -> int:
    """Hours without progress after which an unfinished job counts as stuck.

    ``STUCK_JOB_HOURS`` (default 24), for hosts where one item of a job can
    take longer than that.
    """
    hours: int = settings.STUCK_JOB_HOURS
    return hours


def _last_sign_of_life() -> Coalesce:
    """A job's last progress, else its start, else its queueing."""
    return Coalesce("last_progress_at", "started_at", "queued_at")


class JobCancelledError(Exception):
    """The job's row was cancelled while its task ran.

    Raised by ``LongRunningJob.stop_if_cancelled`` from inside the work; the
    job's task catches it at its top level and returns without completing or
    failing the row, which ``cancel()`` has already finished (#2198).
    """

    def __init__(self, job_id: str) -> None:
        super().__init__(f"job {job_id} was cancelled")
        self.job_id = job_id


class LongRunningJobQuerySet(OwnedQuerySet["LongRunningJob"]):
    """The user who started the job owns it."""

    owner_lookup = "started_by"

    def running(self) -> LongRunningJobQuerySet:
        """Jobs that are queued or running: unfinished and not stuck.

        A row is written when the job is queued (``api.jobs.queue``), so a
        queued job counts as running. Rows that ``stuck()`` would return are
        left out, so an orphan (OOM, restart, uncaught exception) does not
        block anything while it waits for the hourly ``cleanup_stuck_jobs``
        (#1919). Duplicate-start refusal and ``/api/rqavailable/`` both read
        this.
        """
        cutoff = timezone.now() - timedelta(hours=stuck_job_hours())
        return self.filter(GreaterThanOrEqual(_last_sign_of_life(), cutoff)).filter(
            finished=False
        )

    def stuck(self, hours: int | None = None) -> LongRunningJobQuerySet:
        """Unfinished jobs that have shown no sign of life for ``hours``.

        A sign of life is the last progress the job reported, else its start,
        else its queueing. A scan of a large library can run for days, so
        the age of the job itself says nothing (#2248).
        """
        if hours is None:
            hours = stuck_job_hours()
        cutoff = timezone.now() - timedelta(hours=hours)
        return self.filter(LessThan(_last_sign_of_life(), cutoff)).filter(
            finished=False
        )

    def baselines(self, job_type: int) -> LongRunningJobQuerySet:
        """Runs of ``job_type`` an incremental run may start after, newest first.

        An incremental run only looks at what changed since its baseline
        started, so the baseline must have gone through all of its work. That
        leaves out a run that was cancelled, raised, or was cut off by
        ``cleanup_stuck_jobs`` (#2212): what it never reached would fall
        outside every later window. A run flagged ``failed`` only because more
        than 5 % of its items errored (``_record_error``) did reach its target
        and stays a baseline; otherwise a library with many unreadable files
        would never get one. Some types add a condition of their own, see
        ``LongRunningJob.BASELINE_CONDITIONS``.
        """
        return (
            self.filter(
                job_type=job_type,
                finished=True,
                cancelled=False,
                started_at__isnull=False,
            )
            .filter(
                models.Q(failed=False)
                | models.Q(
                    progress_target__gt=0,
                    progress_current__gte=models.F("progress_target"),
                )
            )
            .filter(LongRunningJob.BASELINE_CONDITIONS.get(job_type, models.Q()))
            .order_by("-finished_at", "-id")
        )

    def with_scan_baseline_flag(self) -> LongRunningJobQuerySet:
        """Annotate ``is_scan_baseline``: whether the row is its starter's scan baseline.

        That is the run ``LongRunningJob.baseline_for(row.started_by,
        JOB_SCAN_PHOTOS)`` returns, the one the next incremental scan compares
        the library against. Removing it would make that scan read every file
        again (#1104). One correlated subquery inside the same query, so a
        list of jobs pays no query per row.
        """
        # The starter of each row, not a scope to a user: every row is
        # compared with the baseline of whoever started it.
        baseline = (
            LongRunningJob.objects.filter(started_by=models.OuterRef("started_by"))
            .baselines(LongRunningJob.JOB_SCAN_PHOTOS)
            .values("pk")[:1]
        )
        return self.annotate(
            is_scan_baseline=models.Case(
                # CASE stops at the first match: the subquery only runs for a
                # finished scan, never for /api/rqavailable/'s running job.
                models.When(
                    ~models.Q(job_type=LongRunningJob.JOB_SCAN_PHOTOS, finished=True),
                    then=models.Value(False),
                ),
                models.When(pk=models.Subquery(baseline), then=models.Value(True)),
                default=models.Value(False),
                output_field=models.BooleanField(),
            )
        )


class LongRunningJob(models.Model):
    # How often ``stop_if_cancelled`` reads the row: a loop may call it on
    # every item without a query per item.
    CANCEL_CHECK_SECONDS = 1.0

    JOB_SCAN_PHOTOS = 1
    JOB_GENERATE_AUTO_ALBUMS = 2
    JOB_GENERATE_AUTO_ALBUM_TITLES = 3
    JOB_TRAIN_FACES = 4
    JOB_DELETE_MISSING_PHOTOS = 5
    JOB_CALCULATE_CLIP_EMBEDDINGS = 6
    JOB_SCAN_FACES = 7
    JOB_CLUSTER_ALL_FACES = 8
    JOB_DOWNLOAD_PHOTOS = 9
    JOB_DOWNLOAD_MODELS = 10
    JOB_ADD_GEOLOCATION = 11
    JOB_GENERATE_TAGS = 12
    JOB_GENERATE_FACE_EMBEDDINGS = 13
    JOB_SCAN_MISSING_PHOTOS = 14
    JOB_DETECT_DUPLICATES = 15
    JOB_REPAIR_FILE_VARIANTS = 16
    JOB_CLASSIFY_MEDIA = 17
    JOB_GENERATE_OCR = 18
    JOB_PROBE_VIDEOS = 19
    # 20 and 21 are planned for the upload and Nextcloud import jobs (#2191).
    JOB_DETECT_STACKS = 22
    JOB_STRIP_THUMBNAIL_METADATA = 23
    JOB_EMPTY_TRASH = 24
    JOB_GENERATE_CAPTIONS = 25
    JOB_REAPPLY_DATE_RULES = 26
    JOB_WRITE_METADATA = 27
    JOB_REFRESH_EXPOSURE_TIMES = 28
    JOB_LOOK_UP_PLACES = 29
    JOB_MOVE_PHOTOS = 30

    JOB_TYPES = (
        (JOB_SCAN_PHOTOS, "Scan Photos"),
        (JOB_GENERATE_AUTO_ALBUMS, "Generate Event Albums"),
        (JOB_GENERATE_AUTO_ALBUM_TITLES, "Regenerate Event Titles"),
        (JOB_TRAIN_FACES, "Train Faces"),
        (JOB_DELETE_MISSING_PHOTOS, "Delete Missing Photos"),
        (JOB_SCAN_FACES, "Scan Faces"),
        (JOB_CALCULATE_CLIP_EMBEDDINGS, "Calculate Clip Embeddings"),
        (JOB_CLUSTER_ALL_FACES, "Find Similar Faces"),
        (JOB_DOWNLOAD_PHOTOS, "Download Selected Photos"),
        (JOB_DOWNLOAD_MODELS, "Download Models"),
        (JOB_ADD_GEOLOCATION, "Add Geolocation"),
        (JOB_GENERATE_TAGS, "Generate Tags"),
        (JOB_GENERATE_FACE_EMBEDDINGS, "Generate Face Embeddings"),
        (JOB_SCAN_MISSING_PHOTOS, "Scan Missing Photos"),
        (JOB_DETECT_DUPLICATES, "Detect Duplicate Photos"),
        (JOB_REPAIR_FILE_VARIANTS, "Repair File Variants"),
        (JOB_CLASSIFY_MEDIA, "Classify Media Categories"),
        (JOB_GENERATE_OCR, "Extract Text (OCR)"),
        (JOB_PROBE_VIDEOS, "Probe Videos"),
        (JOB_DETECT_STACKS, "Detect Stacks"),
        (JOB_STRIP_THUMBNAIL_METADATA, "Remove Photo Details from Thumbnails"),
        (JOB_EMPTY_TRASH, "Empty Trash"),
        (JOB_GENERATE_CAPTIONS, "Generate Captions"),
        (JOB_REAPPLY_DATE_RULES, "Apply Date Rules"),
        (JOB_WRITE_METADATA, "Write Metadata to Files"),
        (JOB_REFRESH_EXPOSURE_TIMES, "Read Shutter Speeds Again"),
        (JOB_LOOK_UP_PLACES, "Look Up Place Names"),
        (JOB_MOVE_PHOTOS, "Move Photos"),
    )

    # The ``result`` key a photo scan of the user's whole scan directory sets.
    LIBRARY_SCAN = "library_scan"

    # What a run of these types needs on top of ``baselines()`` to be one. A
    # photo scan must have walked the whole library: a file-list scan or a
    # Nextcloud import says nothing about the files it did not look at
    # (#2192). An OCR run must have had work: a disabled or empty run would
    # otherwise make every photo added before it look done.
    BASELINE_CONDITIONS: dict[int, models.Q] = {
        JOB_SCAN_PHOTOS: models.Q(**{f"result__{LIBRARY_SCAN}": True}),
        JOB_GENERATE_OCR: models.Q(progress_target__gt=0),
    }

    job_type = models.PositiveIntegerField(
        choices=JOB_TYPES,
    )

    finished = models.BooleanField(default=False, blank=False, null=False)
    failed = models.BooleanField(default=False, blank=False, null=False)
    cancelled = models.BooleanField(default=False, blank=False, null=False)
    job_id = models.CharField(max_length=36, unique=True, db_index=True)
    queued_at = models.DateTimeField(default=datetime.now, null=False)
    started_at = models.DateTimeField(null=True)
    finished_at = models.DateTimeField(null=True)
    started_by = models.ForeignKey(
        User, on_delete=models.SET(get_deleted_user), default=None
    )
    progress_current = models.PositiveIntegerField(default=0)
    progress_target = models.PositiveIntegerField(default=0)
    # When the job last reported progress; the stuck-job cleanup counts from
    # here (#2248).
    last_progress_at = models.DateTimeField(null=True, blank=True)
    # New fields for detailed progress reporting
    progress_step = models.CharField(
        max_length=100, null=True, blank=True
    )  # Current step description
    result = models.JSONField(null=True, blank=True)  # Detailed result/progress data

    objects = LongRunningJobQuerySet.as_manager()

    class Meta:
        ordering = ["-queued_at"]
        indexes = [
            # /api/rqavailable/, polled every 2 s by every open tab, looks for
            # the unfinished job without reading the whole job history.
            models.Index(
                fields=["started_at"],
                condition=models.Q(finished=False),
                name="lrj_unfinished_idx",
            ),
        ]
        verbose_name = "Long Running Job"
        verbose_name_plural = "Long Running Jobs"

    def __str__(self) -> str:
        status = (
            "failed"
            if self.failed
            else (
                "finished"
                if self.finished
                else "running"
                if self.started_at
                else "queued"
            )
        )
        return f"Job {self.job_id} - {self.get_job_type_display()} - {status}"

    # What the conditional writes below re-read when the row was cancelled.
    _FINISH_FIELDS = ("cancelled", "failed", "finished", "finished_at", "result")

    # When ``stop_if_cancelled`` last read the row (``time.monotonic()``).
    _cancel_checked_at: float | None = None

    def save(self, *args: Any, **kwargs: Any) -> None:
        """Insert a new row; an existing row is written field by field only.

        Workers hold the instance for the whole job while a cancel is written
        from the API. A full-row save of that instance puts
        ``cancelled=False, finished=False`` back and the job reappears as
        running (#2334), so existing rows go through the methods below, which
        name the fields they write.
        """
        if not self._state.adding and kwargs.get("update_fields") is None:
            raise RuntimeError(
                "LongRunningJob rows are written through their methods "
                "(update_progress, complete, fail, cancel, set_result) or with "
                "save(update_fields=...); a full-row save would undo a cancel."
            )
        super().save(*args, **kwargs)

    def _write_unless_cancelled(self, fields: list[str]) -> bool:
        """Write ``fields`` unless the row has been cancelled meanwhile.

        A conditional update, so a cancel made from the job list while the
        job ran is not overwritten by the worker finishing, failing or
        reporting a result. When it was cancelled, the instance re-reads the
        row's outcome. Returns whether the row was written.
        """
        written = (
            type(self)
            .objects.filter(pk=self.pk, cancelled=False)
            .update(**{field: getattr(self, field) for field in fields})
        )
        if not written:
            self.refresh_from_db(fields=list(self._FINISH_FIELDS))
        return bool(written)

    def start(self) -> None:
        """Mark job as started."""
        self.started_at = timezone.now()
        self.save(update_fields=["started_at"])

    def complete(self, result: dict[str, Any] | None = None) -> bool:
        """Mark job as successfully completed, unless it was cancelled.

        Returns False when the job had been cancelled; the row is left as is.
        """
        self.finished = True
        self.finished_at = timezone.now()
        if result is not None:
            self.result = result
        return self._write_unless_cancelled(["finished", "finished_at", "result"])

    def fail(
        self,
        error: BaseException | str | None = None,
        details: dict[str, Any] | None = None,
    ) -> bool:
        """Mark job as failed with optional error message, unless it was cancelled.

        ``details`` (counts, the failed items) go into the result next to the
        error. Returns False when the job had been cancelled; the row is left
        as is.
        """
        self.failed = True
        self.finished = True
        self.finished_at = timezone.now()
        if error is not None:
            self.result = {**(details or {}), "status": "failed", "error": str(error)}
        return self._write_unless_cancelled(
            ["failed", "finished", "finished_at", "result"]
        )

    def cancel(self) -> None:
        """Mark job as cancelled and finished."""
        self.cancelled = True
        self.finished = True
        self.finished_at = timezone.now()
        self.result = {"status": "cancelled"}
        self.save(update_fields=["cancelled", "finished", "finished_at", "result"])

    def stop_if_cancelled(self) -> None:
        """Raise ``JobCancelledError`` when the job was cancelled while it ran.

        Cancelling only marks the row (``cancel()``); the work stops where it
        calls this. The row is read at most every ``CANCEL_CHECK_SECONDS``.
        A progress write that found the row cancelled (``set_result``,
        ``complete``) has re-read it already, so the next call raises
        without a query.
        """
        if not self.cancelled:
            now = time.monotonic()
            last = self._cancel_checked_at
            if last is not None and now - last < self.CANCEL_CHECK_SECONDS:
                return
            self._cancel_checked_at = now
            if not type(self).objects.filter(pk=self.pk, cancelled=True).exists():
                return
            self.refresh_from_db(fields=list(self._FINISH_FIELDS))
        raise JobCancelledError(self.job_id)

    def update_progress(
        self, current: int, target: int | None = None, step: str | None = None
    ) -> None:
        """Update job progress counters and optional step description.

        Only the progress fields are written, so a cancel stays in place.
        """
        update_fields = ["progress_current", "last_progress_at"]
        self.progress_current = current
        self.last_progress_at = timezone.now()
        if target is not None:
            self.progress_target = target
            update_fields.append("progress_target")
        if step is not None:
            self.progress_step = step
            update_fields.append("progress_step")
        self.save(update_fields=update_fields)

    def set_result(self, result: dict[str, Any]) -> bool:
        """Update the job result/progress data, unless the job was cancelled.

        Returns False when the job had been cancelled; the row is left as is.
        """
        self.result = result
        self.last_progress_at = timezone.now()
        return self._write_unless_cancelled(["result", "last_progress_at"])

    @classmethod
    def baseline_for(cls, user: User, job_type: int) -> LongRunningJob | None:
        """The run ``user``'s next incremental ``job_type`` run starts after.

        ``None`` when there is none: the incremental run then covers everything.
        """
        return cls.objects.owned_by(user).baselines(job_type).first()

    @classmethod
    def create_job(
        cls,
        user: User,
        job_type: int,
        job_id: uuid.UUID | str | None = None,
        start_now: bool = False,
    ) -> LongRunningJob:
        """
        Factory method to create a new job with proper defaults.

        Args:
            user: The user who started the job
            job_type: One of the JOB_* constants
            job_id: Optional job ID (auto-generated UUID if not provided)
            start_now: If True, set started_at to now

        Returns:
            The newly created LongRunningJob instance
        """
        if job_id is None:
            job_id = str(uuid.uuid4())
        job = cls.objects.create(
            started_by=user,
            job_id=str(job_id),
            queued_at=timezone.now(),
            job_type=job_type,
        )
        if start_now:
            job.start()
        return job

    @classmethod
    def claim(
        cls, user: User, job_type: int, job_id: uuid.UUID | str | None
    ) -> LongRunningJob | None:
        """Mark the queued job ``job_id`` as started, for the task that runs it.

        The row was written when the job was queued (``api.jobs.queue``). The
        claim is one conditional update (``started_at = now`` where the row is
        unfinished and not started yet), so a job cancelled or failed by
        ``cleanup_stuck_jobs`` while it waited, or a task delivered twice, gets
        ``None``: the task returns without doing any work.

        ``job_id=None`` (a job chained in front of another, such as the model
        download before a scan) and an id with no row (a task queued before
        rows were written at queue time, or a direct call such as
        ``manage.py scan``) create a started row instead.
        """
        if job_id is None:
            return cls.create_job(user=user, job_type=job_type, start_now=True)
        claimed = cls.objects.filter(
            job_id=str(job_id), finished=False, started_at__isnull=True
        ).update(started_at=timezone.now())
        if claimed:
            return cls.objects.get(job_id=str(job_id))
        if cls.objects.filter(job_id=str(job_id)).exists():
            logger.info(
                "job %s was cancelled, timed out or already started before "
                "this task ran; nothing to do",
                job_id,
            )
            return None
        logger.warning(
            "job %s has no row, creating it: a task queued before rows were "
            "written at queue time, or a direct call (manage.py scan)",
            job_id,
        )
        return cls.create_job(
            user=user, job_type=job_type, job_id=job_id, start_now=True
        )

    @classmethod
    def complete_unclaimed(cls, job_id: uuid.UUID | str | None) -> None:
        """Finish the queued job ``job_id`` whose task found nothing to do.

        Such a task returns before ``claim``; without this the row would stay
        queued, and keep ``/api/rqavailable/`` busy, until the stuck-job
        cleanup. A missing row (``None``, a direct call) is left missing.
        """
        if job_id is None:
            return
        now = timezone.now()
        cls.objects.filter(
            job_id=str(job_id), finished=False, started_at__isnull=True
        ).update(started_at=now, finished=True, finished_at=now)

    @classmethod
    def cleanup_stuck_jobs(cls, hours: int | None = None) -> int:
        """Mark jobs failed that have reported no progress for ``hours``.

        See ``LongRunningJobQuerySet.stuck``: a job is stuck when it is
        unfinished and neither reported progress nor started (a never-started
        orphan: nor was queued) within ``hours``. The error is added to the
        job's ``result``, so what it recorded (errors, the scan's follow-up
        options) stays visible.

        Args:
            hours: Hours without progress after which a job is stuck.
                Defaults to ``STUCK_JOB_HOURS``.

        Returns:
            Number of jobs marked as failed
        """
        if hours is None:
            hours = stuck_job_hours()
        error = f"Job made no progress for {hours} hours"
        count = 0
        for job in cls.objects.stuck(hours).only("pk", "result"):
            result = dict(job.result) if isinstance(job.result, dict) else {}
            result.update(status="failed", error=error)
            # Conditional: a job that finished meanwhile is left alone.
            count += cls.objects.filter(pk=job.pk, finished=False).update(
                failed=True,
                finished=True,
                finished_at=timezone.now(),
                result=result,
            )
        return count

    @classmethod
    def cleanup_old_jobs(cls, days: int = 30) -> int:
        """
        Delete completed/failed jobs older than specified days, but always keep
        the most recent finished job of each (user, job_type) and that type's
        incremental baseline (``baseline_for``).

        The baseline is preserved regardless of age: the incremental scan and
        its follow-up jobs use it to decide which files and photos can be
        skipped. Deleting it leaves no baseline, so the next scan reprocesses
        (and re-enriches) the entire library. It is not always the newest
        finished job: a newer cancelled run or file-list scan is not one.
        Older finished jobs of the same type are still pruned as litter.

        Args:
            days: Number of days after which surplus completed jobs are deleted

        Returns:
            Number of jobs deleted
        """
        cutoff = timezone.now() - timedelta(days=days)

        # Preserve the most recent finished job of each (user, job_type) and
        # its incremental baseline at any age. The number of groups is bounded
        # by users x job types, so this loop is cheap.
        keep_ids: set[int] = set()
        groups = (
            cls.objects.filter(finished=True, finished_at__isnull=False)
            .values_list("started_by_id", "job_type")
            .distinct()
        )
        for started_by_id, job_type in groups:
            runs = cls.objects.filter(started_by_id=started_by_id, job_type=job_type)
            for candidates in (
                runs.filter(finished=True, finished_at__isnull=False),
                runs.baselines(job_type),
            ):
                latest_id = (
                    candidates.order_by("-finished_at", "-id")
                    .values_list("id", flat=True)
                    .first()
                )
                if latest_id is not None:
                    keep_ids.add(latest_id)

        deleted, _ = (
            cls.objects.filter(finished=True, finished_at__lt=cutoff)
            .exclude(id__in=keep_ids)
            .delete()
        )
        return deleted
