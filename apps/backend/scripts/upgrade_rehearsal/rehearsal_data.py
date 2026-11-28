from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import TypedDict

RELEASE = "1.6.0"
LAST_MIGRATION = "0224_error_report"
MANIFEST_NAME = "upgrade-rehearsal.json"

OWNER = "rehearsal-owner"
OTHER = "rehearsal-admin"
PASSWORD = "rehearsal-password-1"
NEXTCLOUD_APP_PASSWORD = "nc-app-pässwörd-0123456789"
EMAIL_SECRET = "smtp-sécret-ABCDEF-0123456789"
PHOTOS = 5
UNKNOWN_CLUSTER = -1

LEGACY_ZIP = "legacy-task.zip"
SCHEDULED_ZIP = "scheduled-once.zip"
FRESH_ZIP = "fresh-task.zip"
OLD_PATH_ZIP = "old-path.zip"

SCAN_TIME = "03:00"
SCAN_SCHEDULE = f"Library scan: every day at {SCAN_TIME}"
SCANS = "api.directory_watcher.scan_schedule.scheduled_library_scans"
ZIP_SCHEDULE = "rehearsal: delete the zip"
INTENDED_AT = "intended_at"
CLEANUP_DAYS = 45

CHECK_SERVICES = "api.runtime.supervisor.check_services"
OLD_STUCK_JOBS = "api.models.long_running_job.LongRunningJob.cleanup_stuck_jobs"
MISSING_FUNC = "api.jobs.broker.acknowledged_when_failed"


@dataclass(frozen=True)
class ExpectedSchedule:
    func: str
    schedule_type: str
    source: str = ""
    minutes: int | None = None
    args: list[object] = field(default_factory=list)
    kwargs: dict[str, object] = field(default_factory=dict)
    name: str = ""
    intended_date_kwarg: str = ""

    @property
    def origin(self) -> str:
        return self.source or self.func


EXPECTED_SCHEDULES = [
    ExpectedSchedule(
        CHECK_SERVICES, "I", source="api.services.check_services", minutes=1
    ),
    ExpectedSchedule(
        "api.photos.zip_downloads.delete_zip_file",
        "O",
        source="api.all_tasks.delete_zip_file",
        args=[OLD_PATH_ZIP],
    ),
    ExpectedSchedule("api.photos.retention.empty_expired_trash", "D"),
    ExpectedSchedule("api.photos.retention.cleanup_deleted_photos", "D"),
    ExpectedSchedule("api.photos.retention.prune_deletion_log", "D"),
    ExpectedSchedule("api.updates.check.check_for_updates", "D"),
    ExpectedSchedule("api.jobs.cleanup.fail_stuck_jobs", "H"),
    ExpectedSchedule(
        "api.models.long_running_job.LongRunningJob.cleanup_old_jobs", "D"
    ),
    ExpectedSchedule("chunked_upload.cleanup.delete_expired_uploads", "D"),
    ExpectedSchedule("api.jobs.upload_import.sweep_upload_imports", "I", minutes=1),
    ExpectedSchedule(
        SCANS,
        "D",
        name=SCAN_SCHEDULE,
        intended_date_kwarg=INTENDED_AT,
    ),
    ExpectedSchedule(
        "api.photos.zip_downloads.delete_zip_file",
        "O",
        args=[SCHEDULED_ZIP],
        name=ZIP_SCHEDULE,
    ),
    ExpectedSchedule(
        "api.models.long_running_job.LongRunningJob.cleanup_old_jobs",
        "O",
        kwargs={"days": CLEANUP_DAYS},
    ),
    ExpectedSchedule(OLD_STUCK_JOBS, "H"),
]


class Manifest(TypedDict):
    release: str
    vendor: str
    legacy_tasks: int
    finished_job: str
    chained_job: str
    dropped_job: str
    repaired_jobs: list[str]
    removed_photo: str
    trashed_photo: str
    schedules: dict[str, str]


def manifest_path(data_dir: Path) -> Path:
    return data_dir / MANIFEST_NAME


def write_manifest(data_dir: Path, manifest: Manifest) -> None:
    manifest_path(data_dir).write_text(json.dumps(manifest, indent=2), "utf-8")


def read_manifest(data_dir: Path) -> Manifest:
    loaded: Manifest = json.loads(manifest_path(data_dir).read_text("utf-8"))
    return loaded


def schedule_key(func: str, schedule_type: str, name: str) -> str:
    return json.dumps([func, schedule_type, name])
