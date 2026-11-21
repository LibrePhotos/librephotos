from __future__ import annotations

import sys
from multiprocessing.sharedctypes import SynchronizedArray
from multiprocessing.synchronize import Event

from api.jobs.worker_settings import WorkerSettings


def worker_main(
    slot: int, stop: Event, limits: SynchronizedArray[int], settings: WorkerSettings
) -> None:
    import django

    django.setup()
    from api.jobs.worker import Worker

    sys.exit(Worker(slot, stop, limits, settings).run())
