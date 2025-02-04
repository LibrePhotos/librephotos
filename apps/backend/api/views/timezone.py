from rest_framework.response import Response
from rest_framework.views import APIView

from api import date_time_extractor


class TimeZoneView(APIView):
    def get(self, request, format=None):
        return Response(date_time_extractor.ALL_TIME_ZONES_JSON)
