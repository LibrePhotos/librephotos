from django.core.management.base import BaseCommand

from api.models import Photo, User


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

    def select_photos(self, username, metadata_types):
        photos = Photo.objects.all()

        if username:
            try:
                user = User.objects.get(username=username)
            except User.DoesNotExist:
                self.stderr.write(f"User '{username}' not found")
                return None
            photos = photos.filter(owner=user)

        # When only writing face tags, filter to photos with any (non-deleted) faces
        if metadata_types == ["face_tags"]:
            photos = photos.filter(
                faces__deleted=False,
            ).distinct()

        return photos

    def write_photos(self, photos, total, use_sidecar, metadata_types):
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

        return written, errors

    def handle(self, *args, **options):
        metadata_types = options["types"]

        photos = self.select_photos(options["user"], metadata_types)
        if photos is None:
            return

        total = photos.count()
        self.stdout.write(f"Found {total} photos to process (types: {metadata_types})")

        if options["dry_run"]:
            self.stdout.write("Dry run — no files will be modified")
            return

        written, errors = self.write_photos(
            photos, total, not options["media_file"], metadata_types
        )

        self.stdout.write(
            self.style.SUCCESS(
                f"Done. {written} written, {errors} errors out of {total} photos."
            )
        )
