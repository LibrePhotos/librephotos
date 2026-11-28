from __future__ import annotations

import argparse
import datetime
import json
import subprocess
import sys
import time
from collections import Counter
from collections.abc import Callable
from pathlib import Path

import django
import psutil
import rehearsal_data as data

BACKEND = Path(__file__).resolve().parents[2]
LEGACY_QUEUE = "django_q_ormq"
LEGACY_SCHEDULES = "django_q_schedule"
WORKERS_DEADLINE_SECONDS = 240.0
STOP_GRACE_SECONDS = 90.0
DROPPED_LOG = "Dropped django-q task"
SECOND = datetime.timedelta(seconds=1)


def expect(ok: bool, message: str) -> None:
    if not ok:
        raise SystemExit(f"FAIL: {message}")
    print(f"ok: {message}")


def _owner() -> object:
    from api.models import User

    return User.objects.get(username=data.OWNER)


def _legacy_count(table: str) -> int:
    from django.db import connection

    if table not in connection.introspection.table_names():
        return 0
    with connection.cursor() as cursor:
        cursor.execute(f"SELECT COUNT(*) FROM {table}")
        row = cursor.fetchone()
    return int(row[0]) if row else 0


def _job(job_id: str) -> object:
    from api.models.long_running_job import LongRunningJob

    return LongRunningJob.objects.get(job_id=job_id)


def check_migrations() -> None:
    from django.db import connection
    from django.db.migrations.executor import MigrationExecutor

    executor = MigrationExecutor(connection)
    plan = executor.migration_plan(executor.loader.graph.leaf_nodes())
    expect(not plan, "every migration of this code is applied")


def check_rows(manifest: data.Manifest) -> None:
    from api.models import Cluster, Face, Photo

    owner = _owner()
    expect(owner.check_password(data.PASSWORD), "the owner still signs in")
    expect(
        Photo.objects.owned_by(owner).count() == data.PHOTOS,
        f"the owner still has {data.PHOTOS} photos",
    )
    removed = Photo.objects.get(pk=manifest["removed_photo"])
    expect(removed.removed_at is not None, "0234 gave the removed photo removed_at")
    trashed = Photo.objects.get(pk=manifest["trashed_photo"])
    expect(trashed.trashed_at is not None, "0234 gave the trashed photo trashed_at")
    unknown = Cluster.objects.owned_by(owner).filter(cluster_id=data.UNKNOWN_CLUSTER)
    expect(unknown.count() == 1, "0241 merged the two unknown clusters into one")
    expect(
        Face.objects.filter(cluster=unknown.get()).count() == 2,
        "the merged unknown cluster kept both faces",
    )
    finished, cancelled = (_job(job_id) for job_id in manifest["repaired_jobs"])
    expect(finished.started_at is not None, "0230 gave the finished job a start")
    expect(not cancelled.failed, "0230 turned the cancelled job's failure off")


def check_secrets() -> None:
    from django.db import connection

    from api.models.email_config import EmailConfig
    from api.models.encrypted_fields import is_legacy_token, stored_bytes

    owner = _owner()
    expect(
        owner.nextcloud_app_password == data.NEXTCLOUD_APP_PASSWORD,
        "the Nextcloud app password decrypts to what 1.6.0 stored",
    )
    config = EmailConfig.load()
    expect(
        config.secret == data.EMAIL_SECRET,
        "the email secret decrypts to what 1.6.0 stored",
    )
    with connection.cursor() as cursor:
        cursor.execute("SELECT secret FROM api_emailconfig WHERE id = 1")
        row = cursor.fetchone()
    expect(
        row is not None and is_legacy_token(stored_bytes(row[0])),
        "the stored email secret is still in django-cryptography's format",
    )
    config.secret = data.EMAIL_SECRET[::-1]
    config.save()
    expect(
        EmailConfig.load().secret == data.EMAIL_SECRET[::-1],
        "a secret written by this code reads back",
    )


def _schedule_shape(row: object) -> str:
    return json.dumps(
        [
            row.func,
            row.schedule_type,
            row.minutes,
            row.args,
            row.kwargs,
            row.name,
            row.intended_date_kwarg,
        ],
        sort_keys=True,
    )


def _expected_shape(expected: data.ExpectedSchedule) -> str:
    return json.dumps(
        [
            expected.func,
            expected.schedule_type,
            expected.minutes,
            expected.args,
            expected.kwargs,
            expected.name,
            expected.intended_date_kwarg,
        ],
        sort_keys=True,
    )


def check_schedules(manifest: data.Manifest) -> None:
    from api.jobs.worker import GoneFunctionError, resolve
    from api.models.task_queue import TaskSchedule

    rows = list(TaskSchedule.objects.all())
    copied = Counter(_schedule_shape(row) for row in rows)
    wanted = Counter(_expected_shape(item) for item in data.EXPECTED_SCHEDULES)
    for shape in sorted((copied - wanted) | (wanted - copied)):
        print(f"  differs: {shape} copied {copied[shape]} wanted {wanted[shape]}")
    expect(copied == wanted, "0243 copied exactly the expected django-q schedules")
    by_shape = {_schedule_shape(row): row for row in rows}
    for item in data.EXPECTED_SCHEDULES:
        row = by_shape[_expected_shape(item)]
        seeded = datetime.datetime.fromisoformat(
            manifest["schedules"][
                data.schedule_key(item.origin, item.schedule_type, item.name)
            ]
        )
        expect(
            abs(row.next_run - seeded) < SECOND,
            f"{row.func} ({row.schedule_type}) keeps its next run {seeded.isoformat()}",
        )
    gone = []
    for row in rows:
        try:
            resolve(row.func)
        except GoneFunctionError:
            gone.append(row.func)
    expect(not gone, f"every copied schedule names a function this code has {gone}")
    expect(
        _legacy_count(LEGACY_SCHEDULES) == 0,
        "0243 emptied django_q_schedule",
    )


def check_waiting_legacy_tasks(manifest: data.Manifest) -> None:
    expect(
        _legacy_count(LEGACY_QUEUE) == manifest["legacy_tasks"],
        f"the {manifest['legacy_tasks']} django-q tasks wait in {LEGACY_QUEUE}",
    )
    for key in ("finished_job", "chained_job", "dropped_job"):
        job = _job(manifest[key])
        expect(not job.finished, f"the legacy {key} has not run yet")


def check_migrated(data_dir: Path) -> None:
    manifest = data.read_manifest(data_dir)
    from django.db import connection

    expect(connection.vendor == manifest["vendor"], f"{connection.vendor} database")
    check_migrations()
    check_rows(manifest)
    check_secrets()
    check_schedules(manifest)
    check_waiting_legacy_tasks(manifest)


def _zip_path(name: str) -> Path:
    from django.conf import settings

    return Path(settings.MEDIA_ROOT) / "zip" / name


class Workers:
    def __init__(self, data_dir: Path) -> None:
        self.stop_file = data_dir / "run_workers.stop"
        self.output = data_dir / "run_workers.log"
        self.seen: dict[int, float] = {}
        self.started = time.time() - 1
        with self.output.open("wb") as log:
            self.process = subprocess.Popen(
                [
                    sys.executable,
                    "manage.py",
                    "run_workers",
                    "--workers",
                    "2",
                    "--stop-file",
                    str(self.stop_file),
                ],
                cwd=BACKEND,
                stdout=log,
                stderr=subprocess.STDOUT,
            )

    def remember_children(self) -> None:
        try:
            children = psutil.Process(self.process.pid).children(recursive=True)
        except psutil.Error:
            return
        for child in children:
            try:
                self.seen.setdefault(child.pid, child.create_time())
            except psutil.Error:
                continue

    def stop(self) -> int | None:
        self.stop_file.touch()
        deadline = time.monotonic() + STOP_GRACE_SECONDS
        while self.process.poll() is None and time.monotonic() < deadline:
            self.remember_children()
            time.sleep(0.2)
        code = self.process.poll()
        self.kill_leftovers()
        return code

    def _started_here(self, process: psutil.Process) -> bool:
        from api.runtime.sidecars import SERVICES
        from api.runtime.supervisor import _is_service_process

        try:
            if process.create_time() < self.started:
                return False
            cmdline = process.cmdline()
        except psutil.Error:
            return False
        return any(_is_service_process(cmdline, name) for name in SERVICES)

    def kill_leftovers(self) -> None:
        if self.process.poll() is None:
            self.process.kill()
        leftovers = [
            process for process in psutil.process_iter() if self._started_here(process)
        ]
        for pid, started in self.seen.items():
            try:
                process = psutil.Process(pid)
                if process.create_time() == started:
                    leftovers.append(process)
            except psutil.Error:
                continue
        for process in leftovers:
            try:
                process.kill()
            except psutil.Error:
                continue

    def log_text(self) -> str:
        from django.conf import settings

        files = [self.output, *sorted(Path(settings.LOGS_ROOT).glob("*.log"))]
        return "\n".join(path.read_text("utf-8", errors="replace") for path in files)


def _failed_tasks() -> list[str]:
    from api.models.task_queue import FAILED, QueuedTask

    return [
        f"{task.func}: {task.error.strip().splitlines()[-1:] or ''}"
        for task in QueuedTask.objects.filter(status=FAILED)
    ]


def _conditions(manifest: data.Manifest) -> dict[str, Callable[[], bool]]:
    from api.jobs.legacy_import import UNREADABLE
    from api.models.task_queue import QueuedTask, TaskSchedule

    def ended(key: str) -> bool:
        job = _job(manifest[key])
        return bool(job.finished and not job.failed)

    def dropped() -> bool:
        job = _job(manifest["dropped_job"])
        return bool(job.failed and UNREADABLE in json.dumps(job.result or {}))

    return {
        "django_q_ormq is empty": lambda: _legacy_count(LEGACY_QUEUE) == 0,
        "the legacy Empty trash job completed": lambda: ended("finished_job"),
        "the legacy chained Empty trash job completed": lambda: ended("chained_job"),
        "the job of the gone function failed as unreadable": dropped,
        "the legacy zip task deleted its file": lambda: (
            not _zip_path(data.LEGACY_ZIP).exists()
        ),
        "the new zip task deleted its file": lambda: (
            not _zip_path(data.FRESH_ZIP).exists()
        ),
        "the overdue once schedule fired": lambda: (
            not TaskSchedule.objects.filter(
                func="api.models.long_running_job.LongRunningJob.cleanup_old_jobs",
                schedule_type=TaskSchedule.ONCE,
            ).exists()
        ),
        "the queue drained": lambda: (
            not QueuedTask.objects.exclude(status="failed").exists()
        ),
    }


def _wait_for(conditions: dict[str, Callable[[], bool]], workers: Workers) -> None:
    from django.db import close_old_connections

    deadline = time.monotonic() + WORKERS_DEADLINE_SECONDS
    pending = dict(conditions)
    while pending and time.monotonic() < deadline:
        workers.remember_children()
        close_old_connections()
        failed = _failed_tasks()
        if failed:
            raise SystemExit(f"FAIL: tasks failed under run_workers: {failed}")
        if workers.process.poll() is not None:
            raise SystemExit(
                f"FAIL: run_workers exited early with {workers.process.returncode}"
            )
        pending = {name: check for name, check in pending.items() if not check()}
        time.sleep(1)
    for name in conditions:
        expect(name not in pending, name)


def _check_startup_schedules(manifest: data.Manifest) -> None:
    from api.jobs.queue import remove_schedule
    from api.models.task_queue import TaskSchedule

    seeded = manifest["schedules"][
        data.schedule_key(data.SCANS, TaskSchedule.DAILY, data.SCAN_SCHEDULE)
    ]
    funcs = Counter(
        TaskSchedule.objects.exclude(schedule_type=TaskSchedule.ONCE).values_list(
            "func", flat=True
        )
    )
    expect(
        data.OLD_STUCK_JOBS not in funcs,
        "start_job_cleanup_service removed the stuck job schedule of 1.4.0",
    )
    expect(
        all(count == 1 for count in funcs.values()),
        f"the startup commands added no second schedule {dict(funcs)}",
    )
    scans = TaskSchedule.objects.filter(func=data.SCANS)
    expect(
        [row.name for row in scans] == [data.SCAN_SCHEDULE],
        "start_cleaning_service kept the automatic scan's schedule of 1.6.0",
    )
    expect(
        abs(scans.get().next_run - datetime.datetime.fromisoformat(seeded)) < SECOND,
        "the automatic scan keeps its next run",
    )
    expect(
        remove_schedule(data.CHECK_SERVICES),
        "the copied watchdog schedule is there for start_service all to remove",
    )


def check_workers(data_dir: Path) -> None:
    from api.jobs.queue import enqueue_task
    from api.models.task_queue import WorkerProcess
    from api.photos.zip_downloads import delete_zip_file

    manifest = data.read_manifest(data_dir)
    _check_startup_schedules(manifest)
    enqueue_task(delete_zip_file, data.FRESH_ZIP)
    workers = Workers(data_dir)
    try:
        _wait_for(_conditions(manifest), workers)
    except BaseException:
        workers.stop()
        print(workers.log_text()[-20000:])
        raise
    code = workers.stop()
    log = workers.log_text()
    expect(code == 0, f"run_workers stopped on its stop file (exit {code})")
    expect(DROPPED_LOG in log, f"the worker log says {DROPPED_LOG!r}")
    expect(not WorkerProcess.objects.exists(), "run_workers removed its worker rows")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("phase", choices=["migrated", "workers"])
    parser.add_argument("data_dir", type=Path)
    options = parser.parse_args()
    sys.path.insert(0, str(BACKEND))
    django.setup()
    if options.phase == "migrated":
        check_migrated(options.data_dir)
    else:
        check_workers(options.data_dir)
    return 0


if __name__ == "__main__":
    sys.exit(main())
