from django.core.management.base import BaseCommand
from django_q.models import Schedule
from django_q.tasks import schedule

from api.services import (
    SERVICE_FEATURE_FLAGS,
    SERVICES,
    is_service_enabled,
    start_service,
)


class Command(BaseCommand):
    help = "Start one of the services."

    # Define all the services that can be started
    def add_arguments(self, parser):
        parser.add_argument(
            "service",
            type=str,
            help="The service to start",
            choices=[
                SERVICES.keys(),
                "all",
            ],
        )

    def handle(self, *args, **kwargs):
        service = kwargs["service"]
        if service == "all":
            for svc in SERVICES.keys():
                if not is_service_enabled(svc):
                    self.stdout.write(
                        f"Skipping {svc}: {SERVICE_FEATURE_FLAGS[svc]} is disabled"
                    )
                    continue
                start_service(svc)
            if not Schedule.objects.filter(func="api.services.check_services").exists():
                schedule(
                    "api.services.check_services",
                    schedule_type=Schedule.MINUTES,
                    minutes=1,
                )
        else:
            start_service(service)
