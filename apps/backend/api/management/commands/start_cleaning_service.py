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
        logger.info("Cleanup service started")
