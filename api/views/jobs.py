import django_rq
from django.db.models import Prefetch
from rest_framework import viewsets
from rest_framework.response import Response
from rest_framework.views import APIView

from api.models import LongRunningJob, User
from api.serializers.serializers import LongRunningJobSerializer
from api.util import logger
from api.views.pagination import TinyResultsSetPagination


def queue_can_accept_job():
    default_queue_stat = [
        q for q in django_rq.utils.get_statistics()["queues"] if q["name"] == "default"
    ][0]
    started_jobs = default_queue_stat["started_jobs"]
    runninb_jobs = default_queue_stat["jobs"]
    if started_jobs + runninb_jobs > 0:
        return False
    else:
        return True


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
            LongRunningJob.objects.filter(finished=False)
            .order_by("-started_at")
            .first()
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


class ListAllRQJobsView(APIView):
    def get(self, request, format=None):
        try:
            all_jobs = django_rq.get_queue().all()
            logger.info(str(all_jobs))
        except BaseException as e:
            logger.error(str(e))
        return Response({})


class RQJobStatView(APIView):
    def get(self, request, format=None):
        job_id = request.query_params["job_id"]
        # job_id = '1667f947-bf8c-4ca8-a1cc-f16c7f3615de'
        is_job_finished = django_rq.get_queue().fetch_job(job_id).is_finished
        return Response({"status": True, "finished": is_job_finished})
