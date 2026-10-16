from typing import Any
from uuid import UUID

from django.db.models import Prefetch, QuerySet
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from api.models import AlbumAuto, Person, Photo
from api.models.album_auto import TIME_OF_DAY
from api.models.photo import visible_photo_q
from api.serializers.fields import (
    MissingRelationsError,
    OwnedPhotoField,
    loaded_count,
    loaded_list,
)
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


def with_event_cover(queryset: QuerySet[AlbumAuto]) -> QuerySet[AlbumAuto]:
    """Load the cover the owner picked (#429), for ``custom_cover``.

    One query for any number of events. A cover that is hidden, trashed or
    removed since loads as None, so the event shows its automatic cover
    instead of a photo its own page no longer lists.
    """
    return queryset.prefetch_related(
        Prefetch("cover_photo", queryset=Photo.visible.all())
    )


def custom_cover(album: AlbumAuto) -> Photo | None:
    """The picked cover ``with_event_cover`` loaded, or None for the automatic one."""
    if not AlbumAuto.cover_photo.is_cached(album):
        raise MissingRelationsError(
            "AlbumAuto.cover_photo was not loaded: pass the queryset through "
            "with_event_cover()"
        )
    return album.cover_photo


class AlbumAutoEditSerializer(serializers.ModelSerializer):
    """``PATCH /api/albums/auto/{id}/``: the event's cover (#429).

    One of the event's own visible photos, or null for the automatic cover
    (the first visible photo).
    """

    cover_photo = OwnedPhotoField(
        allow_null=True,
        help_text="A photo id of this event; null for the automatic cover",
    )

    class Meta:
        model = AlbumAuto
        fields = ("id", "cover_photo")
        read_only_fields = ("id",)

    def validate_cover_photo(self, photo: Photo | None) -> Photo | None:
        if photo is None:
            return None
        album = self.instance
        in_event = isinstance(album, AlbumAuto) and (
            album.photos.filter(visible_photo_q(), pk=photo.pk).exists()
        )
        if not in_event:
            raise serializers.ValidationError(
                "The cover has to be one of the event's photos.", code="not_in_event"
            )
        return photo


class AlbumAutoSerializer(serializers.ModelSerializer):
    photos = PhotoSimpleSerializer(many=True, read_only=False)
    title_parts = EventTitlePartsSerializer(read_only=True, allow_null=True)
    people = serializers.SerializerMethodField()
    cover_photo = serializers.SerializerMethodField()

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
            "cover_photo",
        )

    def get_cover_photo(self, obj: AlbumAuto) -> UUID | None:
        """The id of the cover the owner picked; null while it is automatic."""
        cover = custom_cover(obj)
        return cover.id if cover else None

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
        """The event's cover: the one its owner picked, else its first visible photo."""
        # Both loaded by AlbumAutoListViewSet; first_photo is a Prefetch to_attr.
        cover = custom_cover(obj) or next(
            iter(loaded_list(obj, "first_photo", Photo)), None
        )
        if cover is None:
            return ""
        return PhotoHashListSerializer(cover).data
