import logging

from django.db.models import F, QuerySet
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from api.drf.exceptions import Conflict
from api.drf.pagination import DefaultPagination
from api.drf.params import parse_query
from api.drf.request_user import request_user
from api.jobs.queue import remove_queued_tasks
from api.models import LongRunningJob
from api.serializers.fields import loaded
from api.serializers.job import (
    CancelJobResponseSerializer,
    JobListQuery,
    LongRunningJobSerializer,
    QueueAvailabilitySerializer,
    with_job_relations,
)

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
    pagination_class = DefaultPagination

    def get_queryset(self) -> QuerySet[LongRunningJob]:
        # Scope jobs to the requesting user so one user cannot list, retrieve,
        # delete or cancel another user's jobs. Staff/superusers retain
        # the global view. See issue #1861. Object-level actions (cancel/destroy)
        # inherit this via get_object().
        qs = with_job_relations(LongRunningJob.objects.all()).order_by("-started_at")
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

    def perform_destroy(self, instance: LongRunningJob) -> None:
        # Without its baseline the next incremental scan would read the whole
        # library again (#1104); the row goes once a newer library scan is in.
        if loaded(instance, "is_scan_baseline"):
            raise Conflict(
                "This scan is the reference for the next incremental scan. It "
                "can be removed once a newer scan of the whole library has finished.",
                code="scan_baseline",
            )
        instance.delete()

    @extend_schema(request=None, responses=CancelJobResponseSerializer)
    @action(detail=True, methods=["post"])
    def cancel(self, request: Request, pk: str | None = None) -> Response:
        """Cancel a running or queued job."""
        job = self.get_object()

        if job.finished:
            raise ValidationError("Job is already finished", code="job_finished")

        job.cancel()

        # The task skips a cancelled job when it claims its row; removing it
        # from the broker as well frees its slot in the queue.
        remove_queued_tasks(job.job_id)

        return Response(
            {
                "status": True,
                "job": LongRunningJobSerializer(job).data,
            }
        )


class QueueAvailabilityView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(responses=QueueAvailabilitySerializer)
    def get(self, request: Request, format: str | None = None) -> Response:
        job_detail = None

        # Queued jobs count: their rows are written when they are queued. The
        # one shown is the job actually running, else the oldest queued one.
        # running() leaves out rows past the stuck-job threshold (#1919).
        running_job = (
            with_job_relations(LongRunningJob.objects.running())
            .order_by(F("started_at").asc(nulls_last=True), "queued_at")
            .first()
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
