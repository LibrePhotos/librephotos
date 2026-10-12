import logging
from datetime import timedelta

from django.db.models import Prefetch, Q, QuerySet
from django.utils import timezone
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from api.models import LongRunningJob, User
from api.request_user import request_user
from api.serializers.job import JobListQuery, LongRunningJobSerializer
from api.views.pagination import TinyResultsSetPagination
from api.views.params import parse_query

logger = logging.getLogger(__name__)


# Jobs are written by the workers only: the API lists, opens, deletes and
# cancels them. A PATCH used to let the caller rewrite their own job row.
class LongRunningJobViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    permission_classes = (IsAuthenticated,)

    # Declared for router basename inference only; real access is scoped per-user
    # in get_queryset() below.
    queryset = LongRunningJob.objects.all()
    serializer_class = LongRunningJobSerializer
    pagination_class = TinyResultsSetPagination

    def get_queryset(self) -> QuerySet[LongRunningJob]:
        # Scope jobs to the requesting user so one user cannot list, retrieve,
        # delete or cancel another user's jobs. Staff/superusers retain
        # the global view. See issue #1861. Object-level actions (cancel/destroy)
        # inherit this via get_object().
        qs = LongRunningJob.objects.prefetch_related(
            Prefetch(
                "started_by",
                queryset=User.objects.only("id", "username", "first_name", "last_name"),
            ),
        ).order_by("-started_at")
        user = request_user(self.request)
        own_jobs = qs.owned_by(user)

        if not (user.is_staff or user.is_superuser):
            # Non-staff are always confined to their own jobs. ?mine is not read
            # on this path on purpose: the parameter may only ever narrow a
            # queryset, never widen one, so no value of it — ?mine=false
            # included — can lift this restriction.
            return own_jobs

        # Staff see everything by default. The per-user jobs view (#1909) is the
        # same list narrowed to the caller, which staff opt into explicitly so
        # that "My Jobs" means the same thing for every role.
        if parse_query(self.request, JobListQuery)["mine"]:
            return own_jobs
        return qs

    @action(detail=True, methods=["post"])
    def cancel(self, request: Request, pk: str | None = None) -> Response:
        """Cancel a running or queued job."""
        job = self.get_object()

        if job.finished:
            raise ValidationError("Job is already finished", code="job_finished")

        job.cancel()

        # Best-effort: try to remove queued django-q tasks that haven't started yet.
        # OrmQ stores tasks with a signed/pickled payload; the job_id is embedded
        # in the task arguments, not in the OrmQ.key or humanized name fields.
        # We iterate queued tasks and check the deserialized args for our job_id.
        # This is bounded by Q_CLUSTER["queue_limit"] (default 50) and only runs
        # on explicit user cancellation, so the overhead is minimal.
        try:
            from django_q.models import OrmQ

            job_id_str = str(job.job_id)
            for queued in OrmQ.objects.all():
                try:
                    task_args = queued.task.get("args", ())
                    if any(str(arg) == job_id_str for arg in task_args):
                        queued.delete()
                except Exception:
                    # Skip unparseable entries
                    logger.debug("Skipping queued task %s", queued.id, exc_info=True)
        except Exception:
            # Non-critical; cooperative cancellation handles running tasks
            logger.warning(
                "Could not remove the queued tasks of job %s", job.job_id, exc_info=True
            )

        return Response(
            {
                "status": True,
                "job": LongRunningJobSerializer(job).data,
            }
        )


class QueueAvailabilityView(APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request: Request, format: str | None = None) -> Response:
        job_detail = None

        # Ignore unfinished rows past the stuck-job threshold so orphaned jobs
        # (OOM, restart, uncaught exception) do not block the queue forever
        # while waiting for the hourly cleanup schedule to fire. See #1919.
        cutoff = timezone.now() - timedelta(hours=LongRunningJob.STUCK_JOB_HOURS)
        running_job = (
            LongRunningJob.objects.filter(finished=False)
            .filter(
                Q(started_at__gte=cutoff)
                | Q(started_at__isnull=True, queued_at__gte=cutoff)
            )
            .order_by("-started_at")
            .last()
        )
        # The queue is shared, so whether it is busy stays a global answer, but
        # the job itself (type, progress, who started it) follows the #1861
        # rule above: its starter and staff see it, nobody else does.
        busy = running_job is not None
        user = request_user(request)
        if running_job is not None and (
            running_job.started_by_id == user.id or user.is_staff or user.is_superuser
        ):
            job_detail = LongRunningJobSerializer(running_job).data

        return Response(
            {
                "status": True,
                "queue_can_accept_job": not busy,
                "job_detail": job_detail,
            }
        )
