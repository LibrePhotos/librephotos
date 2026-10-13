from typing import Any

from django.core.management.base import BaseCommand, CommandParser
from django.utils.translation import gettext as _

from chunked_upload.cleanup import delete_expired_uploads
from chunked_upload.constants import COMPLETE, UPLOADING
from chunked_upload.models import ChunkedUpload

prompt_msg = _("Do you want to delete {obj}?")


def _ask(chunked_upload: ChunkedUpload) -> bool:
    prompt = prompt_msg.format(obj=chunked_upload) + " (y/n): "
    answer = input(prompt).lower()
    while answer not in ("y", "n"):
        answer = input(prompt).lower()
    return answer == "y"


class Command(BaseCommand):
    help = "Deletes chunked uploads that have already expired."

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument(
            "--interactive",
            action="store_true",
            dest="interactive",
            default=False,
            help="Prompt confirmation before each deletion.",
        )

    def handle(self, *args: Any, **options: Any) -> None:
        count = delete_expired_uploads(_ask if options.get("interactive") else None)
        self.stdout.write(f"{count[COMPLETE]} complete uploads were deleted.")
        self.stdout.write(f"{count[UPLOADING]} incomplete uploads were deleted.")
