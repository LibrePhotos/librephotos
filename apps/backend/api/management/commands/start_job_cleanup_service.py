import logging
from typing import Any

from django.core.management.base import BaseCommand
from django_q.models import Schedule

from api.jobs.cleanup import OLD_STUCK_JOBS_FUNC, STUCK_JOBS_FUNC
from api.jobs.queue import ensure_schedule, remove_schedule
from api.jobs.upload_import import SWEEP_FUNC

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = (
        "Start the job cleanup service to mark stuck jobs as failed, remove old "
        "completed jobs and delete expired chunked uploads."
    )

    def handle(self, *args: Any, **kwargs: Any) -> None:
        # Hourly: fail the jobs that made no progress for STUCK_JOB_HOURS and
        # that no live cluster still works on. An install from before 1.5.0
        # has the schedule of the model method, which fails those too.
        if remove_schedule(OLD_STUCK_JOBS_FUNC):
            logger.info("Removed the stuck job cleanup's schedule of 1.4.0")
        if ensure_schedule(STUCK_JOBS_FUNC, schedule_type=Schedule.HOURLY):
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

        # Seal idle upload import jobs and finish lost ones (#2737).
        if ensure_schedule(SWEEP_FUNC, schedule_type=Schedule.MINUTES, minutes=1):
            logger.info("Scheduled the upload import sweeper")

        logger.info("Job cleanup service started")
