import uuid
from datetime import datetime, timedelta

from django.db import models
from django.utils import timezone

from api.models.user import User, get_deleted_user


class LongRunningJob(models.Model):
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
    )

    job_type = models.PositiveIntegerField(
        choices=JOB_TYPES,
    )

    finished = models.BooleanField(default=False, blank=False, null=False)
    failed = models.BooleanField(default=False, blank=False, null=False)
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
    progress_step = models.CharField(max_length=100, null=True, blank=True)  # Current step description
    result = models.JSONField(null=True, blank=True)  # Detailed result/progress data

    class Meta:
        ordering = ["-queued_at"]
        verbose_name = "Long Running Job"
        verbose_name_plural = "Long Running Jobs"

    def __str__(self):
        status = "failed" if self.failed else ("finished" if self.finished else "running" if self.started_at else "queued")
        return f"Job {self.job_id} - {self.get_job_type_display()} - {status}"

    @property
    def is_running(self):
        """Check if job is currently running (started but not finished)."""
        return self.started_at is not None and not self.finished

    @property
    def duration(self):
        """Return job duration in seconds, or None if not started."""
        if not self.started_at:
            return None
        end = self.finished_at or timezone.now()
        return (end - self.started_at).total_seconds()

    def start(self):
        """Mark job as started."""
        self.started_at = timezone.now()
        self.save(update_fields=["started_at"])

    def complete(self, result=None):
        """Mark job as successfully completed."""
        self.finished = True
        self.finished_at = timezone.now()
        if result is not None:
            self.result = result
        self.save(update_fields=["finished", "finished_at", "result"])

    def fail(self, error=None):
        """Mark job as failed with optional error message."""
        self.failed = True
        self.finished = True
        self.finished_at = timezone.now()
        if error is not None:
            self.result = {"status": "failed", "error": str(error)}
        self.save(update_fields=["failed", "finished", "finished_at", "result"])

    def update_progress(self, current, target=None, step=None):
        """Update job progress counters and optional step description."""
        update_fields = ["progress_current"]
        self.progress_current = current
        if target is not None:
            self.progress_target = target
            update_fields.append("progress_target")
        if step is not None:
            self.progress_step = step
            update_fields.append("progress_step")
        self.save(update_fields=update_fields)

    def set_result(self, result):
        """Update the job result/progress data."""
        self.result = result
        self.save(update_fields=["result"])

    @classmethod
    def create_job(cls, user, job_type, job_id=None, start_now=False):
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
    def get_or_create_job(cls, user, job_type, job_id):
        """
        Get an existing job by job_id or create a new one.
        
        This is useful for queued jobs where the job_id is known ahead of time.
        If the job exists, it will be marked as started. If not, a new job is created.
        
        Args:
            user: The user who started the job
            job_type: One of the JOB_* constants
            job_id: The job ID to look up or use for creation
        
        Returns:
            The LongRunningJob instance (existing or newly created)
        """
        if cls.objects.filter(job_id=job_id).exists():
            job = cls.objects.get(job_id=job_id)
            job.start()
            return job
        return cls.create_job(user=user, job_type=job_type, job_id=job_id, start_now=True)

    @classmethod
    def cleanup_stuck_jobs(cls, hours=24):
        """
        Mark jobs as failed if they've been running for too long.
        
        Jobs that have started_at set but finished=False for longer than
        the specified hours are considered stuck and will be marked as failed.
        
        Args:
            hours: Number of hours after which a running job is considered stuck
        
        Returns:
            Number of jobs marked as failed
        """
        cutoff = timezone.now() - timedelta(hours=hours)
        stuck_jobs = cls.objects.filter(
            finished=False,
            started_at__isnull=False,
            started_at__lt=cutoff
        )
        count = stuck_jobs.count()
        stuck_jobs.update(
            failed=True,
            finished=True,
            finished_at=timezone.now(),
            result={"status": "failed", "error": f"Job timed out after {hours} hours"}
        )
        return count

    @classmethod
    def cleanup_old_jobs(cls, days=30):
        """
        Delete completed/failed jobs older than specified days.
        
        Args:
            days: Number of days after which completed jobs should be deleted
        
        Returns:
            Number of jobs deleted
        """
        cutoff = timezone.now() - timedelta(days=days)
        deleted, _ = cls.objects.filter(
            finished=True,
            finished_at__lt=cutoff
        ).delete()
        return deleted
