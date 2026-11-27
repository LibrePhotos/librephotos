import json
import sys
import time
from typing import Any


def _use(database: dict[str, object]) -> None:
    import django

    django.setup()
    from django.db import connections

    connections["default"].settings_dict.update(database)
    connections["default"].close()


def add_ones(database: dict[str, object], job_id: str, count: int) -> None:
    _use(database)
    from api.directory_watcher.utils import update_job_result
    from api.models import LongRunningJob

    def add_one(result: dict[str, Any], job: LongRunningJob) -> None:
        seen = result.get("n", 0)
        time.sleep(0.002)
        result["n"] = seen + 1

    for _ in range(count):
        if update_job_result(job_id, add_one) is None:
            raise SystemExit(3)


def count_errors(database: dict[str, object], job_id: str, count: int) -> None:
    _use(database)
    import os

    from api.directory_watcher.utils import update_scan_counter

    for index in range(count):
        update_scan_counter(job_id, failed=True, error=f"{os.getpid()}-{index}")


WRITERS = {"add_ones": add_ones, "count_errors": count_errors}


if __name__ == "__main__":
    name, database, job_id, count = sys.argv[1:]
    WRITERS[name](json.loads(database), job_id, int(count))
