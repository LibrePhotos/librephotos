from typing import Any

from django.core.management.base import BaseCommand, CommandParser
from django_q.models import Schedule

from api.jobs.queue import ensure_schedule
from api.runtime.supervisor import (
    SERVICES,
    disabled_reason,
    is_service_enabled,
    start_error,
    start_service,
    start_services,
)


class Command(BaseCommand):
    help = "Start one of the services."

    # Define all the services that can be started
    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument(
            "service",
            type=str,
            help="The service to start",
            choices=[*SERVICES, "all"],
        )

    def handle(self, *args: Any, **kwargs: Any) -> None:
        service = kwargs["service"]
        if service == "all":
            enabled = []
            for svc in SERVICES.keys():
                if not is_service_enabled(svc):
                    self.stdout.write(f"Skipping {svc}: {disabled_reason(svc)}")
                    continue
                enabled.append(svc)
            self._summarise(start_services(enabled))
            ensure_schedule(
                "api.runtime.supervisor.check_services",
                schedule_type=Schedule.MINUTES,
                minutes=1,
            )
        else:
            self._summarise({service: start_service(service)})

    def _summarise(self, results: dict[str, bool]) -> None:
        """One line per sidecar that did not come up, with the reason (#2324)."""
        for svc, started in results.items():
            if not started:
                reason = start_error(svc) or "see the log above"
                self.stdout.write(f"Service {svc} could not start: {reason}")
