from django.core.management.base import BaseCommand
from django.utils.translation import gettext as _

from django_q import VERSION
from django_q.conf import Conf
from django_q.monitor_terminal import get_ids, info


class Command(BaseCommand):
    # Translators: help text for qinfo management command
    help = _("General information over all clusters.")

    def add_arguments(self, parser):
        parser.add_argument(
            "--config",
            action="store_true",
            dest="config",
            default=False,
            help="Print current configuration.",
        )
        parser.add_argument(
            "--ids",
            action="store_true",
            dest="ids",
            default=False,
            help="Print cluster task ID(s) (PIDs).",
        )

    def handle(self, *args, **options):
        if options.get("ids", True):
            get_ids()
        elif options.get("config", False):
            hide = [
                "conf",
                "IDLE",
                "STOPPING",
                "STARTING",
                "WORKING",
                "SIGNAL_NAMES",
                "STOPPED",
            ]
            settings = [
                a for a in dir(Conf) if not a.startswith("__") and a not in hide
            ]
            self.stdout.write(f"VERSION: {'.'.join(str(v) for v in VERSION)}")
            for setting in settings:
                value = getattr(Conf, setting)
                if value is not None:
                    self.stdout.write(f"{setting}: {value}")
        else:
            info()
