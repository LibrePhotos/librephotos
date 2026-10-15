from typing import Any

from django.core.management.base import BaseCommand, CommandError, CommandParser

from api.metadata.library_write import (
    BATCH_SIZE,
    WRITE_TYPES,
    WriteOutcome,
    count_photos_to_write,
    photos_to_write,
    writable_types,
    write_photos,
)
from api.metadata.photo_writer import write_target
from api.models import Photo, User

# The modes in which a user's edits are written to disk (write_target is not
# None); photos of everyone else are skipped.
SYNCING_MODES = (User.SaveMetadata.SIDECAR_FILE, User.SaveMetadata.MEDIA_FILE)


class Command(BaseCommand):
    help = (
        "Write the edits already in LibrePhotos (ratings, dates, rotations, "
        "captions, locations, tags as keywords, face tags) to XMP sidecar files "
        "or the media files, as each photo's owner has chosen under 'Write "
        "edits to files'. Only photos with something to write are written; "
        "photos of users who have it Off are skipped. The web app's Settings > "
        "Metadata Options > Write now runs the same writes as a job."
    )

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument(
            "--types",
            nargs="+",
            choices=list(WRITE_TYPES),
            help=(
                "Which metadata to write (default: everything; face_tags only "
                "for users with 'Write face tags to image files' on)"
            ),
        )
        parser.add_argument(
            "--user",
            type=str,
            help="Only process photos owned by this username",
        )
        target = parser.add_mutually_exclusive_group()
        target.add_argument(
            "--sidecar",
            action="store_true",
            help=(
                "Write to XMP sidecar files whatever the user's setting says "
                "(needs --user)"
            ),
        )
        target.add_argument(
            "--media-file",
            action="store_true",
            help=(
                "Write into the media files whatever the user's setting says "
                "(needs --user)"
            ),
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Only show what would be written, don't actually write",
        )

    def select_targets(
        self, username: str | None, override: bool | None
    ) -> list[tuple[User, bool]]:
        """Each user whose photos are written, with ``use_sidecar``.

        Raises when ``username`` is unknown. Without an override, users with
        "Write edits to files" Off are left out.
        """
        users = User.objects.order_by("pk")
        if username:
            users = users.filter(username=username)
            if not users.exists():
                raise CommandError(f"User '{username}' not found")
        if override is not None:
            return [(user, override) for user in users]
        skipped = Photo.objects.exclude(owner__save_metadata_to_disk__in=SYNCING_MODES)
        if username:
            skipped = skipped.filter(owner__username=username)
        if skipped.exists():
            self.stdout.write(
                f"Skipping {skipped.count()} photos of users with "
                "'Write edits to files' Off"
            )
        return [
            (user, use_sidecar)
            for user in users.filter(save_metadata_to_disk__in=SYNCING_MODES)
            if (use_sidecar := write_target(user)) is not None
        ]

    def write_user(
        self,
        user: User,
        types: list[str],
        use_sidecar: bool,
        dry_run: bool,
        total: WriteOutcome,
    ) -> None:
        """Write ``types`` of ``user``'s photos in batches, adding to ``total``."""
        photo_ids = list(
            photos_to_write(user, types).order_by("pk").values_list("pk", flat=True)
        )
        target = "sidecar files" if use_sidecar else "media files"
        self.stdout.write(
            f"{user.username}: {len(photo_ids)} photos to write to {target} "
            f"(types: {', '.join(types)})"
        )
        if dry_run:
            for name, count in count_photos_to_write(user, types).items():
                self.stdout.write(f"  {name}: {count} photos")
            return
        done = 0
        for start in range(0, len(photo_ids), BATCH_SIZE):
            batch = photo_ids[start : start + BATCH_SIZE]
            outcome = write_photos(user, batch, types, use_sidecar)
            for error in outcome.errors:
                self.stderr.write(f"Error writing {error}")
            total.written += outcome.written
            total.skipped += outcome.skipped
            total.errors.extend(outcome.errors)
            done += len(batch)
            self.stdout.write(f"  Progress: {done}/{len(photo_ids)}")

    @staticmethod
    def target_override(options: dict[str, Any]) -> bool | None:
        """``use_sidecar`` forced by --sidecar / --media-file, or None."""
        if options["media_file"]:
            override = False
        elif options["sidecar"]:
            override = True
        else:
            return None
        if not options["user"]:
            raise CommandError(
                "--sidecar and --media-file override a user's 'Write edits to "
                "files' setting; name that user with --user"
            )
        return override

    def handle(self, *args: Any, **options: Any) -> None:
        override = self.target_override(options)
        total = WriteOutcome()
        for user, use_sidecar in self.select_targets(options["user"], override):
            types = options["types"] or writable_types(user)
            self.write_user(user, types, use_sidecar, options["dry_run"], total)

        if options["dry_run"]:
            self.stdout.write("Dry run: no files were changed")
            return
        self.stdout.write(
            self.style.SUCCESS(
                f"Done. {total.written} written, {total.skipped} skipped, "
                f"{len(total.errors)} failed."
            )
        )
