"""The hourly stuck-job cleanup, which leaves alone the jobs still being worked on.

``LongRunningJob.cleanup_stuck_jobs`` fails a job that reported no progress
for ``STUCK_JOB_HOURS``. Progress alone says nothing about a job whose one
long step reports none until it ends: the clustering of Find Similar Faces
ran for more than three hours on a library of 96k faces (#2867). Failed while
it worked, such a job then succeeded and still showed "failed". Nor about a
job whose tasks wait in the queue behind another user's scan of a large
library, for days. A task a live cluster holds is renewed while that cluster
runs (``api.jobs.broker``), and a waiting one runs in its turn, so their jobs
are alive; only the jobs no task in the queue names are failed.
"""

from __future__ import annotations

from django.utils import timezone

from api.jobs.queue import held_job_ids
from api.models import CountedJobItem
from api.models.long_running_job import LongRunningJob, stuck_job_hours

STUCK_JOBS_FUNC = "api.jobs.cleanup.fail_stuck_jobs"
# Where the schedule pointed up to 1.4.0; start_job_cleanup_service replaces it.
OLD_STUCK_JOBS_FUNC = "api.models.long_running_job.LongRunningJob.cleanup_stuck_jobs"


def fail_stuck_jobs() -> int:
    """Fail the stuck jobs that no task in the queue names; how many.

    A job silent for half the threshold is marked seen (``queue_seen_at``)
    when a task of it is in the queue, so ``running()`` keeps counting it
    while it waits, and unmarked when none is, so it is judged by what it
    reported again. Also drops the counted items (``CountedJobItem``) of the
    jobs that ended.
    """
    unfinished = LongRunningJob.objects.filter(finished=False).values("job_id")
    CountedJobItem.objects.exclude(job_id__in=unfinished).delete()
    silent = LongRunningJob.objects.silent(max(1, stuck_job_hours() // 2))
    if not silent.exists():
        # Reading the queue opens every payload in it: only when needed.
        return 0
    alive = held_job_ids()
    silent.filter(job_id__in=alive).update(queue_seen_at=timezone.now())
    silent.exclude(job_id__in=alive).update(queue_seen_at=None)
    return LongRunningJob.cleanup_stuck_jobs(alive=alive)
