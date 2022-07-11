from rest_framework.views import APIView
import api.date_time_extractor as date_time_extractor
from rest_framework.response import Response
import api.util as util


class TimeZoneView(APIView):
    def get(self, request, format=None):
        return Response(date_time_extractor.ALL_TIME_ZONES_JSON)
