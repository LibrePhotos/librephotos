from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from api.metadata import datetime_rules


class TimeZoneView(APIView):
    permission_classes = (IsAuthenticated,)

    # The list is sent encoded as a JSON string (a string, not an array):
    # clients decode it a second time.
    @extend_schema(
        responses=OpenApiResponse(
            OpenApiTypes.STR,
            description="A JSON array of every time zone name, encoded as a string",
        )
    )
    def get(self, request: Request, format: str | None = None) -> Response:
        return Response(datetime_rules.ALL_TIME_ZONES_JSON)
