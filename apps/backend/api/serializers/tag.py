from typing import Any

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from api.drf.params import JsonStringField
from api.models import Tag
from api.serializers.photos import (
    GroupedPhotosSerializer,
    PhotoHashListSerializer,
)
from api.serializers.PhotosGroupedByDate import (
    filter_photos_by_media_type,
    get_photos_ordered_by_date,
)


class TagSerializer(serializers.ModelSerializer):
    class Meta:
        model = Tag
        fields = ("id", "name", "photo_count")
        read_only_fields = ("id", "photo_count")

    def validate_name(self, value: str) -> str:
        name = value.strip()
        if not name:
            raise serializers.ValidationError("Tag name may not be empty.")

        request = self.context.get("request")
        owner = request.user if request else None
        taken = Tag.objects.owned_by(owner).filter(name=name)
        if self.instance:
            taken = taken.exclude(pk=self.instance.pk)
        if taken.exists():
            raise serializers.ValidationError(f"Tag '{name}' already exists.")
        return name


class TagListSerializer(serializers.ModelSerializer):
    cover_photos = PhotoHashListSerializer(many=True, read_only=True)

    class Meta:
        model = Tag
        fields = ("id", "name", "photo_count", "cover_photos")


class GroupedTagPhotosSerializer(serializers.ModelSerializer):
    grouped_photos = serializers.SerializerMethodField()

    class Meta:
        model = Tag
        fields = ("id", "name", "grouped_photos")

    @extend_schema_field(GroupedPhotosSerializer(many=True))
    def get_grouped_photos(self, obj: Tag) -> list[dict[str, Any]]:
        photos = filter_photos_by_media_type(
            obj.photos.all(), self.context.get("request")
        )
        grouped_photos = get_photos_ordered_by_date(photos)
        # ``.data`` of a many=True serializer is a ReturnList; build it through
        # ListSerializer so the static type matches the runtime value.
        return serializers.ListSerializer(
            child=GroupedPhotosSerializer(), instance=grouped_photos
        ).data


class TagListQuery(serializers.Serializer[None]):
    photo = serializers.CharField(
        required=False,
        allow_blank=True,
        help_text="Only the tags of this photo (id or image hash)",
    )


class TagCreateRequest(serializers.Serializer[None]):
    """What create reads before ``TagSerializer`` validates the body itself:
    the name, to answer with the existing tag of that name."""

    name = serializers.CharField(required=False, allow_blank=True, default="")


class TagPhotosRequest(serializers.Serializer[None]):
    """Photos to attach or detach: ``photos`` (ids or image hashes), or
    ``select_all`` with the ``query`` on screen minus ``excluded_hashes``."""

    select_all = serializers.BooleanField(default=False)
    photos = serializers.ListField(child=serializers.CharField(), required=False)
    query = serializers.DictField(default=dict)
    excluded_hashes = serializers.ListField(
        child=JsonStringField(), default=list, allow_null=True
    )


class TagMergeRequest(serializers.Serializer[None]):
    tag = serializers.IntegerField(
        error_messages={"required": "No tag provided", "null": "No tag provided"},
        help_text="The tag to merge into this one; it is deleted",
    )
