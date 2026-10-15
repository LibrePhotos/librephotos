"""Person groups (#1126): a user's own grouping of their people."""

from collections.abc import Mapping

from django.db.models import Count, QuerySet
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from api.models import PersonGroup
from api.models.user import User
from api.serializers.fields import loaded_count


def _requester(context: Mapping[str, object]) -> User | None:
    """The signed-in user of a serializer's request; ``None`` without one."""
    user = getattr(context.get("request"), "user", None)
    return user if isinstance(user, User) else None


def with_person_group_relations(
    groups: QuerySet[PersonGroup],
) -> QuerySet[PersonGroup]:
    """``groups`` with the ``person_count`` ``PersonGroupSerializer`` reads.

    Only the owner's named people get into a group (``PUT
    /api/persons/<id>/groups/`` goes through the People list's scope), so
    every member counts.
    """
    return groups.annotate(person_count=Count("persons"))


class PersonGroupSerializer(serializers.ModelSerializer):
    """One group: create and rename write ``name``."""

    person_count = serializers.SerializerMethodField(
        help_text="How many people are in the group"
    )

    class Meta:
        model = PersonGroup
        fields = ("id", "name", "person_count")
        read_only_fields = ("id",)

    def get_person_count(self, obj: PersonGroup) -> int:
        return loaded_count(obj, "person_count")

    def validate_name(self, value: str) -> str:
        """Trimmed, and free among the owner's groups in any letter case."""
        name = value.strip()
        if not name:
            raise serializers.ValidationError(
                "Group name may not be empty.", code="blank"
            )
        taken = PersonGroup.objects.owned_by(_requester(self.context)).filter(
            name__iexact=name
        )
        if self.instance is not None:
            taken = taken.exclude(pk=self.instance.pk)
        if taken.exists():
            raise serializers.ValidationError(
                f"Group '{name}' already exists.", code="unique"
            )
        return name


# An id; the schema generator cannot find the model of a relation outside a
# ModelSerializer on its own.
@extend_schema_field(OpenApiTypes.INT)
class OwnedPersonGroupField(serializers.PrimaryKeyRelatedField):
    """A group id in a write payload, resolved against the requester's own
    groups: another user's id is rejected like an unknown one."""

    def get_queryset(self) -> QuerySet[PersonGroup]:
        return PersonGroup.objects.owned_by(_requester(self.context))


class PersonGroupsRequest(serializers.Serializer[None]):
    """``PUT /api/persons/<id>/groups/``: every group the person is in."""

    group_ids = OwnedPersonGroupField(
        many=True,
        help_text="The person's groups; any they are in now and that are not "
        "listed lose them",
    )


class PersonGroupsSerializer(serializers.Serializer[None]):
    """The groups a person is in after the change."""

    group_ids = serializers.ListField(child=serializers.IntegerField())
