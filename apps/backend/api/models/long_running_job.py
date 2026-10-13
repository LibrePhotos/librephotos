from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta
from typing import Any

from django.db import models
from django.utils import timezone

from api.models.scopes import OwnedQuerySet
from api.models.user import User, get_deleted_user

logger = logging.getLogger(__name__)

STUCK_JOB_HOURS = 24


class LongRunningJobQuerySet(OwnedQuerySet["LongRunningJob"]):
    """The user who started the job owns it."""

    owner_lookup = "started_by"

    def running(self) -> LongRunningJobQuerySet:
        """Jobs that are queued or running: unfinished and not stuck.

        A row is written when the job is queued (``api.jobs.queue``), so a
        queued job counts as running. Unfinished rows past the stuck-job
        threshold are left out, so an orphan (OOM, restart, uncaught
        exception) does not block anything while it waits for the hourly
        ``cleanup_stuck_jobs`` (#1919). Duplicate-start refusal and
        ``/api/rqavailable/`` both read this.
        """
        cutoff = timezone.now() - timedelta(hours=STUCK_JOB_HOURS)
        return self.filter(finished=False).filter(
            models.Q(started_at__gte=cutoff)
            | models.Q(started_at__isnull=True, queued_at__gte=cutoff)
        )


class LongRunningJob(models.Model):
    STUCK_JOB_HOURS = STUCK_JOB_HOURS

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
    )

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

    def fail(self, error: BaseException | str | None = None) -> bool:
        """Mark job as failed with optional error message, unless it was cancelled.

        Returns False when the job had been cancelled; the row is left as is.
        """
        self.failed = True
        self.finished = True
        self.finished_at = timezone.now()
        if error is not None:
            self.result = {"status": "failed", "error": str(error)}
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

    def update_progress(
        self, current: int, target: int | None = None, step: str | None = None
    ) -> None:
        """Update job progress counters and optional step description.

        Only the progress fields are written, so a cancel stays in place.
        """
        update_fields = ["progress_current"]
        self.progress_current = current
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
        return self._write_unless_cancelled(["result"])

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
        """
        Mark jobs as failed if they've been running (or queued) for too long.

        Jobs with finished=False are considered stuck when:
        - started_at is set and older than the threshold, or
        - started_at is null and queued_at is older than the threshold
          (never-started orphans from crashed workers).

        Args:
            hours: Hours after which a job is considered stuck.
                Defaults to STUCK_JOB_HOURS.

        Returns:
            Number of jobs marked as failed
        """
        if hours is None:
            hours = cls.STUCK_JOB_HOURS
        cutoff = timezone.now() - timedelta(hours=hours)
        stuck_jobs = cls.objects.filter(finished=False).filter(
            models.Q(started_at__isnull=False, started_at__lt=cutoff)
            | models.Q(started_at__isnull=True, queued_at__lt=cutoff)
        )
        count = stuck_jobs.count()
        stuck_jobs.update(
            failed=True,
            finished=True,
            finished_at=timezone.now(),
            result={"status": "failed", "error": f"Job timed out after {hours} hours"},
        )
        return count

    @classmethod
    def cleanup_old_jobs(cls, days: int = 30) -> int:
        """
        Delete completed/failed jobs older than specified days, but always keep
        the most recent finished job of each (user, job_type).

        The latest finished job per type is preserved regardless of age because
        the incremental scan uses it as the "last scan" baseline: it is queried
        in ``api/directory_watcher/scan_jobs.py`` and ``processing_jobs.py`` to
        decide which photos can be skipped. Deleting it leaves no baseline, so
        the next scan reprocesses (and re-enriches) the entire library. Older
        finished jobs of the same type are still pruned as litter.

        Args:
            days: Number of days after which surplus completed jobs are deleted

        Returns:
            Number of jobs deleted
        """
        cutoff = timezone.now() - timedelta(days=days)

        # Preserve the most recent finished job of each (user, job_type) — the
        # incremental-scan baseline — at any age. The number of groups is
        # bounded by users x job types, so this loop is cheap.
        keep_ids: set[int] = set()
        groups = (
            cls.objects.filter(finished=True, finished_at__isnull=False)
            .values_list("started_by_id", "job_type")
            .distinct()
        )
        for started_by_id, job_type in groups:
            latest_id = (
                cls.objects.filter(
                    finished=True,
                    finished_at__isnull=False,
                    started_by_id=started_by_id,
                    job_type=job_type,
                )
                .order_by("-finished_at", "-id")
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
