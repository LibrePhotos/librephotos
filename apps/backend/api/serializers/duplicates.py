"""
Serializers for duplicate detection feature.
"""

import os

from rest_framework import serializers

from api.models import Photo
from api.models.duplicate_group import DuplicateGroup
from api.util import logger


def _strip_extension(url: str | None) -> str | None:
    """Strip file extension from thumbnail URL (proxy adds it back)."""
    if url:
        return os.path.splitext(url)[0]
    return None


class DuplicatePhotoSerializer(serializers.ModelSerializer):
    """Serializer for photos within a duplicate group."""

    square_thumbnail_url = serializers.SerializerMethodField()
    big_thumbnail_url = serializers.SerializerMethodField()
    image_path = serializers.SerializerMethodField()

    class Meta:
        model = Photo
        fields = (
            "image_hash",
            "square_thumbnail_url",
            "big_thumbnail_url",
            "image_path",
            "width",
            "height",
            "size",
            "rating",
            "exif_timestamp",
            "video",
            "camera",
            "lens",
        )

    def get_square_thumbnail_url(self, obj) -> str | None:
        try:
            # Check if thumbnail relation exists (avoid RelatedObjectDoesNotExist)
            thumbnail = getattr(obj, "thumbnail", None)
            if thumbnail and thumbnail.square_thumbnail:
                # Strip extension - proxy adds it back
                return _strip_extension(thumbnail.square_thumbnail.url)
        except Exception:
            pass
        return None

    def get_big_thumbnail_url(self, obj) -> str | None:
        try:
            # Check if thumbnail relation exists (avoid RelatedObjectDoesNotExist)
            thumbnail = getattr(obj, "thumbnail", None)
            if thumbnail and thumbnail.thumbnail_big:
                # Strip extension - proxy adds it back
                return _strip_extension(thumbnail.thumbnail_big.url)
        except Exception:
            pass
        return None

    def get_image_path(self, obj) -> list[str]:
        return [f.path for f in obj.files.all()]


class DuplicateGroupSerializer(serializers.ModelSerializer):
    """Serializer for duplicate groups."""

    photos = DuplicatePhotoSerializer(many=True, read_only=True)
    photo_count = serializers.SerializerMethodField()
    preferred_photo_hash = serializers.SerializerMethodField()

    class Meta:
        model = DuplicateGroup
        fields = (
            "id",
            "status",
            "created_at",
            "updated_at",
            "photo_count",
            "preferred_photo_hash",
            "photos",
        )

    def get_photo_count(self, obj) -> int:
        # Use annotated value if available, otherwise use property
        if hasattr(obj, 'photos_count'):
            return obj.photos_count
        return obj.photo_count

    def get_preferred_photo_hash(self, obj) -> str | None:
        if obj.preferred_photo:
            return obj.preferred_photo.image_hash
        return None


class DuplicateGroupListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for listing duplicate groups."""

    photo_count = serializers.SerializerMethodField()
    preview_photos = serializers.SerializerMethodField()

    class Meta:
        model = DuplicateGroup
        fields = (
            "id",
            "status",
            "created_at",
            "photo_count",
            "preview_photos",
        )

    def get_photo_count(self, obj) -> int:
        # Use annotated value if available, otherwise use property
        if hasattr(obj, 'photos_count'):
            return obj.photos_count
        return obj.photo_count

    def get_preview_photos(self, obj) -> list[dict]:
        """Return first 4 photos for preview thumbnails."""
        photos = obj.photos.select_related("thumbnail").all()[:4]
        result = []
        for p in photos:
            thumbnail_url = None
            try:
                thumbnail = getattr(p, "thumbnail", None)
                if thumbnail and thumbnail.square_thumbnail:
                    # Strip extension - proxy adds it back
                    thumbnail_url = _strip_extension(thumbnail.square_thumbnail.url)
                    logger.debug(f"Photo {p.image_hash} has thumbnail: {thumbnail_url}")
                else:
                    logger.warning(f"Photo {p.image_hash} missing thumbnail - thumbnail obj: {thumbnail}")
            except Exception as e:
                logger.error(f"Error getting thumbnail for {p.image_hash}: {e}")
            result.append({
                "image_hash": p.image_hash,
                "square_thumbnail_url": thumbnail_url,
            })
        return result


class ResolveDuplicateGroupSerializer(serializers.Serializer):
    """Serializer for resolving a duplicate group."""

    keep_photo_hash = serializers.CharField(required=True)
    trash_others = serializers.BooleanField(default=True)
