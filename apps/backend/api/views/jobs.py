from django.db.models import Prefetch
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from api.models import LongRunningJob, User
from api.serializers.job import LongRunningJobSerializer
from api.views.pagination import TinyResultsSetPagination


class LongRunningJobViewSet(viewsets.ModelViewSet):
    queryset = (
        LongRunningJob.objects.prefetch_related(
            Prefetch(
                "started_by",
                queryset=User.objects.only("id", "username", "first_name", "last_name"),
            ),
        )
        .all()
        .order_by("-started_at")
    )
    serializer_class = LongRunningJobSerializer
    pagination_class = TinyResultsSetPagination

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        """Cancel a running or queued job."""
        job = self.get_object()

        if job.finished:
            return Response(
                {"status": False, "message": "Job is already finished"},
                status=status.HTTP_400_BAD_REQUEST,
            )

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
                    continue  # Skip unparseable entries
        except Exception:
            pass  # Non-critical; cooperative cancellation handles running tasks

        return Response(
            {
                "status": True,
                "job": LongRunningJobSerializer(job).data,
            }
        )


class QueueAvailabilityView(APIView):
    def get(self, request, format=None):
        job_detail = None

        running_job = (
            LongRunningJob.objects.filter(finished=False).order_by("-started_at").last()
        )
        if running_job:
            job_detail = LongRunningJobSerializer(running_job).data

        return Response(
            {
                "status": True,
                "queue_can_accept_job": job_detail is None,
                "job_detail": job_detail,
            }
        )
