from typing import Any

from django.core.management.base import BaseCommand, CommandError, CommandParser

from api import binaries
from api.thumbnails.metadata import strip_thumbnail_metadata


class Command(BaseCommand):
    help = (
        "Remove the original photo's metadata (EXIF incl. GPS, XMP, a video's "
        "location) from thumbnails written before it was left out. Pixels and the "
        "ICC colour profile are kept; files without metadata are not touched."
    )

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Only count the thumbnails that still carry metadata",
        )

    def handle(self, *args: Any, **options: Any) -> None:
        try:
            result = strip_thumbnail_metadata(
                dry_run=options["dry_run"], progress=self.stdout.write
            )
        except binaries.ToolError as failure:
            # ExifTool could not say which video thumbnails carry metadata.
            raise CommandError(str(failure)) from failure
        self.stdout.write(
            f"Scanned {result.scanned} thumbnails, "
            f"{len(result.with_metadata)} carried metadata."
        )
        for error in result.errors:
            self.stderr.write(error)
        if options["dry_run"]:
            return
        for path in result.still_with_metadata:
            self.stderr.write(f"Could not strip {path}")
        summary = f"Stripped {result.stripped} thumbnails."
        # A thumbnail that could not be read or rewritten is not counted as
        # still carrying metadata, but nothing says it does not. Errors are
        # not thumbnails: a failed ExifTool batch of videos is one.
        problems = []
        if result.still_with_metadata:
            problems.append(f"{len(result.still_with_metadata)} still carry metadata")
        if result.errors:
            count = len(result.errors)
            problems.append(f"{count} error{'' if count == 1 else 's'} (see above)")
        if problems:
            raise CommandError(f"{summary} {', '.join(problems)}.")
        self.stdout.write(self.style.SUCCESS(summary))
