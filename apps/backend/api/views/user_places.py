"""Your places (#1365): list, draw, edit and delete them, see what a circle
being drawn would hold, and open a place's photos.

Owner only: another user's place id behaves exactly like one that does not
exist, and no other view reads a place. Its name and its circle are where the
owner lives or works, so they never reach a shared or a public view.
"""

from django.db.models import F, Prefetch, QuerySet
from django.db.models.functions import Lower
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiParameter, OpenApiTypes, extend_schema
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.serializers import BaseSerializer

from api.drf.pagination import DefaultPagination
from api.drf.params import parse_query
from api.drf.request_user import request_user
from api.models import Photo, User
from api.models.user_place import UserPlace
from api.places.membership import refresh_user_places
from api.places.preview import preview_place
from api.serializers.photos import with_photo_summary_relations
from api.serializers.user_place import (
    UserPlacePhotosSerializer,
    UserPlacePreviewQuery,
    UserPlacePreviewSerializer,
    UserPlaceSerializer,
    with_user_place_relations,
)
from api.views.mixins import PartialUpdateModelMixin


class UserPlaceViewSet(
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    mixins.RetrieveModelMixin,
    PartialUpdateModelMixin[UserPlace],
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """The requester's places, by name. Saving or deleting one files the
    requester's photos into the places they were taken in at once."""

    serializer_class = UserPlaceSerializer
    pagination_class = DefaultPagination
    permission_classes = [IsAuthenticated]

    def _owned(self) -> QuerySet[UserPlace]:
        user = self.request.user
        if not isinstance(user, User):
            return UserPlace.objects.none()
        return UserPlace.objects.owned_by(user)

    def get_queryset(self) -> QuerySet[UserPlace]:
        return with_user_place_relations(self._owned()).order_by(Lower("name"), "pk")

    def _answer_with_counts(self, serializer: BaseSerializer[UserPlace]) -> None:
        """Refile the owner's photos, then answer with the place's new counts."""
        place = serializer.instance
        assert place is not None
        refresh_user_places(request_user(self.request))
        serializer.instance = self.get_queryset().get(pk=place.pk)

    def perform_create(self, serializer: BaseSerializer[UserPlace]) -> None:
        serializer.save(owner=request_user(self.request))
        self._answer_with_counts(serializer)

    def perform_update(self, serializer: BaseSerializer[UserPlace]) -> None:
        serializer.save()
        self._answer_with_counts(serializer)

    def perform_destroy(self, instance: UserPlace) -> None:
        instance.delete()
        # A photo in the deleted place and in a larger one moves to that one.
        refresh_user_places(request_user(self.request))

    @extend_schema(
        parameters=[UserPlacePreviewQuery], responses=UserPlacePreviewSerializer
    )
    @action(detail=False, methods=["get"], pagination_class=None)
    def preview(self, request: Request) -> Response:
        """How many of the requester's photos were taken inside a circle being
        drawn, the newest few, and the places that share some of them."""
        query = parse_query(request, UserPlacePreviewQuery)
        return Response(
            preview_place(
                request_user(request),
                query["lat"],
                query["lon"],
                query["radius_m"],
                exclude_id=query.get("exclude"),
            )
        )

    @extend_schema(
        parameters=[
            OpenApiParameter("video", OpenApiTypes.BOOL),
            OpenApiParameter("photo", OpenApiTypes.BOOL),
        ],
        responses=UserPlacePhotosSerializer,
    )
    @action(detail=True, methods=["get"], pagination_class=None)
    def photos(self, request: Request, pk: str | None = None) -> Response:
        """The place's visible photos, by day, newest first."""
        owned = Photo.visible.owned_by(request_user(request))
        photos = with_photo_summary_relations(owned).order_by(
            F("exif_timestamp").desc(nulls_last=True), "pk"
        )
        place = get_object_or_404(
            self._owned().prefetch_related(Prefetch("photos", queryset=photos)),
            pk=pk,
        )
        return Response(
            UserPlacePhotosSerializer(place, context={"request": request}).data
        )
