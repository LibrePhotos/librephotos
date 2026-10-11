"""
Serializers for PhotoMetadata, MetadataFile, and MetadataEdit models.

These serializers provide:
- Structured metadata access (replacing exif_json blob)
- Edit history tracking
"""

from typing import Any

from rest_framework import serializers

from api.models import User
from api.models.photo_metadata import MetadataEdit, MetadataFile, PhotoMetadata
from api.models.tag import sync_tags_from_keywords
from api.request_user import request_user


class MetadataFileSerializer(serializers.ModelSerializer):
    """Serializer for XMP sidecars and other metadata files."""

    class Meta:
        model = MetadataFile
        fields = (
            "id",
            "file_type",
            "source",
            "priority",
            "creator_software",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "created_at", "updated_at")


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


class PhotoMetadataSerializer(serializers.ModelSerializer):
    """
    Full metadata serializer with all structured fields.

    Used for the detailed metadata view and editing.
    """

    # Computed properties
    resolution = serializers.ReadOnlyField()
    megapixels = serializers.ReadOnlyField()
    has_location = serializers.ReadOnlyField()
    camera_display = serializers.ReadOnlyField()
    lens_display = serializers.ReadOnlyField()

    # Related data
    edit_history = serializers.SerializerMethodField()
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
        read_only_fields = (
            "id",
            "resolution",
            "megapixels",
            "has_location",
            "camera_display",
            "lens_display",
            "version",
            "created_at",
            "updated_at",
        )

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

    def get_sidecar_files(self, obj: PhotoMetadata) -> list:
        """Get sidecar files for this photo."""
        files = MetadataFile.objects.filter(photo=obj.photo)
        return serializers.ListSerializer(
            child=MetadataFileSerializer(), instance=files
        ).data


class PhotoMetadataUpdateSerializer(serializers.ModelSerializer):
    """
    Serializer for updating metadata with change tracking.

    Only allows editing specific fields and automatically
    creates MetadataEdit records for history.
    """

    class Meta:
        model = PhotoMetadata
        fields = (
            # Editable fields
            "title",
            "caption",
            "keywords",
            "rating",
            "copyright",
            "creator",
            # Location (can be user-corrected)
            "gps_latitude",
            "gps_longitude",
            "location_country",
            "location_state",
            "location_city",
            "location_address",
            # Timestamp (can be user-corrected)
            "date_taken",
            "timezone_offset",
        )

    def update(
        self, instance: PhotoMetadata, validated_data: dict[str, Any]
    ) -> PhotoMetadata:
        """Update metadata and create edit history records."""
        # The metadata views require authentication (IsAuthenticated).
        request = self.context.get("request")
        user = request_user(request) if request else None
        previous_keywords = instance.keywords

        for field_name, new_value in validated_data.items():
            old_value = getattr(instance, field_name)

            # Only track actual changes
            if old_value != new_value:
                # MetadataEdit.user is non-nullable: a write needs a user.
                assert user is not None
                # Create edit history record
                MetadataEdit.objects.create(
                    photo=instance.photo,
                    user=user,
                    field_name=field_name,
                    old_value=old_value,
                    new_value=new_value,
                )

                # Update the field
                setattr(instance, field_name, new_value)

        # Update source to user_edit and increment version
        instance.source = PhotoMetadata.Source.USER_EDIT
        instance.version += 1
        instance.save()

        if "keywords" in validated_data:
            sync_tags_from_keywords(
                instance.photo, instance.keywords, previous_keywords
            )

        return instance


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
    has_location = serializers.ReadOnlyField()

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

    def get_has_edits(self, obj: PhotoMetadata) -> bool:
        """Check if this photo has any metadata edits."""
        return MetadataEdit.objects.filter(photo=obj.photo).exists()
