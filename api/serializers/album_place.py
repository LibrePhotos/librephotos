from rest_framework import serializers

from api.models import AlbumPlace
from api.serializers.photos import GroupedPhotosSerializer, PhotoHashListSerializer
from api.serializers.PhotosGroupedByDate import get_photos_ordered_by_date
from api.serializers.simple import PhotoSuperSimpleSerializer


class GroupedPlacePhotosSerializer(serializers.ModelSerializer):
    id = serializers.SerializerMethodField()
    grouped_photos = serializers.SerializerMethodField()

    class Meta:
        model = AlbumPlace
        fields = (
            "id",
            "title",
            "grouped_photos",
        )

    # To-Do: Remove legacy stuff
    def get_id(self, obj) -> str:
        return str(obj.id)

    def get_grouped_photos(self, obj) -> GroupedPhotosSerializer(many=True):
        grouped_photos = get_photos_ordered_by_date(obj.photos.all())
        res = GroupedPhotosSerializer(grouped_photos, many=True).data
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

    def get_photo_count(self, obj) -> int:
        return obj.photo_count
