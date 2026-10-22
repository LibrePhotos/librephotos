import logging
from typing import Any

from django.core.management.base import BaseCommand
from django_q.models import Schedule

from api.directory_watcher.scan_schedule import sync_scan_schedule
from api.jobs.queue import ensure_schedule
from api.updates.check import SCHEDULED_CHECK

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = (
        "Start the cleanup service, the automatic library scan's schedule and"
        " the daily update check."
    )

    def handle(self, *args: Any, **kwargs: Any) -> None:
        # The trash retention (#2203). Deletes nothing until an admin sets
        # TRASH_RETENTION_DAYS; runs before the removed-photo cleanup.
        ensure_schedule(
            "api.photos.retention.empty_expired_trash", schedule_type=Schedule.DAILY
        )
        ensure_schedule(
            "api.photos.retention.cleanup_deleted_photos", schedule_type=Schedule.DAILY
        )
        # Mobile-v2 tombstone pruning (doc 04 §2): drop DeletionLog rows past
        # the 90-day sync horizon so the table cannot grow without bound.
        ensure_schedule(
            "api.photos.retention.prune_deletion_log", schedule_type=Schedule.DAILY
        )
        # The automatic library scan (#235) follows its site setting; saving the
        # setting does the same. This puts back a schedule deleted by hand, or
        # one a setting changed in the Django admin left behind.
        sync_scan_schedule()
        # The daily check for a newer release (#2311). Its first run is now, so
        # a new install knows at once; it sends nothing while the check is off.
        ensure_schedule(SCHEDULED_CHECK, schedule_type=Schedule.DAILY)
        logger.info("Cleanup service started")
