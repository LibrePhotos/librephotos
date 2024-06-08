from rest_framework import serializers

from api.models import AlbumThing
from api.serializers.photos import GroupedPhotosSerializer, PhotoHashListSerializer
from api.serializers.PhotosGroupedByDate import get_photos_ordered_by_date
from api.serializers.simple import PhotoSuperSimpleSerializer


class GroupedThingPhotosSerializer(serializers.ModelSerializer):
    id = serializers.SerializerMethodField()
    grouped_photos = serializers.SerializerMethodField()

    class Meta:
        model = AlbumThing
        fields = (
            "id",
            "title",
            "grouped_photos",
        )

    def get_id(self, obj) -> str:
        return str(obj.id)

    def get_grouped_photos(self, obj) -> GroupedPhotosSerializer(many=True):
        grouped_photos = get_photos_ordered_by_date(obj.photos.all())
        res = GroupedPhotosSerializer(grouped_photos, many=True).data
        return res


class AlbumThingSerializer(serializers.ModelSerializer):
    photos = PhotoSuperSimpleSerializer(many=True, read_only=True)

    class Meta:
        model = AlbumThing
        fields = ("id", "title", "photos")


class AlbumThingListSerializer(serializers.ModelSerializer):
    cover_photos = PhotoHashListSerializer(many=True, read_only=True)
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

    def get_photo_count(self, obj) -> int:
        return obj.photo_count
