from typing import Any

from django.core.management.base import BaseCommand, CommandParser

from api.faces.turned_faces import repair_turned_faces
from api.models import User


class Command(BaseCommand):
    help = (
        "Move the faces imported a quarter turn off the face (#2887) onto the "
        "face the face scan found there, and delete that duplicate. A face is "
        "moved only when exactly one quarter turn lands on a face of the "
        "photo; the files are not changed."
    )

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Only count the faces that would be moved",
        )

    def handle(self, *args: Any, **options: Any) -> None:
        dry_run = options["dry_run"]
        result = repair_turned_faces(User.objects.order_by("pk"), apply=not dry_run)
        verb = "Would repair" if dry_run else "Repaired"
        summary = (
            f"{verb} {result.repaired} face(s) on {result.photos} photo(s) checked; "
            f"{result.skipped} left as they are"
        )
        if result.unreadable:
            summary += f"; {result.unreadable} photo(s) could not be read"
        self.stdout.write(self.style.SUCCESS(summary + "."))
