from typing import Any

from django.core.management.base import BaseCommand, CommandError, CommandParser

from api.runtime import binaries
from api.thumbnails.metadata import strip_problems, strip_thumbnail_metadata

# A line per this many thumbnails; the Admin Area job reports more often.
PROGRESS_LINE_EVERY = 10000


class Command(BaseCommand):
    help = (
        "Remove the original photo's metadata (EXIF incl. GPS, XMP, a video's "
        "location) from thumbnails written before it was left out. Pixels and the "
        "ICC colour profile are kept; files without metadata are not touched. "
        "Admins can start the same work from Admin Area > Admin Tools."
    )

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Only count the thumbnails that still carry metadata",
        )

    def _progress(self, done: int, total: int) -> None:
        if done:
            self.stdout.write(f"{done}/{total} thumbnails checked")

    def handle(self, *args: Any, **options: Any) -> None:
        try:
            result = strip_thumbnail_metadata(
                dry_run=options["dry_run"],
                progress=self._progress,
                progress_every=PROGRESS_LINE_EVERY,
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
        problems = strip_problems(result)
        if problems:
            raise CommandError(f"{summary} {', '.join(problems)} (see above).")
        self.stdout.write(self.style.SUCCESS(summary))
