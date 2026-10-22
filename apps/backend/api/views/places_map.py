"""The Places map (#343): the requester's photos where they were taken, the
photos inside a view, and the place albums with a photo inside it.

Only the requester's own visible photos, never shared or public ones: the
answers are positions, which a shared or public view never shows.
"""

from typing import Any

from django.db.models import F, QuerySet
from drf_spectacular.utils import extend_schema
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from api.drf.pagination import DefaultPagination
from api.drf.params import parse_query
from api.drf.request_user import request_user, scope_user
from api.geocode.map_points import (
    MapBounds,
    in_bounds_q,
    map_points,
    place_albums_in_bounds,
)
from api.models import AlbumPlace, Photo
from api.serializers.photo_locations import (
    MapBoundsQuery,
    PhotoMapPointsSerializer,
    PlaceAlbumsInBoundsSerializer,
)
from api.serializers.photos import PhotoSummarySerializer, with_photo_summary_relations
from api.views.custom_api_view import ListViewSet


def _bounds(request: Request) -> MapBounds:
    return MapBounds(**parse_query(request, MapBoundsQuery))


class PhotoMapPointsView(APIView):
    """Where the requester's photos were taken: one point per spot with the
    number of photos there. Hidden, trashed and removed photos are left out."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(responses=PhotoMapPointsSerializer)
    def get(self, request: Request, format: str | None = None) -> Response:
        return Response(map_points(Photo.visible.owned_by(request_user(request))))


class PhotosInBoundsViewSet(ListViewSet):
    """The requester's photos taken inside a map's view, newest first, a page
    at a time: what a point or a cluster of the Places map opens."""

    permission_classes = (IsAuthenticated,)
    serializer_class = PhotoSummarySerializer
    pagination_class = DefaultPagination

    def get_queryset(self) -> QuerySet[Photo]:
        if getattr(self, "swagger_fake_view", False):
            return Photo.objects.none()
        photos = Photo.visible.owned_by(scope_user(self.request))
        return with_photo_summary_relations(
            photos.filter(in_bounds_q(_bounds(self.request)))
        ).order_by(F("exif_timestamp").desc(nulls_last=True), "-added_on", "pk")

    @extend_schema(parameters=[MapBoundsQuery])
    def list(self, *args: Any, **kwargs: Any) -> Response:
        return super().list(*args, **kwargs)


class PlaceAlbumsInBoundsView(APIView):
    """The requester's place albums with a photo inside a map's view: the
    Places grid lists those under the map."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(parameters=[MapBoundsQuery], responses=PlaceAlbumsInBoundsSerializer)
    def get(self, request: Request, format: str | None = None) -> Response:
        user = request_user(request)
        ids = place_albums_in_bounds(
            AlbumPlace.objects.owned_by(user),
            Photo.visible.owned_by(user),
            _bounds(request),
        )
        return Response({"ids": ids})
