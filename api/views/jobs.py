from django.db.models import Prefetch
from rest_framework import viewsets
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
