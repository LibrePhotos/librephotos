"""
Serializers for PhotoMetadata, MetadataFile, and MetadataEdit models.

These serializers provide:
- Structured metadata access (replacing exif_json blob)
- Edit history tracking
- Backwards-compatible field names for existing API consumers
"""

from rest_framework import serializers

from api.models import Photo
from api.models.photo_metadata import MetadataEdit, MetadataFile, PhotoMetadata


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

    def get_user_name(self, obj) -> str:
        if obj.user:
            return obj.user.username
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

    def get_edit_history(self, obj) -> list:
        """Get recent edit history for this photo."""
        edits = MetadataEdit.objects.filter(photo=obj.photo).order_by("-created_at")[:10]
        return MetadataEditSerializer(edits, many=True).data

    def get_sidecar_files(self, obj) -> list:
        """Get sidecar files for this photo."""
        files = MetadataFile.objects.filter(photo=obj.photo)
        return MetadataFileSerializer(files, many=True).data


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

    def update(self, instance, validated_data):
        """Update metadata and create edit history records."""
        user = self.context.get("request").user if self.context.get("request") else None
        
        for field_name, new_value in validated_data.items():
            old_value = getattr(instance, field_name)
            
            # Only track actual changes
            if old_value != new_value:
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
        
        return instance


class PhotoMetadataSummarySerializer(serializers.Serializer):
    """
    Lightweight metadata summary for photo lists.
    
    Returns key metadata fields without the full detail.
    """

    camera = serializers.CharField(source="camera_display", allow_null=True)
    lens = serializers.CharField(source="lens_display", allow_null=True)
    aperture = serializers.FloatField(allow_null=True)
    shutter_speed = serializers.CharField(allow_null=True)
    iso = serializers.IntegerField(allow_null=True)
    focal_length = serializers.FloatField(allow_null=True)
    date_taken = serializers.DateTimeField(allow_null=True)
    has_location = serializers.BooleanField()
    resolution = serializers.CharField(allow_null=True)


def get_backwards_compatible_metadata(photo: Photo) -> dict:
    """
    Generate backwards-compatible metadata dict from PhotoMetadata.
    
    This function returns metadata in the same format as the original
    Photo model fields for API backwards compatibility.
    
    Note: Metadata fields have been fully migrated to PhotoMetadata model.
    If no PhotoMetadata exists, return None/empty values.
    """
    try:
        metadata = photo.metadata
        return {
            "camera": metadata.camera_display,
            "lens": metadata.lens_display,
            "fstop": metadata.aperture,
            "focal_length": metadata.focal_length,
            "iso": metadata.iso,
            "shutter_speed": metadata.shutter_speed,
            "width": metadata.width,
            "height": metadata.height,
            "focalLength35Equivalent": metadata.focal_length_35mm,
            "digitalZoomRatio": None,  # Not stored in PhotoMetadata
            "subjectDistance": None,   # Not stored in PhotoMetadata
        }
    except PhotoMetadata.DoesNotExist:
        # No PhotoMetadata exists - return None/empty values
        # Metadata will be populated on next photo scan
        return {
            "camera": None,
            "lens": None,
            "fstop": None,
            "focal_length": None,
            "iso": None,
            "shutter_speed": None,
            "width": 0,
            "height": 0,
            "focalLength35Equivalent": None,
            "digitalZoomRatio": None,
            "subjectDistance": None,
        }
