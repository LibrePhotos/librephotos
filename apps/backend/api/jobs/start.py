"""Starting background jobs from a request: ``start_job`` and the helpers it shares.

The views that start a job call these instead of ``api.jobs.queue`` directly,
so every endpoint answers a started job, a duplicate start and a broker
failure the same way.
"""

import logging
from collections.abc import Sequence

from rest_framework.exceptions import APIException
from rest_framework.response import Response

from api.drf.exceptions import JobAlreadyRunning
from api.jobs.queue import JobStep, Task, TaskFunc, enqueue_chain
from api.models import LongRunningJob
from api.models.user import User

logger = logging.getLogger(__name__)


def enqueue_for_request(
    user: User,
    steps: Sequence[JobStep],
    description: str,
    prerequisites: Sequence[Task] = (),
    exclusive: bool = True,
) -> list[LongRunningJob]:
    """Queue ``steps`` (one job, or several in a row) for a request.

    The rows are written before the request answers (``api.jobs.queue``). A
    second start while one of these jobs is queued or running is a 409 with
    code ``job_already_running`` whose entry carries the running job's
    ``job_id``. When queuing fails (the broker is unreachable, say) the rows
    are marked failed and the client gets a 500 (code ``job_start_failed``)
    rather than a 200 carrying ``"status": False``.
    """
    try:
        return enqueue_chain(
            user, steps, prerequisites=prerequisites, exclusive=exclusive
        )
    except JobAlreadyRunning:
        raise
    except Exception as error:
        logger.exception("Could not start %s", description)
        raise APIException(
            f"Could not start {description}.", code="job_start_failed"
        ) from error


def start_jobs(
    user: User,
    steps: Sequence[JobStep],
    description: str,
    prerequisites: Sequence[Task] = (),
) -> Response:
    """Queue ``steps`` (``enqueue_for_request``) and answer the request.

    The answer's ``job_id`` is the last step's; ``job_ids`` lists every step's.
    """
    jobs = enqueue_for_request(user, steps, description, prerequisites)
    return Response(
        {
            "status": True,
            "job_id": jobs[-1].job_id,
            "job_ids": [job.job_id for job in jobs],
        }
    )


def start_job(
    user: User,
    job_type: int,
    func: TaskFunc,
    *args: object,
    description: str,
    prerequisites: Sequence[Task] = (),
    **kwargs: object,
) -> Response:
    """``start_jobs`` for one job, ``func(*args, job_id=..., **kwargs)``."""
    return start_jobs(
        user, [JobStep(job_type, func, args, kwargs)], description, prerequisites
    )
