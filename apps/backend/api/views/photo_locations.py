"""Setting the location of many photos at once, and what the picker shows
around it (#2279)."""

import logging
from dataclasses import asdict

from drf_spectacular.utils import extend_schema
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from api.drf.params import parse_body, parse_query
from api.drf.request_user import request_user
from api.geocode.photo_location import located_nearby_in_time, location_summary
from api.metadata import edits
from api.models import Photo
from api.photos.selection import selected_photos
from api.serializers.photo_locations import (
    LocatedNearbyInTimeQuery,
    LocatedPhotoSerializer,
    LocationSummaryResponse,
    SetPhotosLocationRequest,
    SetPhotosLocationResponse,
)
from api.serializers.photos import PhotoSelectionRequest

logger = logging.getLogger(__name__)


class SetPhotosLocationView(APIView):
    """Give the requester's selected photos one location, looked up once.

    The body names the photos as every bulk photo action does
    (``image_hashes``, or ``select_all`` with ``query`` and
    ``excluded_hashes``). With ``overwrite`` false, photos that have a
    location keep it and are counted in ``skipped_with_location``.
    """

    permission_classes = (IsAuthenticated,)

    @extend_schema(
        request=SetPhotosLocationRequest, responses=SetPhotosLocationResponse
    )
    def post(self, request: Request, format: str | None = None) -> Response:
        user = request_user(request)
        data = parse_body(request, SetPhotosLocationRequest)
        result = edits.set_locations(
            selected_photos(user, data),
            data["lat"],
            data["lon"],
            user,
            overwrite=data["overwrite"],
        )
        logger.info(
            "Set the location of %s photos for user %s, skipped %s with one.",
            result.count,
            user.id,
            result.skipped_with_location,
        )
        return Response(asdict(result))


class LocationSummaryView(APIView):
    """How many of the selected photos have a location, their most frequent
    place names and when the selection was taken: what the bulk location
    picker shows before it saves. A POST because a selection can be a whole
    query; it changes nothing."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(request=PhotoSelectionRequest, responses=LocationSummaryResponse)
    def post(self, request: Request, format: str | None = None) -> Response:
        user = request_user(request)
        data = parse_body(request, PhotoSelectionRequest)
        summary = location_summary(selected_photos(user, data))
        return Response(summary)


class LocatedNearbyInTimeView(APIView):
    """The requester's geotagged photos taken from ``from`` to ``to``, nearest
    to the middle of that window first, at most 20: the photos the location
    picker offers to copy a location from."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(
        parameters=[LocatedNearbyInTimeQuery],
        responses=LocatedPhotoSerializer(many=True),
    )
    def get(self, request: Request, format: str | None = None) -> Response:
        user = request_user(request)
        window = parse_query(request, LocatedNearbyInTimeQuery)
        photos = located_nearby_in_time(
            Photo.visible.owned_by(user), window["from"], window["to"]
        )
        return Response(LocatedPhotoSerializer(photos, many=True).data)
