from rest_framework import serializers

from api.models import AlbumDate


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

    def get_items(self, obj) -> dict:
        # This method is removed as we're directly including paginated photos in the response.
        pass

    def get_incomplete(self, obj) -> bool:
        return False

    def get_number_of_items(self, obj) -> int:
        # this will also get added in the response
        pass

    def get_location(self, obj) -> str:
        if obj and obj.location:
            return obj.location["places"][0]
        else:
            return ""
