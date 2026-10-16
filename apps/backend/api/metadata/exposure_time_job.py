"""Reading the shutter speeds an older version stored wrongly again, as a job (#2275, #2322).

1.4.0 asked admins to run ``manage.py refresh_exposure_time`` after updating.
The same work is now a job, which the Finish the upgrade card on the Admin
page starts by itself (``api.jobs.upgrade_tasks``). It reads one tag of each
affected photo and writes only the two shutter speed columns; the files are
not changed.
"""

from __future__ import annotations

import logging
import uuid

from api.metadata.photo_reader import misread_exposure_times, refresh_exposure_times
from api.models import LongRunningJob, User
from api.models.long_running_job import JobCancelledError

logger = logging.getLogger(__name__)


def refresh_exposure_times_job(
    user: User, job_id: uuid.UUID | str | None = None
) -> None:
    """Read ExposureTime again for every photo of the instance that may be wrong.

    Every user's photos: an admin starts it, or the startup does. A photo whose
    file cannot be read is counted, not an error: reading it again later would
    not help.
    """
    job = LongRunningJob.claim(user, LongRunningJob.JOB_REFRESH_EXPOSURE_TIMES, job_id)
    if job is None:
        return

    def report(done: int, total: int) -> None:
        job.update_progress(done, total)
        job.stop_if_cancelled()

    try:
        result = refresh_exposure_times(misread_exposure_times(), progress=report)
    except JobCancelledError:
        logger.info("job %s was cancelled", job.job_id)
        return
    except Exception as error:
        logger.exception("job %s: could not read the shutter speeds", job.job_id)
        job.fail(error=error)
        return
    job.complete(
        result={
            "status": "completed",
            "checked": result.checked,
            "updated": result.updated,
            "unreadable": result.unreadable,
        }
    )
