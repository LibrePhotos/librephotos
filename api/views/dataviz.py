from django.http import HttpResponseForbidden
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
    def get(self, request, format=None):
        res = cluster_faces(request.user)
        return Response(res)


class SocialGraphView(APIView):
    def get(self, request, format=None):
        res = build_social_graph(request.user)
        return Response(res)


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
