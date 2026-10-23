"""Setting the rights of many photos at once, and the owner's default rights (#425)."""

import logging
from dataclasses import asdict

from drf_spectacular.utils import extend_schema
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from api.drf.params import parse_body
from api.drf.request_user import request_user
from api.metadata import edits
from api.metadata.rights import (
    Keep,
    as_values,
    default_rights,
    missing_any,
    rights_summary,
)
from api.models import Photo
from api.photos.selection import selected_photos
from api.serializers.photo_rights import (
    ApplyRightsDefaultRequest,
    RightsDefaultCountsResponse,
    RightsSummaryResponse,
    SetPhotosRightsRequest,
    SetPhotosRightsResponse,
)
from api.serializers.photos import PhotoSelectionRequest

logger = logging.getLogger(__name__)


class SetPhotosRightsView(APIView):
    """Give the requester's selected photos a copyright notice, a creator
    and a license ("Set rights…").

    The body names the photos as every bulk photo action does
    (``image_hashes``, or ``select_all`` with ``query`` and
    ``excluded_hashes``), and the fields to set; a field left out stays as
    each photo has it. ``keep`` says which existing values stay: those the
    photos' files give (the default), any, or none.
    """

    permission_classes = (IsAuthenticated,)

    @extend_schema(request=SetPhotosRightsRequest, responses=SetPhotosRightsResponse)
    def post(self, request: Request, format: str | None = None) -> Response:
        user = request_user(request)
        data = parse_body(request, SetPhotosRightsRequest)
        result = edits.set_rights(
            selected_photos(user, data), as_values(data), Keep(data["keep"]), user
        )
        logger.info(
            "Set the rights of %s photos for user %s, %s kept a value.",
            result.count,
            user.id,
            result.kept,
        )
        return Response(asdict(result))


class RightsSummaryView(APIView):
    """What the selected photos' rights are: each field's common value (or
    that it is mixed), and how many photos have rights from their file. A
    POST because a selection can be a whole query; it changes nothing."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(request=PhotoSelectionRequest, responses=RightsSummaryResponse)
    def post(self, request: Request, format: str | None = None) -> Response:
        user = request_user(request)
        data = parse_body(request, PhotoSelectionRequest)
        return Response(rights_summary(selected_photos(user, data)))


class ApplyRightsDefaultView(APIView):
    """The requester's default rights (Settings > Metadata) on their photos.

    GET counts the photos "Apply" would reach; POST sets the default on them,
    keeping what ``keep`` says (by default any value a photo has).
    """

    permission_classes = (IsAuthenticated,)

    @extend_schema(responses=RightsDefaultCountsResponse)
    def get(self, request: Request, format: str | None = None) -> Response:
        user = request_user(request)
        library = Photo.visible.owned_by(user)
        defaults = default_rights(user)
        missing = library.filter(missing_any(defaults)).count() if defaults else 0
        return Response({"total": library.count(), "missing": missing})

    @extend_schema(request=ApplyRightsDefaultRequest, responses=SetPhotosRightsResponse)
    def post(self, request: Request, format: str | None = None) -> Response:
        user = request_user(request)
        data = parse_body(request, ApplyRightsDefaultRequest)
        result = edits.apply_rights_default(
            Photo.visible.owned_by(user), Keep(data["keep"]), user
        )
        logger.info(
            "Applied the default rights to %s photos for user %s.",
            result.count,
            user.id,
        )
        return Response(asdict(result))
