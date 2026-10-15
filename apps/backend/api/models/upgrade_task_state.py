from __future__ import annotations

from django.db import models
from django.utils import timezone


class UpgradeTaskState(models.Model):
    """What this instance did about one post-upgrade task (#2322).

    One row per task of ``api.jobs.upgrade_tasks.UPGRADE_TASKS``, for the whole
    instance: the tasks are about the library, not a user. A task that only
    applies to data an older release left behind gets its row from the
    migration that knows (only when there is such data, so a fresh install
    never sees it); the others get theirs the first time their check finds
    work. ``started_at`` is when the task was first started from the card or
    at startup (an automatic task is never queued by itself a second time),
    ``completed_at`` when it stopped being needed, ``dismissed_at`` when an
    admin chose **Not now** for an optional task.
    """

    key = models.CharField(max_length=64, unique=True)
    created_at = models.DateTimeField(default=timezone.now)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    dismissed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = "Upgrade Task State"
        verbose_name_plural = "Upgrade Task States"

    def __str__(self) -> str:
        return f"Upgrade task {self.key}"
