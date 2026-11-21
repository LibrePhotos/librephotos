from __future__ import annotations

import sys
from multiprocessing.sharedctypes import Synchronized
from multiprocessing.synchronize import Event

from api.jobs.worker_settings import WorkerSettings


def worker_main(
    slot: int, stop: Event, width: Synchronized[int], settings: WorkerSettings
) -> None:
    import django

    django.setup()
    from api.jobs.worker import Worker

    sys.exit(Worker(slot, stop, width, settings).run())
