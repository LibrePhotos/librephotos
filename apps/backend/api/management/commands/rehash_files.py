from typing import Any

from django.core.management.base import BaseCommand, CommandError, CommandParser

from api.directory_watcher.content_check import (
    VERDICTS,
    CheckResult,
    FolderError,
    check_file_contents,
    queue_rescans,
    resolve_folder,
)
from api.models import User

# A line per this many files; the Admin Area job reports more often.
PROGRESS_LINE_EVERY = 1000


class Command(BaseCommand):
    help = (
        "Read every indexed file again and re-index the ones whose contents "
        "changed while their modification time stayed (cp -p, rsync --times, "
        "some sync apps), which a scan does not notice. The photos keep their "
        "albums, ratings and edits. Admins can start the same work from Admin "
        "Area > Admin tools > Check file contents."
    )

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument("--user", help="Only this user's library (username)")
        parser.add_argument(
            "--path",
            help="Only this folder, relative to the user's scan directory; needs --user",
        )

    def _progress(self, done: int, total: int) -> None:
        if done and (done % PROGRESS_LINE_EVERY == 0 or done == total):
            self.stdout.write(f"{done}/{total} files read")

    def _scope(self, options: dict[str, Any]) -> tuple[User | None, str | None]:
        username, path = options["user"], options["path"]
        if not username:
            if path:
                raise CommandError("--path needs --user.")
            return None, None
        user = User.objects.filter(username=username).first()
        if user is None:
            raise CommandError(f"There is no user {username!r}.")
        if not path:
            return user, None
        try:
            return user, resolve_folder(user, path)
        except FolderError as error:
            raise CommandError(str(error)) from error

    def _summary(self, result: CheckResult, rescans: int) -> str:
        totals = result.totals
        changed = ", ".join(
            f"{verdict.replace('_', ' ')} {totals[verdict]}" for verdict in VERDICTS
        )
        return (
            f"Read {totals['checked']} files: {totals['unchanged']} unchanged, "
            f"{changed}, {totals['missing']} missing. "
            f"Queued {rescans} rescan{'' if rescans == 1 else 's'}."
        )

    def handle(self, *args: Any, **options: Any) -> None:
        user, folder = self._scope(options)
        result = check_file_contents(user, folder, progress=self._progress)
        for change in result.changed:
            self.stdout.write(f"{change['verdict']}: {change['path']}")
        for error in result.errors:
            self.stderr.write(error)
        summary = self._summary(result, queue_rescans(result))
        if result.error_count:
            raise CommandError(f"{summary} {result.error_count} could not be read.")
        self.stdout.write(self.style.SUCCESS(summary))
