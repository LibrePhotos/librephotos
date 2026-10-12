from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from api.metadata import datetime_rules


class TimeZoneView(APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request: Request, format: str | None = None) -> Response:
        return Response(datetime_rules.ALL_TIME_ZONES_JSON)
