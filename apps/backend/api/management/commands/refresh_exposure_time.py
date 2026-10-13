from typing import Any

from django.core.management.base import BaseCommand, CommandParser

from api.metadata.photo_reader import misread_exposure_times, refresh_exposure_times


class Command(BaseCommand):
    help = (
        "Read the exposure time again for photos whose shutter speed an older "
        'version stored wrongly ("0" for anything faster than about 1/2000 s, '
        '"1/1000" for 1/1250 to 1/2000 s, "5/2" for 2.5 s). Only that one tag '
        "is read and only the shutter speed is written."
    )

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Only count the photos that would be read again",
        )

    def handle(self, *args: Any, **options: Any) -> None:
        rows = misread_exposure_times()
        if options["dry_run"]:
            count = rows.count()
            self.stdout.write(
                f"{count} photo{'' if count == 1 else 's'} may have a misread "
                "shutter speed."
            )
            return
        result = refresh_exposure_times(rows)
        summary = f"Updated {result.updated} of {result.checked} photos"
        if result.unreadable:
            summary += f"; {result.unreadable} could not be read"
        self.stdout.write(self.style.SUCCESS(summary + "."))
