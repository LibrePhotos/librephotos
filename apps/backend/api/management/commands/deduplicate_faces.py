from typing import Any

from django.core.management.base import BaseCommand, CommandError, CommandParser

from api.faces.deduplicate import DEDUPLICATE_FACES_CHUNK_SIZE, deduplicate_faces
from api.models.user import User


class Command(BaseCommand):
    help = (
        "Delete duplicate faces: two overlapping faces of one photo are one face "
        "found twice, and the one with a person label is kept. Every user's photos, "
        "or one user's with --user. Admins can start the same work from "
        "Admin Area > Admin Tools."
    )

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument(
            "--user", help="Only the photos of the user with this username"
        )
        parser.add_argument(
            "--chunk-size",
            type=int,
            default=DEDUPLICATE_FACES_CHUNK_SIZE,
            help=f"Photos compared at a time (default {DEDUPLICATE_FACES_CHUNK_SIZE})",
        )

    def _progress(self, done: int, total: int) -> None:
        self.stdout.write(f"{done}/{total} photos checked")

    def handle(self, *args: Any, **options: Any) -> None:
        if options["chunk_size"] < 1:
            raise CommandError("--chunk-size must be at least 1")
        user = None
        if options["user"]:
            user = User.objects.filter(username=options["user"]).first()
            if user is None:
                raise CommandError(f"No user {options['user']!r}")
        result = deduplicate_faces(
            user, chunk_size=options["chunk_size"], progress=self._progress
        )
        self.stdout.write(
            self.style.SUCCESS(
                f"Deleted {result.deleted} duplicate face(s) "
                f"on {result.photos} photo(s) with two faces or more."
            )
        )
