from django.core.management.base import BaseCommand
from django_q.models import Schedule
from django_q.tasks import schedule

from api.util import logger


class Command(BaseCommand):
    help = "Start the cleanup service."

    def handle(self, *args, **kwargs):
        if not Schedule.objects.filter(
            func="api.services.cleanup_deleted_photos"
        ).exists():
            schedule(
                "api.services.cleanup_deleted_photos",
                schedule_type=Schedule.DAILY,
            )
        # Mobile-v2 tombstone pruning (doc 04 §2): drop DeletionLog rows past
        # the 90-day sync horizon so the table cannot grow without bound.
        if not Schedule.objects.filter(
            func="api.services.prune_deletion_log"
        ).exists():
            schedule(
                "api.services.prune_deletion_log",
                schedule_type=Schedule.DAILY,
            )
        logger.info("Cleanup service started")
