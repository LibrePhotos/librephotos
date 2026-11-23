"""Request input and answers of the bulk date views (#2278,
``api/views/photo_dates.py``)."""

from datetime import UTC
from typing import Any

from drf_spectacular.utils import extend_schema_serializer
from rest_framework import serializers

from api.drf.params import JsonIntegerField
from api.models.time_zones import ALL_TIME_ZONES_SET
from api.serializers.photos import PhotoSelectionRequest

SHIFT = "shift"
SET = "set"
CONVERT_TIMEZONE = "convert_timezone"

#: The largest shift, a century either way: more is a typo, and a date
#: pushed past year 1 or 9999 cannot be stored.
MAX_SHIFT_SECONDS = 100 * 366 * 24 * 60 * 60


@extend_schema_serializer(
    description="The photos (as every bulk photo action names them) and the "
    'change: ``{"mode": "shift", "seconds": -3600}``, '
    '``{"mode": "set", "datetime": "2025-10-11T10:18:00"}`` or '
    '``{"mode": "convert_timezone", "from_timezone": "America/New_York", '
    '"to_timezone": "Asia/Tokyo"}``.'
)
class SetPhotosDateTimeRequest(PhotoSelectionRequest):
    mode = serializers.ChoiceField(
        choices=[SHIFT, SET, CONVERT_TIMEZONE],
        help_text="shift moves every dated photo by seconds; set gives every "
        "photo datetime; convert_timezone reads every dated photo's date in "
        "from_timezone and gives it the same moment in to_timezone",
    )
    seconds = JsonIntegerField(
        required=False,
        min_value=-MAX_SHIFT_SECONDS,
        max_value=MAX_SHIFT_SECONDS,
        help_text="With shift: how far, negative for earlier; not 0",
    )
    datetime = serializers.DateTimeField(
        required=False,
        default_timezone=UTC,
        help_text="With set: the photos' local wall-clock time, without an "
        "offset (as the lightbox's date editor sends it)",
    )
    from_timezone = serializers.CharField(
        required=False,
        help_text="With convert_timezone: the zone the dates are in, an IANA "
        "name from /api/timezones/",
    )
    to_timezone = serializers.CharField(
        required=False,
        help_text="With convert_timezone: the zone to give the dates, an IANA "
        "name from /api/timezones/",
    )

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        attrs = super().validate(attrs)
        if attrs["mode"] == SHIFT and not attrs.get("seconds"):
            raise serializers.ValidationError(
                {"seconds": "A shift needs a number of seconds other than 0."}
            )
        if attrs["mode"] == SET and attrs.get("datetime") is None:
            raise serializers.ValidationError(
                {"datetime": "Set needs the date and time to give the photos."}
            )
        if attrs["mode"] == CONVERT_TIMEZONE:
            for field in ("from_timezone", "to_timezone"):
                if not attrs.get(field):
                    raise serializers.ValidationError(
                        {field: "A conversion needs both time zones."}
                    )
                if attrs[field] not in ALL_TIME_ZONES_SET:
                    raise serializers.ValidationError(
                        {field: "Not a time zone name; pick one /api/timezones/ lists."}
                    )
            if attrs["from_timezone"] == attrs["to_timezone"]:
                raise serializers.ValidationError(
                    {"to_timezone": "A conversion needs two different time zones."}
                )
        return attrs


class SetPhotosDateTimeResponse(serializers.Serializer[None]):
    count = serializers.IntegerField(help_text="Photos that got the new date")
    skipped_without_date = serializers.IntegerField(
        help_text="Photos a shift or conversion left alone because they have no date"
    )
    skipped_other_zone = serializers.IntegerField(
        help_text="Photos a conversion left alone because their stored UTC "
        "offset is not from_timezone's at their date; 0 for shift and set"
    )


class DatedPhotoSerializer(serializers.Serializer[None]):
    """One photo of a selection and its date."""

    image_hash = serializers.CharField()
    exif_timestamp = serializers.DateTimeField(
        help_text="The photo's local wall-clock time, tagged UTC"
    )


class DateSummaryResponse(serializers.Serializer[None]):
    """Where a selection's dates stand before they are changed."""

    count = serializers.IntegerField(help_text="Photos in the selection")
    without_date = serializers.IntegerField(
        help_text="Photos of the selection that have no date"
    )
    oldest = DatedPhotoSerializer(
        allow_null=True, help_text="The earliest dated photo, null without one"
    )
    newest = DatedPhotoSerializer(
        allow_null=True, help_text="The latest dated photo, null without one"
    )
