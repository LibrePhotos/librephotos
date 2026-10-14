"""Album collections (#1009, #871): a user's own grouping of their albums."""

from collections.abc import Mapping

from django.db.models import QuerySet
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from api.models import AlbumCollection
from api.models.user import User


def _requester(context: Mapping[str, object]) -> User | None:
    """The signed-in user of a serializer's request; ``None`` without one."""
    user = getattr(context.get("request"), "user", None)
    return user if isinstance(user, User) else None


class AlbumCollectionSerializer(serializers.ModelSerializer):
    """One collection: create and rename write ``name``."""

    class Meta:
        model = AlbumCollection
        fields = ("id", "name")
        read_only_fields = ("id",)

    def validate_name(self, value: str) -> str:
        """Trimmed, and free among the owner's collections in any letter case."""
        name = value.strip()
        if not name:
            raise serializers.ValidationError(
                "Collection name may not be empty.", code="blank"
            )
        taken = AlbumCollection.objects.owned_by(_requester(self.context)).filter(
            name__iexact=name
        )
        if self.instance is not None:
            taken = taken.exclude(pk=self.instance.pk)
        if taken.exists():
            raise serializers.ValidationError(
                f"Collection '{name}' already exists.", code="unique"
            )
        return name


# An id; the schema generator cannot find the model of a relation outside a
# ModelSerializer on its own.
@extend_schema_field(OpenApiTypes.INT)
class OwnedAlbumCollectionField(serializers.PrimaryKeyRelatedField):
    """A collection id in a write payload, resolved against the requester's own
    collections: another user's id is rejected like an unknown one."""

    def get_queryset(self) -> QuerySet[AlbumCollection]:
        return AlbumCollection.objects.owned_by(_requester(self.context))


class UserAlbumCollectionsRequest(serializers.Serializer[None]):
    """``PUT /api/albums/user/<id>/collections/``: every collection the album is in."""

    collection_ids = OwnedAlbumCollectionField(
        many=True,
        help_text="The album's collections; any it is in now and that are not "
        "listed lose it",
    )


class UserAlbumCollectionsSerializer(serializers.Serializer[None]):
    """The collections an album is in after the change."""

    collection_ids = serializers.ListField(child=serializers.IntegerField())
