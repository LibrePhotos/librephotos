from typing import Any

from django.core.management.base import BaseCommand

from api.jobs.upgrade_tasks import start_automatic_tasks
from api.jobs.upload_followups import backfill_upload_followups


class Command(BaseCommand):
    help = (
        "Queue the automatic post-upgrade tasks that have work and were never "
        "started (the Admin page's Finish the upgrade card shows them). Runs at "
        "every start; a task that failed is left for the card's Retry. The "
        "first start also requests the upload follow-ups once for every user "
        "with photos."
    )

    def handle(self, *args: Any, **kwargs: Any) -> None:
        queued = start_automatic_tasks()
        if queued:
            self.stdout.write(f"Queued upgrade tasks: {', '.join(queued)}")
        backfilled = backfill_upload_followups()
        if backfilled:
            self.stdout.write(f"Requested the upload follow-ups for {backfilled} users")
