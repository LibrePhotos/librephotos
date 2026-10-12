from typing import Any

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from api.models import AlbumAuto, Person, Photo
from api.serializers.fields import loaded_count, loaded_list
from api.serializers.person import PersonSerializer
from api.serializers.photos import PhotoHashListSerializer
from api.serializers.simple import PhotoSimpleSerializer


class AlbumAutoSerializer(serializers.ModelSerializer):
    photos = PhotoSimpleSerializer(many=True, read_only=False)
    people = serializers.SerializerMethodField()

    class Meta:
        model = AlbumAuto
        fields = (
            "id",
            "title",
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
    # The first photo's exif_timestamp, annotated by AlbumAutoListViewSet.
    start = serializers.DateTimeField(read_only=True, allow_null=True)

    class Meta:
        model = AlbumAuto
        fields = (
            "id",
            "title",
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
