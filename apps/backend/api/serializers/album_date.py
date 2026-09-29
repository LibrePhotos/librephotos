from django.db.models import Prefetch
from rest_framework import serializers

from api.models import AlbumDate, Photo

PUBLIC_PHOTOS_ATTR = "public_photos"


def _public_photos():
    return (
        Photo.objects.filter(
            public=True, hidden=False, in_trashcan=False, removed=False
        )
        .only("id", "geolocation_json", "exif_timestamp")
        .order_by("exif_timestamp", "id")
    )


def prefetch_public_photos():
    """Prefetch for ``IncompleteAlbumDateSerializer`` in the public view."""
    return Prefetch("photos", queryset=_public_photos(), to_attr=PUBLIC_PHOTOS_ATTR)


def _stored_place(obj):
    if obj and obj.location:
        return obj.location["places"][0]
    return ""


def _public_place(obj):
    """The day's place as its public photos tell it.

    ``AlbumDate.location`` collects the city of every photo of the day,
    private ones included, so the public view must not show it. The city is
    picked the way the geocoder picks it (``add_location_to_album_dates``).
    """
    photos = getattr(obj, PUBLIC_PHOTOS_ATTR, None)
    if photos is None:
        photos = _public_photos().filter(albumdate=obj)
    for photo in photos:
        places = (photo.geolocation_json or {}).get("places") or []
        if len(places) >= 2:
            return places[-2]
    return ""


def _place(serializer, obj):
    if serializer.context.get("public"):
        return _public_place(obj)
    return _stored_place(obj)


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
        return _place(self, obj)


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
        return _place(self, obj)
