from django.core.management.base import BaseCommand
from django_q.models import Schedule
from django_q.tasks import schedule

from api.util import logger


class Command(BaseCommand):
    help = "Start the job cleanup service to mark stuck jobs as failed and remove old completed jobs."

    def handle(self, *args, **kwargs):
        # Schedule hourly cleanup of stuck jobs (running for more than 24 hours)
        if not Schedule.objects.filter(
            func="api.models.long_running_job.LongRunningJob.cleanup_stuck_jobs"
        ).exists():
            schedule(
                "api.models.long_running_job.LongRunningJob.cleanup_stuck_jobs",
                schedule_type=Schedule.HOURLY,
            )
            logger.info("Scheduled hourly stuck job cleanup")

        # Schedule daily cleanup of old completed jobs (older than 30 days)
        if not Schedule.objects.filter(
            func="api.models.long_running_job.LongRunningJob.cleanup_old_jobs"
        ).exists():
            schedule(
                "api.models.long_running_job.LongRunningJob.cleanup_old_jobs",
                schedule_type=Schedule.DAILY,
            )
            logger.info("Scheduled daily old job cleanup")

        logger.info("Job cleanup service started")
