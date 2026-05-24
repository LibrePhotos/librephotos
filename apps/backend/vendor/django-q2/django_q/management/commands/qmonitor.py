from django.core.management.base import BaseCommand
from django.utils.translation import gettext as _

from django_q.monitor_terminal import monitor


class Command(BaseCommand):
    # Translators: help text for qmonitor management command
    help = _("Monitors Q Cluster activity")

    def add_arguments(self, parser):
        parser.add_argument(
            "--run-once",
            action="store_true",
            dest="run_once",
            default=False,
            help="Run once and then stop.",
        )

    def handle(self, *args, **options):
        monitor(run_once=options.get("run_once", False))
