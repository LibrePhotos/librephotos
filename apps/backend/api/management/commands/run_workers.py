from typing import Any

from django.conf import settings
from django.core.management.base import BaseCommand, CommandParser

from api.jobs import parallel
from api.jobs.pool import Pool, PoolSettings
from api.jobs.worker_settings import WorkerSettings
from api.runtime import capacity
from api.runtime.sidecar_scaler import ReplicaScaler
from api.runtime.supervisor import check_services


class Command(BaseCommand):
    help = "Run the background workers, the task scheduler and the lease reaper."

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument("--workers", type=int, default=None)
        parser.add_argument("--stop-file", default="")

    def handle(self, *args: Any, **options: Any) -> None:
        workers = max(1, options["workers"] or parallel.max_workers())
        pool = Pool(
            PoolSettings(
                workers=workers,
                worker=WorkerSettings(
                    recycle_rss_mb=settings.TASK_WORKER_RECYCLE_RSS_MB,
                    memory_limit_mb=settings.TASK_WORKER_MEMORY_LIMIT_MB,
                ),
                sizer=parallel.Sizer(workers),
                every_minute=parallel.FastFirstImport(),
                watchdog=check_services,
                scaler=ReplicaScaler(
                    target=parallel.face_replica_target,
                    demand=parallel.heavy_demand,
                    memory_low=lambda: capacity.low_on_memory(capacity.detect()),
                ),
            )
        )

        pool.install_signal_handlers()
        if options["stop_file"]:
            pool.stop_when_file_appears(options["stop_file"])
        self.stdout.write(f"Starting {workers} workers")
        pool.run()
