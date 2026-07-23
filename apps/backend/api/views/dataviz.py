import collections
import os

from django.conf import settings
from django.http import FileResponse, HttpResponseForbidden
from drf_spectacular.utils import extend_schema
from rest_framework.response import Response
from rest_framework.views import APIView

from api.stats import (
    get_count_stats,
    get_photo_month_counts,
    get_searchterms_wordcloud,
    get_server_stats,
    get_location_clusters,
    get_location_sunburst,
    get_location_timeline,
)

from api.face_classify import cluster_faces
from api.social_graph import build_social_graph
from api.util import logger
from librephotos.logging_bootstrap import LOG_FILENAME


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
        try:
            res = build_social_graph(request.user)
            return Response(res)
        except Exception:
            logger.exception(f"Error in SocialGraphView for user {request.user.id}")
            return Response({"error": "Failed to build social graph"}, status=500)


class ServerLogsView(APIView):
    def get(self, request, format=None):
        if not (request.user and request.user.is_staff):
            return HttpResponseForbidden()

        log_file = os.path.join(settings.LOGS_ROOT, LOG_FILENAME)

        if os.path.exists(log_file):
            return FileResponse(
                open(log_file, "rb"), as_attachment=True, filename=LOG_FILENAME
            )
        else:
            return Response({"error": "Log file not found"}, status=404)


class ServerLogsViewerView(APIView):
    def get(self, request, format=None):
        if not (request.user and request.user.is_staff):
            return HttpResponseForbidden()

        try:
            num_lines = int(request.query_params.get("lines", 100))
        except (ValueError, TypeError):
            num_lines = 100
        num_lines = max(1, min(num_lines, 1000))

        log_file = os.path.join(settings.LOGS_ROOT, LOG_FILENAME)

        if not os.path.exists(log_file):
            # 404 rather than a 200 with an empty "logs" string: the admin UI
            # falls back to a placeholder on a failed request, but an empty
            # string is a perfectly valid log body to it, so a 200 renders a
            # blank panel with nothing saying why.
            return Response(
                {"logs": "", "count": 0, "error": "Log file not found"}, status=404
            )

        try:
            with open(log_file, "rb") as f:
                lines = collections.deque(f, maxlen=num_lines)
            log_text = b"".join(lines).decode("utf-8", errors="replace")
            return Response({"logs": log_text, "count": len(lines)})
        except Exception:
            logger.exception("Error reading log file")
            return Response(
                {"logs": "", "count": 0, "error": "Failed to read log file"},
                status=500,
            )


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
