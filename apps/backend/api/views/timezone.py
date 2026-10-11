from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from api import date_time_extractor


class TimeZoneView(APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request: Request, format: str | None = None) -> Response:
        return Response(date_time_extractor.ALL_TIME_ZONES_JSON)
