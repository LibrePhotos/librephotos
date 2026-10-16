"""The Admin page's Finish the upgrade card (#2322): ``api.jobs.upgrade_tasks``."""

from drf_spectacular.utils import OpenApiParameter, OpenApiTypes, extend_schema
from rest_framework.exceptions import NotFound
from rest_framework.permissions import IsAdminUser
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from api.drf.request_user import request_user
from api.jobs.upgrade_tasks import (
    TASKS_BY_KEY,
    UpgradeTask,
    dismiss_task,
    start_task,
    task_overview,
)
from api.serializers.job import JobStartedResponseSerializer, UpgradeTaskListSerializer

TASK_KEY = OpenApiParameter(
    "key",
    OpenApiTypes.STR,
    OpenApiParameter.PATH,
    description="The task's key, from the list",
)


def _task(key: str) -> UpgradeTask:
    task = TASKS_BY_KEY.get(key)
    if task is None:
        raise NotFound(f"There is no upgrade task {key}.")
    return task


class UpgradeTaskListView(APIView):
    """The tasks an upgrade left for this instance, with their progress."""

    permission_classes = (IsAdminUser,)

    @extend_schema(responses=UpgradeTaskListSerializer)
    def get(self, request: Request, format: str | None = None) -> Response:
        return Response(UpgradeTaskListSerializer(task_overview()).data)


class UpgradeTaskStartView(APIView):
    """Start (or retry) a task: its jobs are queued for the admin, or per owner.

    409 ``queue_busy`` while another job is queued or running,
    ``job_already_running`` (with its ``job_id``) while the task's own job is,
    ``task_not_needed`` when nothing is left to do.
    """

    permission_classes = (IsAdminUser,)

    @extend_schema(
        parameters=[TASK_KEY], request=None, responses=JobStartedResponseSerializer
    )
    def post(self, request: Request, key: str, format: str | None = None) -> Response:
        jobs = start_task(_task(key), request_user(request))
        return Response(
            {
                "status": True,
                "job_id": jobs[-1].job_id,
                "job_ids": [job.job_id for job in jobs],
            }
        )


class UpgradeTaskDismissView(APIView):
    """**Not now**: hide an optional task for good. 400 ``task_required`` otherwise."""

    permission_classes = (IsAdminUser,)

    @extend_schema(
        parameters=[TASK_KEY], request=None, responses=UpgradeTaskListSerializer
    )
    def post(self, request: Request, key: str, format: str | None = None) -> Response:
        dismiss_task(_task(key))
        return Response(UpgradeTaskListSerializer(task_overview()).data)
