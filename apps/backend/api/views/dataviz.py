import collections
import logging
import os

from django.conf import settings
from django.http import FileResponse
from drf_spectacular.utils import extend_schema
from rest_framework.exceptions import APIException, NotFound
from rest_framework.permissions import IsAdminUser, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from api.faces.classify import cluster_faces
from api.faces.social_graph import build_social_graph
from api.models.user import User
from api.request_user import request_user
from api.serializers.server import ServerLogsQuery
from api.stats import (
    get_count_stats,
    get_location_clusters,
    get_location_sunburst,
    get_location_timeline,
    get_photo_month_counts,
    get_searchterms_wordcloud,
    get_server_stats,
)
from api.views.params import parse_query
from librephotos.logging_bootstrap import LOG_FILENAME

logger = logging.getLogger(__name__)


class ClusterFaceView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        deprecated=True,
        description="Use POST method",
    )
    def get(self, request: Request, format: str | None = None) -> Response:
        return self._cluster_faces(request_user(request))

    def post(self, request: Request, format: str | None = None) -> Response:
        return self._cluster_faces(request_user(request))

    def _cluster_faces(self, user: User) -> Response:
        res = cluster_faces(user)
        return Response(res)


class SocialGraphView(APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request: Request, format: str | None = None) -> Response:
        user = request_user(request)
        try:
            res = build_social_graph(user)
            return Response(res)
        except Exception as error:
            logger.exception("Error in SocialGraphView for user %s", user.id)
            raise APIException("Failed to build social graph") from error


class ServerLogsView(APIView):
    permission_classes = (IsAdminUser,)

    def get(
        self, request: Request, format: str | None = None
    ) -> FileResponse | Response:
        log_file = os.path.join(settings.LOGS_ROOT, LOG_FILENAME)

        if os.path.exists(log_file):
            return FileResponse(
                open(log_file, "rb"), as_attachment=True, filename=LOG_FILENAME
            )
        else:
            raise NotFound("Log file not found")


class ServerLogsViewerView(APIView):
    permission_classes = (IsAdminUser,)

    @extend_schema(parameters=[ServerLogsQuery])
    def get(self, request: Request, format: str | None = None) -> Response:
        num_lines = parse_query(request, ServerLogsQuery)["lines"]

        log_file = os.path.join(settings.LOGS_ROOT, LOG_FILENAME)

        if not os.path.exists(log_file):
            # 404 rather than a 200 with an empty "logs" string: the admin UI
            # falls back to a placeholder on a failed request, but an empty
            # string is a perfectly valid log body to it, so a 200 renders a
            # blank panel with nothing saying why.
            raise NotFound("Log file not found")

        try:
            with open(log_file, "rb") as f:
                lines = collections.deque(f, maxlen=num_lines)
            log_text = b"".join(lines).decode("utf-8", errors="replace")
            return Response({"logs": log_text, "count": len(lines)})
        except Exception as error:
            logger.exception("Error reading log file")
            raise APIException("Failed to read log file") from error


class ServerStatsView(APIView):
    permission_classes = (IsAdminUser,)

    def get(self, request: Request, format: str | None = None) -> Response:
        res = get_server_stats()
        return Response(res)


class StatsView(APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request: Request, format: str | None = None) -> Response:
        res = get_count_stats(user=request_user(request))
        return Response(res)


class LocationClustersView(APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request: Request, format: str | None = None) -> Response:
        res = get_location_clusters(request_user(request))
        return Response(res)


class LocationSunburst(APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request: Request, format: str | None = None) -> Response:
        res = get_location_sunburst(request_user(request))
        return Response(res)


class LocationTimeline(APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request: Request, format: str | None = None) -> Response:
        res = get_location_timeline(request_user(request))
        return Response(res)


class PhotoMonthCountsView(APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request: Request, format: str | None = None) -> Response:
        res = get_photo_month_counts(request_user(request))
        return Response(res)


class SearchTermWordCloudView(APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request: Request, format: str | None = None) -> Response:
        res = get_searchterms_wordcloud(request_user(request))
        return Response(res)
