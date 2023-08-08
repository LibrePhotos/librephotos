from django.core.paginator import Paginator
from rest_framework import serializers

from api.models import AlbumDate
from api.serializers.photos import PhotoSummarySerializer


class IncompleteAlbumDateSerializer(serializers.ModelSerializer):
    id = serializers.SerializerMethodField()
    date = serializers.SerializerMethodField()
    location = serializers.SerializerMethodField()
    incomplete = serializers.SerializerMethodField()
    numberOfItems = serializers.SerializerMethodField("get_number_of_items")
    items = serializers.SerializerMethodField()

    class Meta:
        model = AlbumDate
        fields = ("id", "date", "location", "incomplete", "numberOfItems", "items")

    def get_id(self, obj) -> str:
        return str(obj.id)

    def get_date(self, obj) -> str:
        if obj.date:
            return obj.date.isoformat()
        else:
            return None

    def get_items(self, obj) -> list:
        return []

    def get_incomplete(self, obj) -> bool:
        return True

    def get_number_of_items(self, obj) -> int:
        if obj and obj.photo_count:
            return obj.photo_count
        else:
            return 0

    def get_location(self, obj) -> str:
        if obj and obj.location:
            return obj.location["places"][0]
        else:
            return ""


class AlbumDateSerializer(serializers.ModelSerializer):
    id = serializers.SerializerMethodField()
    date = serializers.SerializerMethodField()
    location = serializers.SerializerMethodField()
    incomplete = serializers.SerializerMethodField()
    numberOfItems = serializers.SerializerMethodField("get_number_of_items")
    items = serializers.SerializerMethodField()

    class Meta:
        model = AlbumDate
        fields = ("id", "date", "location", "incomplete", "numberOfItems", "items")

    def get_id(self, obj) -> str:
        return str(obj.id)

    def get_date(self, obj) -> str:
        if obj.date:
            return obj.date.isoformat()
        else:
            return None

    def get_items(self, obj) -> PhotoSummarySerializer(many=True):
        page_size = self.context["request"].query_params.get("size") or 100
        paginator = Paginator(obj.photos.all(), page_size)
        page_number = self.context["request"].query_params.get("page") or 1
        photos = paginator.page(page_number)
        serializer = PhotoSummarySerializer(photos, many=True)
        return serializer.data

    def get_incomplete(self, obj) -> bool:
        return False

    def get_number_of_items(self, obj) -> int:
        if obj and obj.photo_count:
            return obj.photo_count
        else:
            return 0

    def get_location(self, obj) -> str:
        if obj and obj.location:
            return obj.location["places"][0]
        else:
            return ""
