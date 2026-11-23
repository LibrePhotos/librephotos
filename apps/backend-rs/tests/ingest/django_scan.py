"""Reference scans with Django's own scan code, for the ingest parity diff.

    python django_scan.py users <data_root>   # create the fixture users (empty DB)
    python django_scan.py scan                # scan every user, print timings
    python django_scan.py missing             # scan_missing_photos + delete_missing_photos

Runs under the lp_twin_settings environment (fixture/env.sh
``lp_django_env``). ``scan`` calls the real ``scan_photos`` with every queued
task run inline and the follow-up jobs left out; exif sidecar calls are
served by its Flask app in-process, as seed_fixture does (port 8010 is
shared machine-wide).
"""

import json
import os
import sys
import time
import uuid

import django

django.setup()

from api.directory_watcher import scan_jobs  # noqa: E402
from api.management.commands.seed_fixture import _route_exif_in_process  # noqa: E402
from api.models import File, User  # noqa: E402

USERS = [("admin", True), ("alice", False), ("bob", False), ("carol", False), ("dave", False)]


class InlineTask:
    def __init__(self, func, *args, **kwargs):
        kwargs.pop("group", None)
        self.func, self.args, self.kwargs = func, args, kwargs

    def run(self):
        return self.func(*self.args, **self.kwargs)


def create_users(data_root):
    for name, admin in USERS:
        if admin:
            u = User.objects.create_superuser(name, f"{name}@example.com", f"{name}-pw")
        else:
            u = User.objects.create_user(name, f"{name}@example.com", f"{name}-pw")
        u.scan_directory = os.path.join(data_root, name)
        u.save()


def scan():
    _route_exif_in_process()
    scan_jobs.AsyncTask = InlineTask
    scan_jobs._queue_followup_jobs = lambda *a, **k: None
    report = []
    start = time.perf_counter()
    for user in User.objects.exclude(scan_directory="").order_by("id"):
        job_id = str(uuid.uuid4())
        t = time.perf_counter()
        scan_jobs.scan_photos(user, False, job_id)
        from api.models import LongRunningJob

        job = LongRunningJob.objects.get(job_id=job_id)
        report.append(
            {
                "user": user.username,
                "groups": job.progress_target,
                "seconds": time.perf_counter() - t,
                "result": job.result,
            }
        )
    seconds = time.perf_counter() - start
    files = File.objects.count()
    print(
        "SCAN_REPORT "
        + json.dumps(
            {
                "users": report,
                "files": files,
                "seconds": seconds,
                "files_per_second": files / seconds,
            }
        )
    )


def missing():
    """scan_missing_photos + delete_missing_photos for every user."""
    _route_exif_in_process()
    from api.autoalbum import delete_missing_photos

    for user in User.objects.exclude(scan_directory="").order_by("id"):
        scan_jobs.scan_missing_photos(user, uuid.uuid4())
        delete_missing_photos(user, uuid.uuid4())
    print("MISSING_DONE")


if __name__ == "__main__":
    if sys.argv[1] == "users":
        create_users(sys.argv[2])
    elif sys.argv[1] == "missing":
        missing()
    else:
        scan()
