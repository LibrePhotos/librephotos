from typing import Any

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from api.models import AlbumPlace
from api.serializers.photos import GroupedPhotosSerializer, PhotoHashListSerializer
from api.serializers.PhotosGroupedByDate import (
    filter_photos_by_media_type,
    get_photos_ordered_by_date,
)
from api.serializers.simple import PhotoSuperSimpleSerializer


class GroupedPlacePhotosSerializer(serializers.ModelSerializer):
    grouped_photos = serializers.SerializerMethodField()

    class Meta:
        model = AlbumPlace
        fields = (
            "id",
            "title",
            "grouped_photos",
        )

    @extend_schema_field(GroupedPhotosSerializer(many=True))
    def get_grouped_photos(self, obj: AlbumPlace) -> list[dict[str, Any]]:
        photos = filter_photos_by_media_type(
            obj.photos.all(), self.context.get("request")
        )
        grouped_photos = get_photos_ordered_by_date(photos)
        # ``.data`` of a many=True serializer is a ReturnList; build it through
        # ListSerializer so the static type matches the runtime value.
        res = serializers.ListSerializer(
            child=GroupedPhotosSerializer(),
            instance=grouped_photos,
            context=self.context,
        ).data
        return res


class AlbumPlaceSerializer(serializers.ModelSerializer):
    photos = PhotoSuperSimpleSerializer(many=True, read_only=True)

    class Meta:
        model = AlbumPlace
        fields = ("id", "title", "photos")


class AlbumPlaceListSerializer(serializers.ModelSerializer):
    cover_photos = PhotoHashListSerializer(many=True, read_only=True)
    photo_count = serializers.SerializerMethodField()

    class Meta:
        model = AlbumPlace
        fields = ("id", "geolocation_level", "cover_photos", "title", "photo_count")

    def get_photo_count(self, obj: AlbumPlace) -> int:
        # Annotated by the list view's queryset; not a model field.
        count: int = getattr(obj, "photo_count")
        return count
