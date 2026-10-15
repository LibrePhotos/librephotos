"""The automatic library scan (#235): every library scanned on a schedule.

An admin picks the schedule in the site settings (``AUTO_SCAN``: off, every
hour, every day, or custom days; ``AUTO_SCAN_TIME`` and ``AUTO_SCAN_DAYS``).
Saving it rewrites one django-q schedule of ``scheduled_library_scans``
(``sync_scan_schedule``), and so does ``start_cleaning_service`` when the
server starts, so a schedule deleted by hand or a setting changed in the
Django admin comes back right.

Each run queues the same incremental scan the Scan button on the Library page
starts, one per user with a scan directory (plus their Nextcloud folder while
the Nextcloud integration is on), through ``api.jobs.queue``. A user whose
scan is still queued or running is skipped (``JobAlreadyRunning``), so scans
never pile up. What the run did is kept in ``AUTO_SCAN_LAST_RUN`` for the
status line under the setting (``scan_schedule_status``).

Times are the server's (``TIME_ZONE``): the daily time is a wall-clock time
there, and a custom day is a weekday there.
"""

from __future__ import annotations

import datetime
import json
import logging
import os
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import TypedDict

from constance import config as site_config
from django.conf import settings
from django.db.models import Q
from django.utils import timezone
from django_q.models import Schedule

from api.drf.exceptions import JobAlreadyRunning
from api.jobs.queue import (
    JobStep,
    Task,
    enqueue_chain,
    remove_schedule,
    replace_schedule,
)
from api.models import LongRunningJob, User
from api.runtime.ml_models import missing_models_prerequisites
from nextcloud.directory_watcher import scan_photos as scan_nextcloud_photos
from nextcloud.server_address import (
    CABundleError,
    UnsafeServerAddress,
    certificate_check,
    validate_server_address,
)

from .scan_jobs import scan_photos

logger = logging.getLogger(__name__)

# The django-q schedule's function; its row is found by this path.
SCHEDULED_SCANS = "api.directory_watcher.scan_schedule.scheduled_library_scans"
# The keyword django-q passes the run's intended time under: a run that waited
# in a busy queue past midnight still belongs to the day it was meant for.
INTENDED_AT = "intended_at"

OFF, HOURLY, DAILY, CUSTOM = "off", "hourly", "daily", "custom"
FREQUENCIES = (OFF, HOURLY, DAILY, CUSTOM)
DEFAULT_TIME = datetime.time(3, 0)
ALL_DAYS = frozenset(range(7))
WEEKDAY_NAMES = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")

_TIME = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")

# The constance keys, as the site settings view reads them in one query.
SCHEDULE_KEYS = ("AUTO_SCAN", "AUTO_SCAN_TIME", "AUTO_SCAN_DAYS")
LAST_RUN_KEY = "AUTO_SCAN_LAST_RUN"


def is_valid_time(value: str) -> bool:
    """Whether ``value`` is a time of day written ``HH:MM``."""
    return _TIME.match(value) is not None


def parse_time(value: str) -> datetime.time:
    """``HH:MM`` as a time; 03:00 for anything else."""
    match = _TIME.match(value.strip())
    if match is None:
        return DEFAULT_TIME
    return datetime.time(int(match.group(1)), int(match.group(2)))


def parse_days(value: str) -> frozenset[int]:
    """``"0,2,4"`` as weekdays (0 is Monday); what is not one is left out."""
    parts = (part.strip() for part in value.split(","))
    return frozenset(int(part) for part in parts if part.isdigit() and int(part) < 7)


def stored_days(days: Sequence[int]) -> str:
    """Weekdays as ``AUTO_SCAN_DAYS`` stores them: sorted, comma separated."""
    return ",".join(str(day) for day in sorted(set(days)))


@dataclass(frozen=True)
class ScanSchedule:
    """When the automatic scan runs."""

    frequency: str = OFF
    at: datetime.time = DEFAULT_TIME
    days: frozenset[int] = ALL_DAYS

    @classmethod
    def from_config(cls, config: Mapping[str, object]) -> ScanSchedule:
        """The schedule from the constance values, by key."""
        frequency = str(config["AUTO_SCAN"])
        return cls(
            frequency=frequency if frequency in FREQUENCIES else OFF,
            at=parse_time(str(config["AUTO_SCAN_TIME"])),
            days=(
                parse_days(str(config["AUTO_SCAN_DAYS"]))
                if frequency == CUSTOM
                else ALL_DAYS
            ),
        )

    @property
    def name(self) -> str:
        """The django-q schedule's name, which says what it does."""
        if self.frequency == HOURLY:
            return "Library scan: every hour"
        when = self.at.strftime("%H:%M")
        if self.days == ALL_DAYS:
            return f"Library scan: every day at {when}"
        days = ", ".join(WEEKDAY_NAMES[day] for day in sorted(self.days))
        return f"Library scan: {days} at {when}"

    @property
    def schedule_type(self) -> str:
        """Hourly, or daily: a custom schedule runs daily and skips other days."""
        return Schedule.HOURLY if self.frequency == HOURLY else Schedule.DAILY

    def runs_on(self, when: datetime.datetime) -> bool:
        """Whether a run meant for ``when`` scans (server time)."""
        if self.frequency == OFF:
            return False
        return timezone.localtime(when).weekday() in self.days

    def next_run(self, now: datetime.datetime) -> datetime.datetime | None:
        """The first run after ``now``, or None when it never runs."""
        if self.frequency == OFF or not self.days:
            return None
        local = timezone.localtime(now)
        if self.frequency == HOURLY:
            return local.replace(minute=0, second=0, microsecond=0) + (
                datetime.timedelta(hours=1)
            )
        # A week and a day: today's time may already be past.
        for offset in range(8):
            day = local.date() + datetime.timedelta(days=offset)
            candidate = timezone.make_aware(
                datetime.datetime.combine(day, self.at), local.tzinfo
            )
            if candidate > now and candidate.weekday() in self.days:
                return candidate
        return None


def current_schedule() -> ScanSchedule:
    """The schedule the site settings hold now."""
    return ScanSchedule.from_config(
        {key: getattr(site_config, key) for key in SCHEDULE_KEYS}
    )


def sync_scan_schedule(schedule: ScanSchedule | None = None) -> bool:
    """Make the django-q schedule match the setting; whether it changed.

    An unchanged setting keeps its schedule, so a restart does not move the
    next run. Off (or custom without a day) removes it.
    """
    schedule = schedule or current_schedule()
    next_run = schedule.next_run(timezone.now())
    if next_run is None:
        return remove_schedule(SCHEDULED_SCANS)
    return replace_schedule(
        SCHEDULED_SCANS,
        schedule_type=schedule.schedule_type,
        name=schedule.name,
        next_run=next_run,
        intended_date_kwarg=INTENDED_AT,
    )


@dataclass
class LastRun:
    """What one run did, by user id: the jobs it queued, whom it skipped."""

    at: datetime.datetime
    started: dict[int, list[str]] = field(default_factory=dict)
    skipped: list[int] = field(default_factory=list)
    failed: list[int] = field(default_factory=list)

    def to_json(self) -> str:
        return json.dumps(
            {
                "at": self.at.isoformat(),
                "started": {str(user): jobs for user, jobs in self.started.items()},
                "skipped": self.skipped,
                "failed": self.failed,
            }
        )

    @classmethod
    def from_json(cls, text: str) -> LastRun | None:
        """The stored run; None when there is none or it cannot be read."""
        if not text:
            return None
        try:
            data = json.loads(text)
            return cls(
                at=datetime.datetime.fromisoformat(data["at"]),
                started={
                    int(user): [str(job) for job in jobs]
                    for user, jobs in data["started"].items()
                },
                skipped=[int(user) for user in data["skipped"]],
                failed=[int(user) for user in data["failed"]],
            )
        except (ValueError, KeyError, TypeError, AttributeError):
            logger.warning("Ignoring an unreadable %s", LAST_RUN_KEY)
            return None


def _library_owners(nextcloud: bool) -> list[User]:
    """The active users with a library to scan, oldest account first."""
    has_library = ~Q(scan_directory="")
    if nextcloud:
        has_library |= ~Q(nextcloud_scan_directory="")
    return list(User.objects.filter(has_library, is_active=True).order_by("id"))


def _nextcloud_problem(user: User) -> str | None:
    """Why the user's Nextcloud cannot be scanned, as the Nextcloud Scan says."""
    try:
        validate_server_address(user.nextcloud_server_address)
        certificate_check()
    except (UnsafeServerAddress, CABundleError) as error:
        return str(error)
    return None


def scan_steps(user: User, nextcloud: bool) -> tuple[list[JobStep], str | None]:
    """The scans to queue for ``user``, and why a library cannot be scanned.

    The local scan is the Library page's incremental scan; the Nextcloud scan
    follows it in the same chain, so both count as one user's run.
    """
    steps: list[JobStep] = []
    problem = None
    if user.scan_directory:
        if os.path.isdir(user.scan_directory):
            steps.append(
                JobStep(
                    LongRunningJob.JOB_SCAN_PHOTOS,
                    scan_photos,
                    (user, False),
                    {"scan_directory": user.scan_directory},
                )
            )
        else:
            problem = "the scan directory does not exist"
    if nextcloud and user.nextcloud_scan_directory:
        nextcloud_problem = _nextcloud_problem(user)
        if nextcloud_problem is None:
            steps.append(
                JobStep(LongRunningJob.JOB_SCAN_PHOTOS, scan_nextcloud_photos, (user,))
            )
        problem = problem or nextcloud_problem
    return steps, problem


def _queue_scans(
    user: User, steps: list[JobStep], prerequisites: Sequence[Task], run: LastRun
) -> bool:
    """Queue one user's scans into ``run``; whether they were queued."""
    try:
        jobs = enqueue_chain(user, steps, prerequisites=prerequisites)
    except JobAlreadyRunning:
        logger.info("Automatic scan: user %s still has a scan running", user.id)
        run.skipped.append(user.id)
        return False
    except Exception:
        logger.exception("Automatic scan: could not queue the scan of user %s", user.id)
        run.failed.append(user.id)
        return False
    run.started[user.id] = [job.job_id for job in jobs]
    return True


def scan_all_libraries(now: datetime.datetime) -> LastRun:
    """Queue an incremental scan of every library, as one run."""
    run = LastRun(at=now)
    nextcloud = bool(site_config.NEXTCLOUD_ENABLED)
    # Missing models are downloaded once, in front of the first scan queued.
    download_pending = True
    for user in _library_owners(nextcloud):
        steps, problem = scan_steps(user, nextcloud)
        if problem is not None:
            logger.warning("Automatic scan: user %s: %s", user.id, problem)
            run.failed.append(user.id)
        if not steps:
            continue
        prerequisites = missing_models_prerequisites(user) if download_pending else []
        if _queue_scans(user, steps, prerequisites, run):
            download_pending = False
    return run


def _intended_time(intended_at: str | None) -> datetime.datetime:
    if intended_at:
        try:
            return datetime.datetime.fromisoformat(intended_at)
        except ValueError:
            logger.warning("Automatic scan: unreadable %s %r", INTENDED_AT, intended_at)
    return timezone.now()


def scheduled_library_scans(intended_at: str | None = None) -> dict[str, int]:
    """The schedule's task: scan every library, unless today is not a scan day.

    Returns how many users' scans it queued, skipped and could not start.
    """
    if not current_schedule().runs_on(_intended_time(intended_at)):
        return {}
    run = scan_all_libraries(timezone.now())
    site_config.AUTO_SCAN_LAST_RUN = run.to_json()
    logger.info(
        "Automatic scan: queued %d, skipped %d, failed %d",
        len(run.started),
        len(run.skipped),
        len(run.failed),
    )
    return {
        "started": len(run.started),
        "skipped": len(run.skipped),
        "failed": len(run.failed),
    }


class ScanScheduleStatus(TypedDict):
    """The status line under the setting, with usernames (admins read it)."""

    last_run_at: datetime.datetime | None
    scanned: list[str]
    running: list[str]
    skipped: list[str]
    failed: list[str]
    next_run_at: datetime.datetime | None
    time_zone: str


def _job_outcomes(run: LastRun) -> dict[int, str]:
    """Each started user's outcome: running, failed or scanned.

    A job row the 30-day cleanup already removed counts as scanned.
    """
    job_ids = [job for jobs in run.started.values() for job in jobs]
    jobs = {
        job.job_id: job
        for job in LongRunningJob.objects.filter(job_id__in=job_ids).only(
            "job_id", "finished", "failed", "cancelled"
        )
    }
    outcomes: dict[int, str] = {}
    for user, ids in run.started.items():
        rows = [jobs[job] for job in ids if job in jobs]
        if any(not row.finished for row in rows):
            outcomes[user] = "running"
        elif any(row.failed or row.cancelled for row in rows):
            outcomes[user] = "failed"
        else:
            outcomes[user] = "scanned"
    return outcomes


def _names_by_outcome(outcomes: Mapping[int, str]) -> dict[str, list[str]]:
    """Usernames by outcome, in account order; a deleted user is left out."""
    names = dict(User.objects.filter(id__in=outcomes).values_list("id", "username"))
    by_outcome: dict[str, list[str]] = {
        outcome: [] for outcome in ("scanned", "running", "skipped", "failed")
    }
    for user, outcome in sorted(outcomes.items()):
        if user in names:
            by_outcome[outcome].append(names[user])
    return by_outcome


def scan_schedule_status(config: Mapping[str, object]) -> ScanScheduleStatus:
    """The last run and the next one, for the site settings.

    ``config`` holds the schedule's constance keys and ``AUTO_SCAN_LAST_RUN``.
    """
    run = LastRun.from_json(str(config[LAST_RUN_KEY]))
    outcomes: dict[int, str] = {}
    if run is not None:
        outcomes = _job_outcomes(run)
        outcomes.update(dict.fromkeys(run.skipped, "skipped"))
        outcomes.update(dict.fromkeys(run.failed, "failed"))
    by_outcome = _names_by_outcome(outcomes)
    return ScanScheduleStatus(
        last_run_at=run.at if run is not None else None,
        scanned=by_outcome["scanned"],
        running=by_outcome["running"],
        skipped=by_outcome["skipped"],
        failed=by_outcome["failed"],
        next_run_at=ScanSchedule.from_config(config).next_run(timezone.now()),
        time_zone=settings.TIME_ZONE,
    )
