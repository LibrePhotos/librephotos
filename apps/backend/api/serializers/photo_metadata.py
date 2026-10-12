"""
Serializers for PhotoMetadata and MetadataEdit.

Capture date, location, rating and caption are shown under their old
``PhotoMetadata`` names but read from their one store, ``Photo`` /
``PhotoCaption`` (#2252), so ``metadata.*`` keeps its shape for the clients.
"""

from typing import Any

from django.core.exceptions import ObjectDoesNotExist
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from api.metadata.edits import MAX_RATING
from api.models import User
from api.models.photo import Photo
from api.models.photo_metadata import MetadataEdit, PhotoMetadata
from api.views.params import JsonStringField, QueryFlagField


class MetadataEditSerializer(serializers.ModelSerializer):
    """Serializer for metadata edit history."""

    user_name = serializers.SerializerMethodField()

    class Meta:
        model = MetadataEdit
        fields = (
            "id",
            "field_name",
            "old_value",
            "new_value",
            "user",
            "user_name",
            "synced_to_file",
            "synced_at",
            "created_at",
        )
        read_only_fields = fields

    def get_user_name(self, obj: MetadataEdit) -> str:
        user: User | None = obj.user
        if user:
            return user.username
        return "Unknown"


def _has_location(photo: Photo) -> bool:
    return photo.exif_gps_lat is not None and photo.exif_gps_lon is not None


class PhotoMetadataSerializer(serializers.ModelSerializer):
    """
    Full metadata of one photo, for ``GET``/``PATCH /api/photos/{id}/metadata``.

    Read-only: edits go through ``PhotoMetadataUpdateSerializer`` and
    ``api.metadata.edits``.
    """

    # Computed properties
    resolution = serializers.ReadOnlyField()
    megapixels = serializers.ReadOnlyField()
    camera_display = serializers.ReadOnlyField()
    lens_display = serializers.ReadOnlyField()

    # Read from Photo / PhotoCaption, their one store (#2252).
    date_taken = serializers.DateTimeField(
        source="photo.exif_timestamp", read_only=True, allow_null=True
    )
    gps_latitude = serializers.FloatField(
        source="photo.exif_gps_lat", read_only=True, allow_null=True
    )
    gps_longitude = serializers.FloatField(
        source="photo.exif_gps_lon", read_only=True, allow_null=True
    )
    has_location = serializers.SerializerMethodField()
    # The geocoder's address; the place is not split into these parts anywhere.
    location_country = serializers.SerializerMethodField(method_name="get_no_value")
    location_state = serializers.SerializerMethodField(method_name="get_no_value")
    location_city = serializers.SerializerMethodField(method_name="get_no_value")
    location_address = serializers.SerializerMethodField()
    caption = serializers.SerializerMethodField()
    rating = serializers.IntegerField(source="photo.rating", read_only=True)

    # Related data
    edit_history = serializers.SerializerMethodField()
    # MetadataFile was never filled in and is gone; kept for the clients.
    sidecar_files = serializers.SerializerMethodField()

    class Meta:
        model = PhotoMetadata
        fields = (
            "id",
            # Camera settings
            "aperture",
            "shutter_speed",
            "shutter_speed_seconds",
            "iso",
            "focal_length",
            "focal_length_35mm",
            "exposure_compensation",
            "flash_fired",
            "metering_mode",
            "white_balance",
            # Camera/lens info
            "camera_make",
            "camera_model",
            "lens_make",
            "lens_model",
            "serial_number",
            "camera_display",
            "lens_display",
            # Image properties
            "width",
            "height",
            "orientation",
            "color_space",
            "bit_depth",
            "resolution",
            "megapixels",
            # Timestamps
            "date_taken",
            "date_taken_subsec",
            "date_modified",
            "timezone_offset",
            # Location
            "gps_latitude",
            "gps_longitude",
            "gps_altitude",
            "location_country",
            "location_state",
            "location_city",
            "location_address",
            "has_location",
            # Content
            "title",
            "caption",
            "keywords",
            "rating",
            "copyright",
            "creator",
            # Tracking
            "source",
            "version",
            "created_at",
            "updated_at",
            # Related
            "edit_history",
            "sidecar_files",
        )
        read_only_fields = fields

    def get_has_location(self, obj: PhotoMetadata) -> bool:
        return _has_location(obj.photo)

    @extend_schema_field(OpenApiTypes.STR)
    def get_no_value(self, obj: PhotoMetadata) -> str | None:
        return None

    def get_location_address(self, obj: PhotoMetadata) -> str | None:
        geolocation = obj.photo.geolocation_json
        if isinstance(geolocation, dict):
            address = geolocation.get("address")
            if isinstance(address, str) and address:
                return address
        return None

    def get_caption(self, obj: PhotoMetadata) -> str | None:
        try:
            captions = obj.photo.caption_instance.captions_json
        except ObjectDoesNotExist:
            return None
        caption = (captions or {}).get("user_caption")
        return caption if isinstance(caption, str) and caption else None

    def get_edit_history(self, obj: PhotoMetadata) -> list:
        """Get recent edit history for this photo."""
        # -id tiebreaks edits sharing a created_at so the slice is stable; see
        # MetadataEdit.Meta.
        edits = MetadataEdit.objects.filter(photo=obj.photo).order_by(
            "-created_at", "-id"
        )[:10]
        # Same output as MetadataEditSerializer(edits, many=True).data; built via
        # ListSerializer so the static type is the list it really returns.
        return serializers.ListSerializer(
            child=MetadataEditSerializer(), instance=edits
        ).data

    @extend_schema_field(serializers.ListField(child=serializers.DictField()))
    def get_sidecar_files(self, obj: PhotoMetadata) -> list[dict[str, object]]:
        return []


class PhotoMetadataUpdateSerializer(serializers.Serializer):
    """The fields the metadata API edits, single and bulk.

    Each goes to its one store through ``api.metadata.edits``: ``rating`` to
    ``Photo.rating``, ``caption`` to the lightbox caption, ``keywords``,
    ``title``, ``copyright`` and ``creator`` to ``PhotoMetadata``. The date and
    the location are edited through ``PATCH /api/photos/edit/{image_hash}/``;
    sending them here is a 400 rather than an edit nobody sees.
    """

    # The fields this endpoint used to accept and wrote where nothing read
    # them (#2252).
    MOVED_FIELDS = (
        "date_taken",
        "timezone_offset",
        "gps_latitude",
        "gps_longitude",
        "location_country",
        "location_state",
        "location_city",
        "location_address",
    )

    title = serializers.CharField(
        max_length=500, required=False, allow_null=True, allow_blank=True
    )
    caption = serializers.CharField(
        required=False, allow_null=True, allow_blank=True, trim_whitespace=False
    )
    keywords = serializers.ListField(
        child=serializers.CharField(), required=False, allow_null=True
    )
    rating = serializers.IntegerField(
        min_value=0, max_value=MAX_RATING, required=False, allow_null=True
    )
    copyright = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    creator = serializers.CharField(
        max_length=200, required=False, allow_null=True, allow_blank=True
    )

    def to_internal_value(self, data: object) -> dict[str, Any]:
        if isinstance(data, dict):
            moved = [field for field in self.MOVED_FIELDS if field in data]
            if moved:
                raise serializers.ValidationError(
                    {
                        field: (
                            "Not editable here: set the date and the location "
                            "with PATCH /api/photos/edit/{image_hash}/."
                        )
                        for field in moved
                    }
                )
        validated: dict[str, Any] = super().to_internal_value(data)
        # Photo.rating has no null: no rating is 0. The lightbox caption has
        # no null either: no caption is the empty string.
        if "rating" in validated and validated["rating"] is None:
            validated["rating"] = 0
        if "caption" in validated and validated["caption"] is None:
            validated["caption"] = ""
        return validated


class PhotoMetadataSummarySerializer(serializers.ModelSerializer):
    """
    Lightweight metadata summary for photo lists.

    Returns key metadata fields without the full detail.
    """

    # Computed @property fields need ReadOnlyField to be resolved
    camera_display = serializers.ReadOnlyField()
    lens_display = serializers.ReadOnlyField()
    resolution = serializers.ReadOnlyField()
    megapixels = serializers.ReadOnlyField()

    # Read from Photo, their one store (#2252).
    date_taken = serializers.DateTimeField(
        source="photo.exif_timestamp", read_only=True, allow_null=True
    )
    has_location = serializers.SerializerMethodField()
    rating = serializers.IntegerField(source="photo.rating", read_only=True)

    # SerializerMethodField for cross-model query
    has_edits = serializers.SerializerMethodField()

    class Meta:
        model = PhotoMetadata
        fields = (
            # Camera info
            "camera_display",
            "lens_display",
            # Capture settings
            "aperture",
            "shutter_speed",
            "iso",
            "focal_length",
            "focal_length_35mm",
            # Image info
            "resolution",
            "megapixels",
            # Date/location
            "date_taken",
            "has_location",
            # Content
            "rating",
            # Edit tracking
            "source",
            "version",
            "has_edits",
        )
        read_only_fields = fields

    def get_has_location(self, obj: PhotoMetadata) -> bool:
        return _has_location(obj.photo)

    def get_has_edits(self, obj: PhotoMetadata) -> bool:
        """Check if this photo has any metadata edits."""
        return MetadataEdit.objects.filter(photo=obj.photo).exists()


class MetadataRevertQuery(serializers.Serializer[None]):
    force = QueryFlagField(
        true_values={"1", "true"},
        help_text="1 to revert even if the field was changed again later",
    )


class BulkMetadataQuery(serializers.Serializer[None]):
    photo_ids = serializers.CharField(
        default="",
        allow_blank=True,
        help_text="Comma-separated photo IDs or image hashes (at most 100)",
    )


MAX_BULK_METADATA_PHOTOS = 100


class BulkMetadataUpdateRequest(serializers.Serializer[None]):
    photo_ids = serializers.ListField(
        child=JsonStringField(),
        allow_empty=False,
        max_length=MAX_BULK_METADATA_PHOTOS,
        error_messages={
            "required": "No photo_ids provided.",
            "empty": "No photo_ids provided.",
            "not_a_list": "Expected a list of photo ids.",
            "null": "Expected a list of photo ids.",
            "max_length": f"Maximum {MAX_BULK_METADATA_PHOTOS} photos per request.",
        },
        help_text="Photo ids or image hashes",
    )
    updates = serializers.DictField(
        allow_empty=False,
        error_messages={
            "required": "No updates provided.",
            "empty": "No updates provided.",
            "not_a_dict": "No updates provided.",
            "null": "No updates provided.",
        },
        help_text="The fields of PhotoMetadataUpdateSerializer to set",
    )
