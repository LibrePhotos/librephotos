from typing import Any

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from api.models import AlbumThing
from api.serializers.photos import GroupedPhotosSerializer, PhotoHashListSerializer
from api.serializers.PhotosGroupedByDate import (
    filter_photos_by_media_type,
    get_photos_ordered_by_date,
)
from api.serializers.simple import PhotoSuperSimpleSerializer


class GroupedThingPhotosSerializer(serializers.ModelSerializer):
    grouped_photos = serializers.SerializerMethodField()

    class Meta:
        model = AlbumThing
        fields = (
            "id",
            "title",
            "grouped_photos",
        )

    @extend_schema_field(GroupedPhotosSerializer(many=True))
    def get_grouped_photos(self, obj: AlbumThing) -> list[dict[str, Any]]:
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


class AlbumThingSerializer(serializers.ModelSerializer):
    photos = PhotoSuperSimpleSerializer(many=True, read_only=True)

    class Meta:
        model = AlbumThing
        fields = ("id", "title", "photos")


class AlbumThingListSerializer(serializers.ModelSerializer):
    # Up to four of the album's visible photos, prefetched by the list view;
    # not the stored cover_photos, which keep photos hidden or trashed since.
    cover_photos = PhotoHashListSerializer(
        source="visible_cover_photos", many=True, read_only=True
    )
    photo_count = serializers.SerializerMethodField()

    class Meta:
        model = AlbumThing
        fields = (
            "id",
            "cover_photos",
            "title",
            "photo_count",
            "thing_type",
            "cover_photos",
        )

    def get_photo_count(self, obj: AlbumThing) -> int:
        return obj.photo_count
