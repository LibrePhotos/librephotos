"""Library shares (#2731): a user's whole library, read-only, for another user."""

from django.db.models import Count, IntegerField, OuterRef, QuerySet, Subquery
from django.db.models.functions import Coalesce
from rest_framework import serializers

from api.models import LibraryShare, Photo
from api.models.photo import visible_photo_q
from api.serializers.fields import loaded_count
from api.serializers.simple import SimpleUserSerializer

# The switches only the owner sets, and the one only the recipient sets.
OWNER_FIELDS = (
    "share_location",
    "share_faces",
    "share_camera_info",
    "share_captions",
    "share_originals",
)
RECIPIENT_FIELDS = ("show_in_timeline",)


def with_library_share_relations(
    queryset: QuerySet[LibraryShare],
) -> QuerySet[LibraryShare]:
    """Everything ``LibraryShareSerializer`` reads, in the list's one query.

    ``photo_count`` is what the recipient sees: the owner's photos and videos
    their library lists, never the hidden, trashed or removed ones.
    """
    photos = (
        Photo.objects.filter(
            visible_photo_q(),
            owner=OuterRef("owner"),  # owner-scope: the share owner's photos
        )
        .order_by()
        .values("owner")
        .annotate(total=Count("pk"))
        .values("total")
    )
    return queryset.select_related("owner", "recipient").annotate(
        photo_count=Coalesce(Subquery(photos, output_field=IntegerField()), 0)
    )


class LibraryShareSerializer(serializers.ModelSerializer):
    owner = SimpleUserSerializer(read_only=True)
    recipient = SimpleUserSerializer(read_only=True)
    # The photos and videos the share holds (the owner's visible library).
    photo_count = serializers.SerializerMethodField()

    class Meta:
        model = LibraryShare
        fields = (
            "id",
            "owner",
            "recipient",
            "show_in_timeline",
            *OWNER_FIELDS,
            "created_at",
            "photo_count",
        )
        read_only_fields = fields

    def get_photo_count(self, obj: LibraryShare) -> int:
        return loaded_count(obj, "photo_count")


class CreateLibraryShareRequest(serializers.Serializer[None]):
    """Share the requester's library with ``recipient_id``; every switch off
    unless sent."""

    recipient_id = serializers.IntegerField()
    share_location = serializers.BooleanField(default=False)
    share_faces = serializers.BooleanField(default=False)
    share_camera_info = serializers.BooleanField(default=False)
    share_captions = serializers.BooleanField(default=False)
    share_originals = serializers.BooleanField(default=False)


class UpdateLibraryShareRequest(serializers.Serializer[None]):
    """The owner changes what the recipient sees; the recipient changes
    ``show_in_timeline``. A switch of the other side is a 400."""

    show_in_timeline = serializers.BooleanField(required=False)
    share_location = serializers.BooleanField(required=False)
    share_faces = serializers.BooleanField(required=False)
    share_camera_info = serializers.BooleanField(required=False)
    share_captions = serializers.BooleanField(required=False)
    share_originals = serializers.BooleanField(required=False)
