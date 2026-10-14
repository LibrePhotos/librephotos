"""Shifting or setting the date and time of many photos at once, and the
summary the dialog previews it with (#2278)."""

import logging
from datetime import timedelta

from drf_spectacular.utils import extend_schema
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from api.drf.params import parse_body
from api.drf.request_user import request_user
from api.metadata import edits
from api.metadata.photo_datetime import date_summary
from api.photos.selection import selected_photos
from api.serializers.photo_dates import (
    SHIFT,
    DateSummaryResponse,
    SetPhotosDateTimeRequest,
    SetPhotosDateTimeResponse,
)
from api.serializers.photos import PhotoSelectionRequest

logger = logging.getLogger(__name__)


class SetPhotosDateTimeView(APIView):
    """Shift the requester's selected photos by a number of seconds, or give
    them all one date and time.

    The body names the photos as every bulk photo action does
    (``image_hashes``, or ``select_all`` with ``query`` and
    ``excluded_hashes``). A shift moves each photo from the date it shows, so
    the photos keep their order and spacing; a photo without a date is left
    alone and counted in ``skipped_without_date``. The new date is the
    user's: it wins over the owner's date rules, and is written to the file
    or sidecar in the background when the owner syncs metadata to disk.
    """

    permission_classes = (IsAuthenticated,)

    @extend_schema(
        request=SetPhotosDateTimeRequest, responses=SetPhotosDateTimeResponse
    )
    def post(self, request: Request, format: str | None = None) -> Response:
        user = request_user(request)
        data = parse_body(request, SetPhotosDateTimeRequest)
        if data["mode"] == SHIFT:
            compute_new = edits.shifted_by(timedelta(seconds=data["seconds"]))
        else:
            compute_new = edits.set_to(data["datetime"])
        result = edits.set_capture_times(selected_photos(user, data), compute_new, user)
        logger.info(
            "Changed the date of %s photos (%s) for user %s, skipped %s without one.",
            result.changed,
            data["mode"],
            user.id,
            result.skipped_without_date,
        )
        return Response(
            {
                "count": result.changed,
                "skipped_without_date": result.skipped_without_date,
            }
        )


class DateSummaryView(APIView):
    """How many photos the selection has, how many have no date, and its
    oldest and newest dated photo: what the date dialog shows before it
    saves. A POST because a selection can be a whole query; it changes
    nothing."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(request=PhotoSelectionRequest, responses=DateSummaryResponse)
    def post(self, request: Request, format: str | None = None) -> Response:
        user = request_user(request)
        data = parse_body(request, PhotoSelectionRequest)
        summary = date_summary(selected_photos(user, data))
        return Response(summary)
