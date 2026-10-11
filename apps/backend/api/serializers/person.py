import logging
from collections.abc import Callable
from typing import Any, TypeVar

from django.core.exceptions import ValidationError as DjangoValidationError
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from api.models import Face, Person, Photo, User
from api.request_user import request_user
from api.serializers.photos import GroupedPhotosSerializer
from api.serializers.PhotosGroupedByDate import get_photos_ordered_by_date

logger = logging.getLogger(__name__)

_T = TypeVar("_T")


class GroupedPersonPhotosSerializer(serializers.ModelSerializer):
    id = serializers.SerializerMethodField()
    grouped_photos = serializers.SerializerMethodField()

    class Meta:
        model = Person
        fields = (
            "id",
            "name",
            "grouped_photos",
        )

    def get_id(self, obj: Person) -> str:
        return str(obj.id)

    @extend_schema_field(GroupedPhotosSerializer(many=True))
    def get_grouped_photos(self, obj: Person) -> list[dict[str, Any]]:
        # AlbumPersonViewSet runs behind IsAuthenticated.
        user = request_user(self.context["request"])
        grouped_photos = get_photos_ordered_by_date(obj.get_photos(user))
        # ``.data`` of a many=True serializer is a ReturnList; build it through
        # ListSerializer so the static type matches the runtime value.
        res = serializers.ListSerializer(
            child=GroupedPhotosSerializer(), instance=grouped_photos
        ).data
        return res


# Sentinel telling ``PersonSerializer`` that the queryset did not carry the
# first-face annotations, so it has to look the face up itself.
_UNANNOTATED = object()


class PersonSerializer(serializers.ModelSerializer):
    face_url = serializers.SerializerMethodField()
    face_photo_url = serializers.SerializerMethodField()
    video = serializers.SerializerMethodField()
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

    def _requester(self) -> User:
        # PersonViewSet runs behind IsAuthenticated, so the request has a user.
        return request_user(self.context["request"])

    def create(self, validated_data: dict[str, Any]) -> Person:
        name = validated_data.pop("name")
        if len(name.strip()) == 0:
            raise serializers.ValidationError("Name cannot be empty")
        owner = self._requester()
        qs = Person.objects.filter(name=name, cluster_owner=owner)
        if qs.exists():
            return qs[0]
        else:
            new_person = Person()
            new_person.name = name
            new_person.cluster_owner = owner
            new_person.kind = Person.KIND_USER
            new_person.save()
            logger.info(f"created person {new_person.id}")
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
                except (ValueError, TypeError, DjangoValidationError):
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
