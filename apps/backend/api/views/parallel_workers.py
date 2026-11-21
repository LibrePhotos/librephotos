from drf_spectacular.utils import extend_schema
from rest_framework.permissions import IsAdminUser
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from api.drf.params import parse_body
from api.jobs import parallel
from api.serializers.parallel_workers import (
    ParallelWorkersRequest,
    ParallelWorkersSerializer,
)


class ParallelWorkersView(APIView):
    permission_classes = (IsAdminUser,)

    @extend_schema(responses=ParallelWorkersSerializer)
    def get(self, request: Request, format: str | None = None) -> Response:
        return Response(ParallelWorkersSerializer(parallel.status()).data)

    @extend_schema(request=ParallelWorkersRequest, responses=ParallelWorkersSerializer)
    def patch(self, request: Request, format: str | None = None) -> Response:
        parallel.set_intention(parse_body(request, ParallelWorkersRequest)["intention"])
        return Response(ParallelWorkersSerializer(parallel.status()).data)
