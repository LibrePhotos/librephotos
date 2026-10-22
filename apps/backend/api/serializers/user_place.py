"""Your places (#1365): circles a user named. Only their owner reads them."""

from collections.abc import Mapping
from typing import Any

from django.db.models import Count, F, Prefetch, QuerySet
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from api.drf.params import ClampedIntegerField, JsonCoordinateField
from api.models import Photo
from api.models.photo import visible_photo_q
from api.models.user import User
from api.models.user_place import (
    MAX_PLACES_PER_USER,
    NAME_MAX_LENGTH,
    RADIUS_MAX_M,
    RADIUS_MIN_M,
    UserPlace,
)
from api.serializers.fields import loaded_count, loaded_list, prefetched
from api.serializers.photos import GroupedPhotosSerializer, PhotoHashListSerializer
from api.serializers.PhotosGroupedByDate import (
    filter_photos_by_media_type,
    get_photos_ordered_by_date,
)

# Covers on a place's tile, as on the place albums.
PLACE_COVERS = 4


def _requester(context: Mapping[str, object]) -> User | None:
    """The signed-in user of a serializer's request; ``None`` without one."""
    user = getattr(context.get("request"), "user", None)
    return user if isinstance(user, User) else None


def with_user_place_relations(places: QuerySet[UserPlace]) -> QuerySet[UserPlace]:
    """``places`` with the visible photo count and the newest covers that
    ``UserPlaceSerializer`` reads."""
    covers = Photo.visible.only("image_hash", "video").order_by(
        F("exif_timestamp").desc(nulls_last=True), "pk"
    )
    return places.annotate(
        photo_count=Count("photos", filter=visible_photo_q("photos__"))
    ).prefetch_related(
        Prefetch("photos", queryset=covers[:PLACE_COVERS], to_attr="covers")
    )


class UserPlaceSerializer(serializers.ModelSerializer):
    """One of the requester's places: create and edit write the circle, the
    name, the icon and whether event titles use it."""

    name = serializers.CharField(max_length=NAME_MAX_LENGTH)
    center_lat = JsonCoordinateField(limit=90, help_text="Centre, latitude")
    center_lon = JsonCoordinateField(limit=180, help_text="Centre, longitude")
    radius_m = serializers.IntegerField(
        min_value=RADIUS_MIN_M,
        max_value=RADIUS_MAX_M,
        help_text=f"Radius in metres ({RADIUS_MIN_M} to {RADIUS_MAX_M})",
    )
    photo_count = serializers.SerializerMethodField(
        help_text="The visible photos taken inside it"
    )
    cover_photos = serializers.SerializerMethodField()

    class Meta:
        model = UserPlace
        fields = (
            "id",
            "name",
            "icon",
            "center_lat",
            "center_lon",
            "radius_m",
            "use_in_titles",
            "photo_count",
            "cover_photos",
        )
        read_only_fields = ("id",)

    def get_photo_count(self, obj: UserPlace) -> int:
        return loaded_count(obj, "photo_count")

    @extend_schema_field(PhotoHashListSerializer(many=True))
    def get_cover_photos(self, obj: UserPlace) -> list[dict[str, Any]]:
        covers = loaded_list(obj, "covers", Photo)
        return [
            {"image_hash": photo.image_hash, "video": photo.video} for photo in covers
        ]

    def validate_name(self, value: str) -> str:
        """Trimmed, and free among the owner's places in any letter case."""
        name = value.strip()
        if not name:
            raise serializers.ValidationError(
                "Place name may not be empty.", code="blank"
            )
        taken = UserPlace.objects.owned_by(_requester(self.context)).filter(
            name__iexact=name
        )
        if self.instance is not None:
            taken = taken.exclude(pk=self.instance.pk)
        if taken.exists():
            raise serializers.ValidationError(
                f"You already have a place called '{name}'.", code="unique"
            )
        return name

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        owned = UserPlace.objects.owned_by(_requester(self.context))
        if self.instance is None and owned.count() >= MAX_PLACES_PER_USER:
            raise serializers.ValidationError(
                f"You can have at most {MAX_PLACES_PER_USER} places.",
                code="too_many_places",
            )
        return attrs


class UserPlacePreviewQuery(serializers.Serializer[None]):
    """A circle being drawn, and the place it edits (left out for a new one)."""

    lat = serializers.FloatField(
        min_value=-90, max_value=90, help_text="Centre, latitude"
    )
    lon = serializers.FloatField(
        min_value=-180, max_value=180, help_text="Centre, longitude"
    )
    radius_m = ClampedIntegerField(
        default=RADIUS_MIN_M,
        lowest=RADIUS_MIN_M,
        highest=RADIUS_MAX_M,
        help_text=f"Radius in metres ({RADIUS_MIN_M} to {RADIUS_MAX_M})",
    )
    exclude = serializers.IntegerField(
        required=False, help_text="The place being edited, left out of the overlaps"
    )


class PreviewOverlapSerializer(serializers.Serializer[None]):
    id = serializers.IntegerField()
    name = serializers.CharField()
    photo_count = serializers.IntegerField(help_text="Photos inside both")
    smaller = serializers.BooleanField(
        help_text="That place is the smaller one, so the photos inside both show it"
    )


class UserPlacePreviewSerializer(serializers.Serializer[None]):
    """What the circle would hold."""

    photo_count = serializers.IntegerField(
        help_text="The visible photos taken inside the circle"
    )
    cover_photos = PhotoHashListSerializer(many=True, help_text="The newest few")
    overlaps = PreviewOverlapSerializer(
        many=True, help_text="Your other places that share some of these photos"
    )


class UserPlacePhotosSerializer(serializers.ModelSerializer):
    """A place's visible photos by day, for its page: prefetched newest first
    with the photo summary relations (the view does it)."""

    grouped_photos = serializers.SerializerMethodField()

    class Meta:
        model = UserPlace
        fields = ("id", "name", "grouped_photos")

    @extend_schema_field(GroupedPhotosSerializer(many=True))
    def get_grouped_photos(self, obj: UserPlace) -> list[dict[str, Any]]:
        photos = filter_photos_by_media_type(
            prefetched(obj, "photos", Photo), self.context.get("request")
        )
        return serializers.ListSerializer(
            child=GroupedPhotosSerializer(), instance=get_photos_ordered_by_date(photos)
        ).data
