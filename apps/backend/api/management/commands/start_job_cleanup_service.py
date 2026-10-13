import logging
from typing import Any

from django.core.management.base import BaseCommand
from django_q.models import Schedule

from api.jobs.queue import ensure_schedule

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = (
        "Start the job cleanup service to mark stuck jobs as failed, remove old "
        "completed jobs and delete expired chunked uploads."
    )

    def handle(self, *args: Any, **kwargs: Any) -> None:
        # Schedule hourly cleanup of stuck jobs (running for more than 24 hours)
        if ensure_schedule(
            "api.models.long_running_job.LongRunningJob.cleanup_stuck_jobs",
            schedule_type=Schedule.HOURLY,
        ):
            logger.info("Scheduled hourly stuck job cleanup")

        # Schedule daily cleanup of old completed jobs (older than 30 days)
        if ensure_schedule(
            "api.models.long_running_job.LongRunningJob.cleanup_old_jobs",
            schedule_type=Schedule.DAILY,
        ):
            logger.info("Scheduled daily old job cleanup")

        # Schedule daily removal of cancelled and abandoned chunked uploads
        # (older than CHUNKED_UPLOAD_EXPIRATION_DELTA, one day by default)
        if ensure_schedule(
            "chunked_upload.cleanup.delete_expired_uploads",
            schedule_type=Schedule.DAILY,
        ):
            logger.info("Scheduled daily expired upload cleanup")

        logger.info("Job cleanup service started")
