from django.core.management.base import BaseCommand

from api.models import Photo, User
from api.models.person import Person


class Command(BaseCommand):
    help = "Save metadata to image files (or XMP sidecar files)"

    def add_arguments(self, parser):
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
        parser.add_argument(
            "--sidecar",
            action="store_true",
            default=True,
            help="Write to XMP sidecar files (default)",
        )
        parser.add_argument(
            "--media-file",
            action="store_true",
            help="Write directly to media files instead of sidecars",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Only show what would be written, don't actually write",
        )

    def handle(self, *args, **options):
        metadata_types = options["types"]
        use_sidecar = not options["media_file"]

        photos = Photo.objects.all()

        if options["user"]:
            try:
                user = User.objects.get(username=options["user"])
                photos = photos.filter(owner=user)
            except User.DoesNotExist:
                self.stderr.write(f"User '{options['user']}' not found")
                return

        # When only writing face tags, filter to photos with any (non-deleted) faces
        if metadata_types == ["face_tags"]:
            photos = photos.filter(
                faces__deleted=False,
            ).distinct()

        total = photos.count()
        self.stdout.write(f"Found {total} photos to process (types: {metadata_types})")

        if options["dry_run"]:
            self.stdout.write("Dry run — no files will be modified")
            return

        written = 0
        errors = 0
        for i, photo in enumerate(photos.iterator(), 1):
            try:
                photo._save_metadata(
                    use_sidecar=use_sidecar, metadata_types=metadata_types
                )
                written += 1
            except Exception as e:
                errors += 1
                self.stderr.write(f"Error writing {photo.image_hash}: {e}")

            if i % 100 == 0:
                self.stdout.write(
                    f"Progress: {i}/{total} ({written} written, {errors} errors)"
                )

        self.stdout.write(
            self.style.SUCCESS(
                f"Done. {written} written, {errors} errors out of {total} photos."
            )
        )
