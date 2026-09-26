from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import Q
from rest_framework import serializers

from api.models import Person, Photo
from api.serializers.photos import GroupedPhotosSerializer
from api.serializers.PhotosGroupedByDate import get_photos_ordered_by_date
from api.util import logger


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

    def get_id(self, obj) -> str:
        return str(obj.id)

    def get_grouped_photos(self, obj) -> GroupedPhotosSerializer(many=True):
        user = None
        request = self.context.get("request")
        if request and hasattr(request, "user"):
            user = request.user
        grouped_photos = get_photos_ordered_by_date(obj.get_photos(user))
        res = GroupedPhotosSerializer(grouped_photos, many=True).data
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

    def _first_face_value(self, obj, annotation, resolve):
        """Value taken from the person's first face, without a query per person.

        ``PersonViewSet`` annotates the values this serializer needs off the
        first face, because otherwise every person costs an ``exists()``, a
        ``first()`` and a photo fetch: eight extra round trips each, which is
        what made the people page take seconds to show its first cover
        (issue #618). Serializers instantiated on a plain (unannotated) person
        still work, they just pay for the lookup.
        """
        value = getattr(obj, annotation, _UNANNOTATED)
        if value is not _UNANNOTATED:
            return value
        face = obj.faces.first()
        return resolve(face) if face else None

    def get_face_url(self, obj) -> str:
        if obj.cover_face:
            return "/media/" + obj.cover_face.image.name
        image = self._first_face_value(
            obj, "first_face_image", lambda face: face.image.name
        )
        return "/media/" + image if image else ""

    def get_face_photo_url(self, obj) -> str:
        if obj.cover_photo:
            return obj.cover_photo.image_hash
        image_hash = self._first_face_value(
            obj,
            "first_face_photo_hash",
            lambda face: face.photo.image_hash if face.photo else None,
        )
        return image_hash or ""

    def get_video(self, obj) -> str:
        if obj.cover_photo:
            return obj.cover_photo.video
        video = self._first_face_value(
            obj,
            "first_face_photo_video",
            lambda face: face.photo.video if face.photo else None,
        )
        return "False" if video is None else video

    def _requester(self):
        return getattr(self.context.get("request"), "user", None)

    def create(self, validated_data):
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

    def update(self, instance, validated_data):
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

    def delete(self, validated_data, id):
        person = Person.objects.filter(id=id).get()
        person.delete()


class AlbumPersonListSerializer(serializers.ModelSerializer):
    photo_count = serializers.SerializerMethodField()
    cover_photo_url = serializers.SerializerMethodField()

    class Meta:
        model = Person
        fields = (
            "name",
            "photo_count",
            "cover_photo_url",
            "id",
        )

    def get_photo_count(self, obj) -> int:
        return obj.filter(Q(person__is_null=False)).faces.count()

    def get_cover_photo_url(self, obj) -> str:
        first_face = obj.faces.filter(Q(person__is_null=False)).first()
        if first_face:
            return first_face.photo.thumbnail.square_thumbnail.url
        else:
            return None

    def get_face_photo_url(self, obj) -> str:
        first_face = obj.faces.filter(Q(person__is_null=False)).first()
        if first_face:
            return first_face.photo.image.url
        else:
            return None
