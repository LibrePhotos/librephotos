from __future__ import annotations

import datetime
import hashlib
import sys
import uuid
from pathlib import Path

import django
import rehearsal_data as data


def _photos(owner: object, other: object) -> tuple[str, str]:
    from django.utils import timezone

    from api.models import File, Photo

    now = timezone.now()
    ids = []
    for index, user in enumerate([owner] * data.PHOTOS + [other]):
        digest = hashlib.md5(f"rehearsal-{index}".encode()).hexdigest()
        main_file = File.objects.create(
            hash=f"{digest}{user.id}",
            path=f"/data/rehearsal/photo-{index}.jpg",
            type=File.IMAGE,
        )
        photo = Photo(
            pk=uuid.uuid4(),
            image_hash=main_file.hash,
            owner=user,
            main_file=main_file,
            added_on=now,
            exif_timestamp=now - datetime.timedelta(days=index),
        )
        photo.save()
        ids.append(str(photo.pk))
    Photo.objects.filter(pk=ids[1]).update(removed=True)
    Photo.objects.filter(pk=ids[-1]).update(in_trashcan=True, trashed_at=None)
    return ids[1], ids[-1]


def _clusters(owner: object) -> None:
    from api.models import Cluster, Face, Photo

    photo = Photo.objects.filter(owner=owner, removed=False).first()
    for _ in range(2):
        cluster = Cluster.objects.create(
            owner=owner,
            cluster_id=data.UNKNOWN_CLUSTER,
            mean_face_encoding="00" * 512,
        )
        Face.objects.create(
            photo=photo,
            cluster=cluster,
            location_top=0,
            location_bottom=10,
            location_left=0,
            location_right=10,
            encoding="00" * 512,
        )


def _old_jobs(owner: object) -> list[str]:
    from django.utils import timezone

    from api.models.long_running_job import LongRunningJob

    now = timezone.now()
    finished = LongRunningJob.objects.create(
        job_id=str(uuid.uuid4()),
        job_type=LongRunningJob.JOB_SCAN_PHOTOS,
        started_by=owner,
        queued_at=now - datetime.timedelta(days=2),
        finished=True,
        finished_at=now - datetime.timedelta(days=1),
    )
    cancelled = LongRunningJob.objects.create(
        job_id=str(uuid.uuid4()),
        job_type=LongRunningJob.JOB_SCAN_PHOTOS,
        started_by=owner,
        queued_at=now - datetime.timedelta(days=2),
        started_at=now - datetime.timedelta(days=2),
        finished=True,
        failed=True,
        cancelled=True,
        finished_at=now - datetime.timedelta(days=1),
    )
    return [finished.job_id, cancelled.job_id]


def _old_path_schedules(stage: str) -> None:
    from django.utils import timezone
    from django_q.models import Schedule

    later = timezone.now() + datetime.timedelta(hours=6)
    if stage == "before":
        Schedule.objects.create(
            func="api.services.check_services",
            schedule_type=Schedule.MINUTES,
            minutes=1,
        )
        Schedule.objects.create(
            func="api.all_tasks.delete_zip_file",
            args=repr((data.OLD_PATH_ZIP,)),
            schedule_type=Schedule.ONCE,
            next_run=later,
        )
        return
    Schedule.objects.create(
        func="api.services.prune_deletion_log", schedule_type=Schedule.DAILY
    )
    Schedule.objects.create(func=data.OLD_STUCK_JOBS, schedule_type=Schedule.HOURLY)
    Schedule.objects.create(
        func="api.models.long_running_job.LongRunningJob.cleanup_old_jobs",
        kwargs=f"days={data.CLEANUP_DAYS}",
        schedule_type=Schedule.ONCE,
        next_run=timezone.now() - datetime.timedelta(minutes=5),
    )
    Schedule.objects.create(
        func="api.photos.retention.prune_deletion_log",
        schedule_type=Schedule.ONCE,
        repeats=0,
    )


def _schedules() -> dict[str, str]:
    from constance import config
    from django.core.management import call_command
    from django.utils import timezone
    from django_q.models import Schedule

    from api.jobs.queue import ensure_schedule, schedule_once_by

    _old_path_schedules("before")
    config.AUTO_SCAN = "daily"
    config.AUTO_SCAN_TIME = data.SCAN_TIME
    call_command("start_cleaning_service")
    call_command("start_job_cleanup_service")
    ensure_schedule(data.CHECK_SERVICES, schedule_type=Schedule.MINUTES, minutes=1)
    schedule_once_by(
        data.ZIP_SCHEDULE,
        "api.photos.zip_downloads.delete_zip_file",
        data.SCHEDULED_ZIP,
        at=timezone.now() + datetime.timedelta(hours=12),
    )
    _old_path_schedules("after")
    return {
        data.schedule_key(row.func, row.schedule_type, row.name or ""): (
            row.next_run.isoformat()
        )
        for row in Schedule.objects.all()
    }


def _zip_files() -> None:
    from django.conf import settings

    zip_dir = Path(settings.MEDIA_ROOT) / "zip"
    zip_dir.mkdir(parents=True, exist_ok=True)
    for name in (data.LEGACY_ZIP, data.FRESH_ZIP):
        (zip_dir / name).write_bytes(b"PK\x05\x06" + b"\x00" * 18)


def _legacy_tasks(owner: object) -> tuple[str, str, str]:
    from django_q.models import OrmQ
    from django_q.tasks import AsyncTask

    from api.jobs.queue import JobStep, Task, enqueue_chain, enqueue_job, enqueue_task
    from api.models.long_running_job import LongRunningJob
    from api.photos.retention import empty_trash_job, prune_deletion_log
    from api.photos.zip_downloads import delete_zip_file

    finished = enqueue_job(
        owner, LongRunningJob.JOB_EMPTY_TRASH, empty_trash_job, owner
    )
    [chained] = enqueue_chain(
        owner,
        [JobStep(LongRunningJob.JOB_EMPTY_TRASH, empty_trash_job, (owner,))],
        prerequisites=[Task(prune_deletion_log)],
        exclusive=False,
    )
    enqueue_task(delete_zip_file, data.LEGACY_ZIP)
    dropped = LongRunningJob.create_job(
        user=owner, job_type=LongRunningJob.JOB_EMPTY_TRASH
    )
    module_name, _, func_name = data.MISSING_FUNC.rpartition(".")
    missing = getattr(__import__(module_name, fromlist=[func_name]), func_name)
    AsyncTask(missing, "payload", job_id=dropped.job_id).run()
    if OrmQ.objects.count() != 4:
        raise SystemExit(
            f"expected 4 queued django-q tasks, got {OrmQ.objects.count()}"
        )
    return finished.job_id, chained.job_id, dropped.job_id


def _secrets(owner: object) -> None:
    from api.models.email_config import EmailConfig

    owner.nextcloud_server_address = "https://cloud.example.invalid"
    owner.nextcloud_username = data.OWNER
    owner.nextcloud_app_password = data.NEXTCLOUD_APP_PASSWORD
    owner.save()
    EmailConfig(
        provider="custom",
        host="smtp.example.invalid",
        username="mailer",
        secret=data.EMAIL_SECRET,
    ).save()


def _checkpoint() -> str:
    from django.db import connection

    if connection.vendor == "sqlite":
        with connection.cursor() as cursor:
            cursor.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    return connection.vendor


def _check_release() -> None:
    from django.db.migrations.recorder import MigrationRecorder

    latest = (
        MigrationRecorder.Migration.objects.filter(app="api").order_by("-name").first()
    )
    if latest is None or latest.name != data.LAST_MIGRATION:
        raise SystemExit(
            f"not a {data.RELEASE} database: its last migration is {latest}"
        )


def main(data_dir: Path) -> int:
    django.setup()
    from django.core.management import call_command

    from api.models import User

    call_command("migrate", interactive=False, verbosity=1)
    _check_release()
    owner = User.objects.create_user(
        username=data.OWNER, email="owner@example.invalid", password=data.PASSWORD
    )
    other = User.objects.create_superuser(
        username=data.OTHER, email="admin@example.invalid", password=data.PASSWORD
    )
    _secrets(owner)
    removed, trashed = _photos(owner, other)
    _clusters(owner)
    repaired = _old_jobs(owner)
    schedules = _schedules()
    _zip_files()
    finished, chained, dropped = _legacy_tasks(owner)
    data.write_manifest(
        data_dir,
        data.Manifest(
            release=data.RELEASE,
            vendor=_checkpoint(),
            legacy_tasks=4,
            finished_job=finished,
            chained_job=chained,
            dropped_job=dropped,
            repaired_jobs=repaired,
            removed_photo=removed,
            trashed_photo=trashed,
            schedules=schedules,
        ),
    )
    print(f"seeded a {data.RELEASE} database with {len(schedules)} django-q schedules")
    return 0


if __name__ == "__main__":
    sys.exit(main(Path(sys.argv[1])))
