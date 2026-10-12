from django.db.models import Prefetch, QuerySet
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from api.models import AlbumDate, Photo
from api.views.params import ClampedIntegerField

PUBLIC_PHOTOS_ATTR = "public_photos"


def _public_photos() -> QuerySet[Photo]:
    return (
        Photo.objects.filter(
            public=True, hidden=False, in_trashcan=False, removed=False
        )
        .only("id", "geolocation_json", "exif_timestamp")
        .order_by("exif_timestamp", "id")
    )


def prefetch_public_photos() -> Prefetch:
    """Prefetch for ``IncompleteAlbumDateSerializer`` in the public view."""
    return Prefetch("photos", queryset=_public_photos(), to_attr=PUBLIC_PHOTOS_ATTR)


def _stored_place(obj: AlbumDate) -> str:
    if obj.location:
        return obj.location["places"][0]
    return ""


def _public_place(obj: AlbumDate) -> str:
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


def _place(serializer: serializers.BaseSerializer, obj: AlbumDate) -> str:
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

    def get_id(self, obj: AlbumDate) -> str:
        return str(obj.id)

    def get_date(self, obj: AlbumDate) -> str | None:
        if obj.date:
            return obj.date.isoformat()
        else:
            return None

    def get_items(self, obj: AlbumDate) -> list:
        return []

    def get_incomplete(self, obj: AlbumDate) -> bool:
        return True

    def get_number_of_items(self, obj: AlbumDate) -> int:
        # photo_count is annotated by the album list's queryset; not a model field.
        photo_count: int = getattr(obj, "photo_count")
        if photo_count:
            return photo_count
        else:
            return 0

    def get_location(self, obj: AlbumDate) -> str:
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

    def get_id(self, obj: AlbumDate) -> str:
        return str(obj.id)

    def get_date(self, obj: AlbumDate) -> str | None:
        if obj.date:
            return obj.date.isoformat()
        else:
            return None

    # The schema keeps the types these returned before they were removed: the
    # annotations alone are None, which drf-spectacular cannot map.
    @extend_schema_field(dict)
    def get_items(self, obj: AlbumDate) -> None:
        # This method is removed as we're directly including paginated photos in the response.
        pass

    def get_incomplete(self, obj: AlbumDate) -> bool:
        return False

    @extend_schema_field(int)
    def get_number_of_items(self, obj: AlbumDate) -> None:
        # this will also get added in the response
        pass

    def get_location(self, obj: AlbumDate) -> str:
        return _place(self, obj)


class AlbumDatePageQuery(serializers.Serializer[None]):
    """The page of a day album's photos (the other filters are read apart)."""

    size = ClampedIntegerField(
        default=100, lowest=1, help_text="Photos per page (default 100)"
    )
    # Kept as text: Django's Paginator answers a non-number with page 1.
    page = serializers.CharField(default="1", help_text="Page number")
