from typing import Any

from django.core.management.base import BaseCommand, CommandError, CommandParser
from django.db.models import QuerySet

from api.metadata.photo_writer import write_photo_metadata, write_target
from api.metadata.writer import one_exiftool_process
from api.models import Photo, User

# The modes in which a user's edits are written to disk (write_target is not
# None); photos of everyone else are skipped.
SYNCING_MODES = (User.SaveMetadata.SIDECAR_FILE, User.SaveMetadata.MEDIA_FILE)


class Command(BaseCommand):
    help = (
        "Save metadata to XMP sidecar files or image files, as each photo's "
        "owner has chosen under 'Write edits to files'. Photos of "
        "users who have it Off are skipped."
    )

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument(
            "--types",
            nargs="+",
            choices=["ratings", "face_tags"],
            default=["ratings"],
            help="Which metadata types to write (default: ratings)",
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

    def select_photos(
        self, username: str | None, metadata_types: list[str]
    ) -> QuerySet[Photo] | None:
        photos = Photo.objects.all()

        if username:
            try:
                user = User.objects.get(username=username)
            except User.DoesNotExist:
                self.stderr.write(f"User '{username}' not found")
                return None
            photos = photos.owned_by(user)

        # When only writing face tags, filter to photos with any (non-deleted) faces
        if metadata_types == ["face_tags"]:
            photos = photos.filter(
                faces__deleted=False,
            ).distinct()

        return photos.select_related("owner", "main_file")

    def write_photos(
        self,
        photos: QuerySet[Photo],
        total: int,
        override: bool | None,
        metadata_types: list[str],
    ) -> tuple[int, int]:
        """Write each photo to its owner's target, or to ``override``'s."""
        written = 0
        errors = 0
        with one_exiftool_process():
            for i, photo in enumerate(photos.iterator(), 1):
                use_sidecar = (
                    override if override is not None else write_target(photo.owner)
                )
                if use_sidecar is None:
                    continue  # handle() keeps only the photos of owners who sync
                try:
                    write_photo_metadata(
                        photo, use_sidecar=use_sidecar, metadata_types=metadata_types
                    )
                    written += 1
                except Exception as e:
                    errors += 1
                    self.stderr.write(f"Error writing {photo.image_hash}: {e}")

                if i % 100 == 0:
                    self.stdout.write(
                        f"Progress: {i}/{total} ({written} written, {errors} errors)"
                    )

        return written, errors

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
                "--sidecar and --media-file override a user's 'Synchronize "
                "metadata to disk' setting; name that user with --user"
            )
        return override

    def handle(self, *args: Any, **options: Any) -> None:
        metadata_types = options["types"]
        override = self.target_override(options)

        photos = self.select_photos(options["user"], metadata_types)
        if photos is None:
            return

        if override is None:
            skipped = photos.exclude(owner__save_metadata_to_disk__in=SYNCING_MODES)
            skipped_count = skipped.count()
            if skipped_count:
                self.stdout.write(
                    f"Skipping {skipped_count} photos of users with "
                    "'Write edits to files' Off"
                )
            photos = photos.filter(owner__save_metadata_to_disk__in=SYNCING_MODES)

        total = photos.count()
        self.stdout.write(f"Found {total} photos to process (types: {metadata_types})")

        if options["dry_run"]:
            self.stdout.write("Dry run — no files will be modified")
            return

        written, errors = self.write_photos(photos, total, override, metadata_types)

        self.stdout.write(
            self.style.SUCCESS(
                f"Done. {written} written, {errors} errors out of {total} photos."
            )
        )
