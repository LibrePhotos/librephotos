import logging
from collections.abc import Callable
from typing import Any, TypeVar

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import OuterRef, Prefetch, QuerySet
from rest_framework import serializers

from api.drf.request_user import request_user
from api.models import Face, Person, PersonGroup, Photo, User
from api.serializers.fields import loaded_list

logger = logging.getLogger(__name__)

_T = TypeVar("_T")


# Sentinel telling ``PersonSerializer`` that the queryset did not carry the
# first-face annotations, so it has to look the face up itself.
_UNANNOTATED = object()


def first_face_of_person(user: User) -> QuerySet[Face]:
    """The face a person without a chosen cover falls back to, for a Subquery.

    Correlated on ``OuterRef("pk")`` of a Person queryset. The People list and
    the mobile person feed both annotate from it, so the cover a phone mirrors
    is the one the web shows. Scoped to the requester's own photos, following
    the owned_by / visible_to convention (#2031): ``cluster_owner`` scopes the
    person, not its faces, so without this a face attached from another user's
    photo would put that photo's image hash in this user's people (#2047).
    """
    return (
        Face.objects.owned_by(user)
        .filter(person=OuterRef("pk"), deleted=False)
        .order_by("id")
    )


def person_groups_prefetch(through: str = "") -> Prefetch:
    """The group ids ``PersonSerializer.group_ids`` reads (#1126), one query
    for a whole list. ``through`` is the path from the queried model to the
    person, e.g. ``photos__faces__person__`` on an event album."""
    return Prefetch(
        f"{through}groups",
        queryset=PersonGroup.objects.only("id").order_by("pk"),
        to_attr="loaded_groups",
    )


class PersonListQuery(serializers.Serializer[None]):
    """People: all of them, or the ones in one group (#1126)."""

    group = serializers.IntegerField(
        required=False,
        min_value=1,
        help_text="Only the people in this group of yours",
    )


class PersonSerializer(serializers.ModelSerializer):
    face_url = serializers.SerializerMethodField()
    face_photo_url = serializers.SerializerMethodField()
    video = serializers.SerializerMethodField()
    group_ids = serializers.SerializerMethodField(
        help_text="The ids of the owner's groups the person is in"
    )
    newPersonName = serializers.CharField(max_length=100, default="", write_only=True)
    cover_photo = serializers.CharField(max_length=100, default="", write_only=True)

    class Meta:
        model = Person
        fields = (
            "name",
            "face_url",
            "face_count",
            "face_photo_url",
            "video",
            "id",
            "newPersonName",
            "cover_photo",
            "group_ids",
        )

    def _first_face_value(
        self,
        obj: Person,
        annotation: str,
        resolve: Callable[[Face], _T],
    ) -> _T | None:
        """Value taken from the person's first face, without a query per person.

        ``PersonViewSet`` annotates the values this serializer needs off the
        first face, because otherwise every person costs an ``exists()``, a
        ``first()`` and a photo fetch: eight extra round trips each, which is
        what made the people page take seconds to show its first cover
        (issue #618). Serializers instantiated on a plain (unannotated) person
        still work, they just pay for the lookup.
        """
        value: Any = getattr(obj, annotation, _UNANNOTATED)
        if value is not _UNANNOTATED:
            return value
        face = obj.faces.first()
        return resolve(face) if face else None

    def get_face_url(self, obj: Person) -> str:
        if obj.cover_face:
            name = obj.cover_face.image.name
            # A face with a cover always has its image stored.
            assert name is not None
            return "/media/" + name
        image = self._first_face_value(
            obj, "first_face_image", lambda face: face.image.name
        )
        return "/media/" + image if image else ""

    def get_face_photo_url(self, obj: Person) -> str:
        if obj.cover_photo:
            return obj.cover_photo.image_hash
        image_hash = self._first_face_value(
            obj,
            "first_face_photo_hash",
            lambda face: face.photo.image_hash if face.photo else None,
        )
        return image_hash or ""

    def get_video(self, obj: Person) -> bool:
        if obj.cover_photo:
            return bool(obj.cover_photo.video)
        video = self._first_face_value(
            obj,
            "first_face_photo_video",
            lambda face: face.photo.video if face.photo else None,
        )
        # A boolean, never the string "False": the frontend parses the list
        # strictly, so one person without faces would empty it (#2151).
        return bool(video)

    def get_group_ids(self, obj: Person) -> list[int]:
        """The person's group ids, from ``person_groups_prefetch`` when the
        queryset has it (the People list, an event's people). Like the cover
        fields, a person serialized on its own still works: it pays one query.
        Only the owner can put a person in a group, and only in their own.
        """
        if hasattr(obj, "loaded_groups"):
            groups = loaded_list(obj, "loaded_groups", PersonGroup)
            return [group.pk for group in groups]
        return list(obj.groups.order_by("pk").values_list("pk", flat=True))

    def _requester(self) -> User:
        # PersonViewSet runs behind IsAuthenticated, so the request has a user.
        return request_user(self.context["request"])

    def create(self, validated_data: dict[str, Any]) -> Person:
        name = validated_data.pop("name")
        if len(name.strip()) == 0:
            raise serializers.ValidationError("Name cannot be empty")
        owner = self._requester()
        qs = Person.objects.owned_by(owner).filter(name=name)
        if qs.exists():
            return qs[0]
        else:
            new_person = Person()
            new_person.name = name
            new_person.cluster_owner = owner
            new_person.kind = Person.KIND_USER
            new_person.save()
            logger.info("created person %s", new_person.id)
            return new_person

    def update(self, instance: Person, validated_data: dict[str, Any]) -> Person:
        if "newPersonName" in validated_data.keys():
            new_name = validated_data.pop("newPersonName")
            instance.name = new_name
            instance.save()
            return instance
        if "cover_photo" in validated_data.keys():
            photo_ref = validated_data.pop("cover_photo")

            # Backward compatibility:
            # older frontend paths send image_hash, newer paths send Photo UUID.
            own_photos = Photo.objects.owned_by(self._requester())
            photo = own_photos.filter(image_hash=photo_ref).first()

            if photo is None:
                try:
                    photo = own_photos.filter(pk=photo_ref).first()
                except ValueError, TypeError, DjangoValidationError:
                    photo = None

            if photo is None:
                raise serializers.ValidationError(
                    {"cover_photo": f"Photo not found: {photo_ref}"}
                )

            instance.cover_photo = photo
            instance.cover_face = photo.faces.filter(person=instance).first()
            instance.save()
            return instance
        return instance

    def delete(self, validated_data: dict[str, Any], id: int) -> None:
        person = Person.objects.filter(id=id).get()
        person.delete()


# A person page selection is explicit (its "Select all" is not offered for
# this action), so a cap far above a manual selection only bounds the IN list.
MAX_REMOVE_PHOTOS = 10000


class PersonRemovePhotosRequest(serializers.Serializer[None]):
    photo_ids = serializers.ListField(
        child=serializers.UUIDField(),
        allow_empty=False,
        max_length=MAX_REMOVE_PHOTOS,
        help_text="Ids of the photos to take this person off",
    )


class PersonRemovePhotosResponseSerializer(serializers.Serializer[None]):
    removed = serializers.IntegerField(
        help_text="How many of the person's faces went back to unknown"
    )
    photo_count = serializers.IntegerField(
        help_text="How many photos no longer show this person"
    )
    write_error = serializers.CharField(
        allow_null=True,
        help_text="Why some face tags were not written to their files, or null",
    )


class PersonMergeRequest(serializers.Serializer[None]):
    person = serializers.IntegerField(
        error_messages={
            "required": "No person provided",
            "null": "No person provided",
        },
        help_text="The person to merge into this one; it is deleted",
    )


class PersonMergeResponseSerializer(serializers.Serializer[None]):
    moved = serializers.IntegerField(
        help_text="How many faces moved from the merged person to this one"
    )
    photo_count = serializers.IntegerField(
        help_text="How many photos now show this person instead"
    )
    write_queued = serializers.BooleanField(
        help_text=(
            "Whether the face tags of those photos are being written to their "
            "files in the background (the owner's face tag setting)"
        )
    )
