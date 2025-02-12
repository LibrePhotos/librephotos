import os

from django.http import FileResponse, HttpResponseForbidden
from drf_spectacular.utils import extend_schema
from rest_framework.response import Response
from rest_framework.views import APIView

from api.api_util import (
    get_count_stats,
    get_location_clusters,
    get_location_sunburst,
    get_location_timeline,
    get_photo_month_counts,
    get_searchterms_wordcloud,
    get_server_stats,
)
from api.face_classify import cluster_faces
from api.social_graph import build_social_graph


class ClusterFaceView(APIView):
    @extend_schema(
        deprecated=True,
        description="Use POST method",
    )
    def get(self, request, format=None):
        return self._cluster_faces(request.user)

    def post(self, request, format=None):
        return self._cluster_faces(request.user)

    def _cluster_faces(self, user):
        res = cluster_faces(user)
        return Response(res)


class SocialGraphView(APIView):
    def get(self, request, format=None):
        res = build_social_graph(request.user)
        return Response(res)

class ServerLogsView(APIView):
    def get(self, request, format=None):
        if not (request.user and request.user.is_staff):
            return HttpResponseForbidden()

        BASE_LOGS = os.environ.get("BASE_LOGS", "/logs/")
        log_file = os.path.join(BASE_LOGS, "ownphotos.log")

        if os.path.exists(log_file):
            return FileResponse(open(log_file, "rb"), as_attachment=True, filename="ownphotos.log")
        else:
            return Response({"error": "Log file not found"}, status=404)


class ServerStatsView(APIView):
    def get(self, request, format=None):
        if not (request.user and request.user.is_staff):
            return HttpResponseForbidden()
        res = get_server_stats()
        return Response(res)


class StatsView(APIView):
    def get(self, request, format=None):
        res = get_count_stats(user=request.user)
        return Response(res)


class LocationClustersView(APIView):
    def get(self, request, format=None):
        res = get_location_clusters(request.user)
        return Response(res)


class LocationSunburst(APIView):
    def get(self, request, format=None):
        res = get_location_sunburst(request.user)
        return Response(res)


class LocationTimeline(APIView):
    def get(self, request, format=None):
        res = get_location_timeline(request.user)
        return Response(res)


class PhotoMonthCountsView(APIView):
    def get(self, request, format=None):
        res = get_photo_month_counts(request.user)
        return Response(res)


class SearchTermWordCloudView(APIView):
    def get(self, request, format=None):
        res = get_searchterms_wordcloud(request.user)
        return Response(res)
