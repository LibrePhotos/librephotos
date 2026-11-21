from __future__ import annotations

from django.db import models
from django.utils import timezone

WAITING = "waiting"
QUEUED = "queued"
RUNNING = "running"
FAILED = "failed"
CANCELLED = "cancelled"
OPEN_STATUSES = (WAITING, QUEUED, RUNNING)

DEFAULT_QUEUE = "default"
HEAVY_QUEUE = "heavy"
GEOCODE_QUEUE = "geocode"
QUEUES = (DEFAULT_QUEUE, HEAVY_QUEUE, GEOCODE_QUEUE)


class TaskGroup(models.Model):
    total = models.PositiveIntegerField()
    ended = models.PositiveIntegerField(default=0)
    fired = models.BooleanField(default=False)
    created_at = models.DateTimeField(default=timezone.now)

    def __str__(self) -> str:
        return f"Task group {self.pk}: {self.ended}/{self.total}"


class QueuedTaskQuerySet(models.QuerySet["QueuedTask"]):
    def open(self) -> QueuedTaskQuerySet:
        return self.filter(status__in=OPEN_STATUSES)

    def of_job(self, job_id: str) -> QueuedTaskQuerySet:
        return self.filter(job_id=str(job_id))


class QueuedTask(models.Model):
    STATUSES = (
        (WAITING, "Waiting"),
        (QUEUED, "Queued"),
        (RUNNING, "Running"),
        (FAILED, "Failed"),
        (CANCELLED, "Cancelled"),
    )

    func = models.CharField(max_length=200)
    args = models.JSONField(default=list)
    kwargs = models.JSONField(default=dict)
    queue = models.CharField(max_length=32, default=DEFAULT_QUEUE)
    priority = models.SmallIntegerField(default=0)
    status = models.CharField(max_length=10, choices=STATUSES, default=QUEUED)
    run_after = models.DateTimeField(default=timezone.now)
    lease_until = models.DateTimeField(null=True, blank=True)
    worker = models.CharField(max_length=100, blank=True, default="")
    attempts = models.PositiveSmallIntegerField(default=0)
    max_attempts = models.PositiveSmallIntegerField(default=3)
    after = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.SET_NULL, related_name="next"
    )
    continue_on_error = models.BooleanField(default=False)
    group = models.ForeignKey(
        TaskGroup,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="tasks",
    )
    is_group_followup = models.BooleanField(default=False)
    dedupe_key = models.CharField(max_length=200, blank=True, default="")
    job_id = models.CharField(max_length=36, blank=True, default="", db_index=True)
    error = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(default=timezone.now)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    objects = QueuedTaskQuerySet.as_manager()

    class Meta:
        indexes = [
            models.Index(
                fields=["queue", "-priority", "id"],
                condition=models.Q(status=QUEUED),
                name="queuedtask_claim_idx",
            ),
            models.Index(
                fields=["lease_until"],
                condition=models.Q(status=RUNNING),
                name="queuedtask_lease_idx",
            ),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["dedupe_key"],
                condition=models.Q(status__in=OPEN_STATUSES) & ~models.Q(dedupe_key=""),
                name="queuedtask_open_dedupe_key",
            ),
        ]

    def __str__(self) -> str:
        return f"Task {self.pk} {self.func} ({self.status})"


class TaskSchedule(models.Model):
    ONCE = "O"
    MINUTES = "I"
    HOURLY = "H"
    DAILY = "D"
    TYPES = (
        (ONCE, "Once"),
        (MINUTES, "Minutes"),
        (HOURLY, "Hourly"),
        (DAILY, "Daily"),
    )

    name = models.CharField(max_length=100, blank=True, default="")
    func = models.CharField(max_length=200)
    args = models.JSONField(default=list)
    kwargs = models.JSONField(default=dict)
    schedule_type = models.CharField(max_length=1, choices=TYPES, default=ONCE)
    minutes = models.PositiveIntegerField(null=True, blank=True)
    next_run = models.DateTimeField(default=timezone.now)
    intended_date_kwarg = models.CharField(max_length=100, blank=True, default="")
    last_run = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [models.Index(fields=["next_run"], name="taskschedule_next_run_idx")]
        constraints = [
            models.UniqueConstraint(
                fields=["name"],
                condition=~models.Q(name=""),
                name="taskschedule_unique_name",
            ),
        ]

    def __str__(self) -> str:
        return f"Schedule {self.name or self.func} ({self.schedule_type})"


class WorkerProcess(models.Model):
    name = models.CharField(max_length=100, unique=True)
    host = models.CharField(max_length=255)
    pid = models.PositiveIntegerField()
    slot = models.PositiveSmallIntegerField()
    started_at = models.DateTimeField(default=timezone.now)
    heartbeat_at = models.DateTimeField(default=timezone.now)
    rss_mb = models.PositiveIntegerField(default=0)
    task_id = models.BigIntegerField(null=True, blank=True)
    last_recycle = models.CharField(max_length=100, blank=True, default="")
    memory_recycles = models.PositiveIntegerField(default=0)

    def __str__(self) -> str:
        return f"Worker {self.name}"


class Throttle(models.Model):
    key = models.CharField(max_length=100, primary_key=True)
    next_at = models.DateTimeField(default=timezone.now)

    def __str__(self) -> str:
        return f"Throttle {self.key}"
