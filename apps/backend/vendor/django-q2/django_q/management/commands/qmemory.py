from django.core.management.base import BaseCommand
from django.utils.translation import gettext as _

from django_q.monitor_terminal import memory


class Command(BaseCommand):
    # Translators: help text for qmemory management command
    help = _("Monitors Q Cluster memory usage")

    def add_arguments(self, parser):
        parser.add_argument(
            "--run-once",
            action="store_true",
            dest="run_once",
            default=False,
            help="Run once and then stop.",
        )
        parser.add_argument(
            "--workers",
            action="store_true",
            dest="workers",
            default=False,
            help="Show each worker's memory usage.",
        )

    def handle(self, *args, **options):
        memory(
            run_once=options.get("run_once", False),
            workers=options.get("workers", False),
        )
