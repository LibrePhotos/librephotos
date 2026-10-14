from typing import Any

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from api.models import AlbumAuto, Person, Photo
from api.models.album_auto import TIME_OF_DAY
from api.serializers.fields import loaded_count, loaded_list
from api.serializers.person import PersonSerializer
from api.serializers.photos import PhotoHashListSerializer
from api.serializers.simple import PhotoSimpleSerializer


class EventTitlePartsSerializer(serializers.Serializer):
    """``AlbumAuto.title_parts``: what the title is made of, for clients that word it (#2235).

    Output only: the fields are read-only, so the schema has no request twin.
    """

    weekday = serializers.IntegerField(
        read_only=True, allow_null=True, help_text="ISO weekday, Monday is 1"
    )
    time_of_day = serializers.ChoiceField(
        choices=[key for _, key in TIME_OF_DAY], read_only=True, allow_null=True
    )
    span_days = serializers.IntegerField(read_only=True)
    weekend = serializers.BooleanField(read_only=True)
    people = serializers.ListField(child=serializers.CharField(), read_only=True)
    places = serializers.ListField(child=serializers.CharField(), read_only=True)
    date = serializers.CharField(
        read_only=True, help_text="The album's grouping date, YYYY-MM-DD"
    )


class AlbumAutoSerializer(serializers.ModelSerializer):
    photos = PhotoSimpleSerializer(many=True, read_only=False)
    title_parts = EventTitlePartsSerializer(read_only=True, allow_null=True)
    people = serializers.SerializerMethodField()

    class Meta:
        model = AlbumAuto
        fields = (
            "id",
            "title",
            "title_parts",
            "favorited",
            "timestamp",
            "created_on",
            "gps_lat",
            "people",
            "gps_lon",
            "photos",
        )

    @extend_schema_field(PersonSerializer(many=True))
    def get_people(self, obj: AlbumAuto) -> list[dict[str, Any]]:
        # Each person once, in order of first appearance: serializing one per
        # face cost a cover lookup per face and a quadratic de-duplication.
        persons: dict[int, Person | None] = {}
        for photo in obj.photos.all():
            for face in photo.faces.all():
                if face.deleted or face.person_id is None:
                    continue
                persons.setdefault(face.person_id, face.person)
        # ``.data`` of a many=True serializer is a ReturnList; build it through
        # ListSerializer so the static type matches the runtime value.
        return serializers.ListSerializer(
            child=PersonSerializer(), instance=list(persons.values())
        ).data

    def delete(self, validated_data: dict[str, Any], id: int) -> None:
        album = AlbumAuto.objects.filter(id=id).get()
        album.delete()


class AlbumAutoListSerializer(serializers.ModelSerializer):
    photos = serializers.SerializerMethodField()
    photo_count = serializers.SerializerMethodField()
    title_parts = EventTitlePartsSerializer(read_only=True, allow_null=True)
    # The first photo's exif_timestamp, annotated by AlbumAutoListViewSet.
    start = serializers.DateTimeField(read_only=True, allow_null=True)

    class Meta:
        model = AlbumAuto
        fields = (
            "id",
            "title",
            "title_parts",
            "timestamp",
            "start",
            "photos",
            "photo_count",
            "favorited",
        )

    def get_photo_count(self, obj: AlbumAuto) -> int:
        # Annotated by AlbumAutoListViewSet's queryset; not a model field.
        return loaded_count(obj, "photo_count")

    @extend_schema_field(PhotoHashListSerializer)
    def get_photos(self, obj: AlbumAuto) -> dict[str, Any] | str:
        # Prefetched by AlbumAutoListViewSet (to_attr), not a model field.
        cover_photo = loaded_list(obj, "cover_photo", Photo)
        if not cover_photo:
            return ""
        return PhotoHashListSerializer(cover_photo[0]).data
