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
    CONVERT_TIMEZONE,
    SHIFT,
    DateSummaryResponse,
    SetPhotosDateTimeRequest,
    SetPhotosDateTimeResponse,
)
from api.serializers.photos import PhotoSelectionRequest

logger = logging.getLogger(__name__)


class SetPhotosDateTimeView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        description="Shift the requester's selected photos by a number of "
        "seconds, give them all one date and time, or convert their dates from "
        "one time zone to another.\n\n"
        "The body names the photos as every bulk photo action does "
        "(``image_hashes``, or ``select_all`` with ``query`` and "
        "``excluded_hashes``). A shift moves each photo from the date it shows, "
        "so the photos keep their order and spacing. A conversion reads each "
        "photo's wall clock in ``from_timezone`` and gives it the same moment "
        "in ``to_timezone``, with that zone's UTC offset; a photo whose stored "
        "offset is not ``from_timezone``'s at that date (one converted "
        "before) is left alone and counted in ``skipped_other_zone``, so a "
        "repeated conversion changes nothing. A shift or conversion leaves a "
        "photo without a date alone and counts it in ``skipped_without_date``. "
        "The new date is the user's: it wins over the owner's date rules, and "
        "is written to the file or sidecar in the background when the owner "
        "syncs metadata to disk.",
        request=SetPhotosDateTimeRequest,
        responses=SetPhotosDateTimeResponse,
    )
    def post(self, request: Request, format: str | None = None) -> Response:
        user = request_user(request)
        data = parse_body(request, SetPhotosDateTimeRequest)
        compute_new: edits.ComputeCaptureTime
        if data["mode"] == SHIFT:
            compute_new = edits.shifted_by(timedelta(seconds=data["seconds"]))
        elif data["mode"] == CONVERT_TIMEZONE:
            compute_new = edits.converted_time_zone(
                data["from_timezone"], data["to_timezone"]
            )
        else:
            compute_new = edits.set_to(data["datetime"])
        result = edits.set_capture_times(selected_photos(user, data), compute_new, user)
        logger.info(
            "Changed the date of %s photos (%s) for user %s, skipped %s without "
            "one and %s in another zone.",
            result.changed,
            data["mode"],
            user.id,
            result.skipped_without_date,
            result.skipped_other_zone,
        )
        return Response(
            {
                "count": result.changed,
                "skipped_without_date": result.skipped_without_date,
                "skipped_other_zone": result.skipped_other_zone,
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
