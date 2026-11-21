from typing import Any

from django.conf import settings
from django.core.management.base import BaseCommand, CommandParser

from api.jobs.pool import Pool, PoolSettings
from api.jobs.worker_settings import WorkerSettings


class Command(BaseCommand):
    help = "Run the background workers, the task scheduler and the lease reaper."

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument("--workers", type=int, default=None)
        parser.add_argument("--stop-file", default="")

    def handle(self, *args: Any, **options: Any) -> None:
        workers = max(1, options["workers"] or settings.TASK_WORKERS)
        pool = Pool(
            PoolSettings(
                workers=workers,
                worker=WorkerSettings(
                    recycle_rss_mb=settings.TASK_WORKER_RECYCLE_RSS_MB,
                ),
            )
        )
        pool.install_signal_handlers()
        if options["stop_file"]:
            pool.stop_when_file_appears(options["stop_file"])
        self.stdout.write(f"Starting {workers} workers")
        pool.run()
