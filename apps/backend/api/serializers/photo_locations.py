"""Request input and answers of the bulk location views (#2279,
``api/views/photo_locations.py``)."""

from datetime import datetime
from typing import Any

from rest_framework import serializers

from api.drf.params import JsonBooleanField, JsonCoordinateField
from api.models import Photo
from api.models.place_names import short_place_name
from api.serializers.photos import PhotoSelectionRequest


class SetPhotosLocationRequest(PhotoSelectionRequest):
    """The photos (as every bulk photo action names them) and the spot."""

    lat = JsonCoordinateField(limit=90, help_text="Latitude (-90 to 90)")
    lon = JsonCoordinateField(limit=180, help_text="Longitude (-180 to 180)")
    overwrite = JsonBooleanField(
        default=False,
        help_text="Also move the photos that have a location; false leaves "
        "them where they are",
    )


class SetPhotosLocationResponse(serializers.Serializer[None]):
    count = serializers.IntegerField(help_text="Photos that got the location")
    skipped_with_location = serializers.IntegerField(
        help_text="Photos left alone because they have a location (overwrite false)"
    )
    geocoded = serializers.BooleanField(
        help_text="Whether the spot has a place name. False keeps the "
        "coordinates without one; the geolocation job tries again after a "
        "failed lookup"
    )


class PlaceCountSerializer(serializers.Serializer[None]):
    place = serializers.CharField()
    count = serializers.IntegerField()


class LocationSummaryResponse(serializers.Serializer[None]):
    """Where a selection stands before its location is set."""

    count = serializers.IntegerField(help_text="Photos in the selection")
    with_location = serializers.IntegerField(
        help_text="Photos of the selection that have a location"
    )
    places = PlaceCountSerializer(
        many=True,
        help_text="The most frequent place names of those, most photos first",
    )
    first_taken = serializers.DateTimeField(
        allow_null=True, help_text="When the earliest photo was taken"
    )
    last_taken = serializers.DateTimeField(
        allow_null=True, help_text="When the latest photo was taken"
    )


class LocatedNearbyInTimeQuery(serializers.Serializer[None]):
    """``from`` and ``to``: the window, ISO date-times. ``from`` is a Python
    keyword, so both are declared in ``get_fields``."""

    def get_fields(self) -> dict[str, serializers.Field[Any, Any, Any, Any]]:
        fields = super().get_fields()
        fields["from"] = serializers.DateTimeField(help_text="Start of the window")
        fields["to"] = serializers.DateTimeField(help_text="End of the window")
        return fields

    def validate(self, attrs: dict[str, datetime]) -> dict[str, datetime]:
        if attrs["from"] > attrs["to"]:
            raise serializers.ValidationError({"to": "Must not be before from."})
        return attrs


class LocatedPhotoSerializer(serializers.ModelSerializer[Photo]):
    """A geotagged photo the location picker offers to copy from."""

    id = serializers.UUIDField(read_only=True)
    place = serializers.CharField(
        read_only=True,
        allow_null=True,
        help_text="The photo's place name; null or empty without one",
    )
    short_place = serializers.SerializerMethodField()

    class Meta:
        model = Photo
        fields = (
            "id",
            "image_hash",
            "exif_timestamp",
            "exif_gps_lat",
            "exif_gps_lon",
            "place",
            "short_place",
        )
        read_only_fields = fields

    def get_short_place(self, obj: Photo) -> str | None:
        """The town or region of the photo's place, for a small label; null
        without a place."""
        return short_place_name(obj.geolocation_json)
