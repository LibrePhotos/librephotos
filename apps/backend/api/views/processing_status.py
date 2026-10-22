"""The Library page's Processing status card (#2741): ``api.jobs.processing_status``."""

from drf_spectacular.utils import extend_schema
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from api.drf.params import parse_body
from api.drf.request_user import request_user
from api.jobs.processing_status import processing_status, start_stage
from api.serializers.job import JobStartedResponseSerializer
from api.serializers.processing_status import (
    ProcessingStatusSerializer,
    RunProcessingStageRequest,
)


class ProcessingStatusView(APIView):
    """What each processing stage that is turned on still has to do in the
    caller's library: photos without a big thumbnail, things, search
    embedding, place (with a position), face scan or text, faces without
    recognition data, photos without a generated caption. Only the caller's
    own photos and jobs, staff included.
    """

    permission_classes = (IsAuthenticated,)

    @extend_schema(responses=ProcessingStatusSerializer)
    def get(self, request: Request, format: str | None = None) -> Response:
        status = processing_status(request_user(request))
        return Response(ProcessingStatusSerializer(status).data)


class RunProcessingStageView(APIView):
    """Start the job that catches a processing stage up, on the caller's photos.

    The same job its own trigger or the scan's follow-ups start, for what is
    left only. 403 (``stage_off``) while the stage is turned off, 400
    (``no_files_to_scan``) when no photo without a thumbnail has a file to
    read, 409 ``job_already_running`` with the running job's ``job_id``.
    """

    permission_classes = (IsAuthenticated,)

    @extend_schema(
        request=RunProcessingStageRequest, responses=JobStartedResponseSerializer
    )
    def post(self, request: Request, format: str | None = None) -> Response:
        stage = parse_body(request, RunProcessingStageRequest)["stage"]
        return start_stage(request_user(request), stage)
