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

    def get_face_url(self, obj) -> str:
        if obj.cover_face:
            return "/media/" + obj.cover_face.image.name
        if obj.faces.count() == 0:
            return ""
        return "/media/" + obj.faces.first().image.name

    def get_face_photo_url(self, obj) -> str:
        if obj.cover_photo:
            return obj.cover_photo.image_hash
        if obj.faces.count() == 0:
            return ""
        return obj.faces.first().photo.image_hash

    def get_video(self, obj) -> str:
        if obj.cover_photo:
            return obj.cover_photo.video
        if obj.faces.count() == 0:
            return "False"
        return obj.faces.first().photo.video

    def create(self, validated_data):
        name = validated_data.pop("name")
        if len(name.strip()) == 0:
            raise serializers.ValidationError("Name cannot be empty")
        qs = Person.objects.filter(name=name)
        if qs.count() > 0:
            return qs[0]
        else:
            new_person = Person()
            new_person.name = name
            new_person.save()
            logger.info("created person {}" % new_person.id)
            return new_person

    def update(self, instance, validated_data):
        if "newPersonName" in validated_data.keys():
            new_name = validated_data.pop("newPersonName")
            instance.name = new_name
            instance.save()
            return instance
        if "cover_photo" in validated_data.keys():
            image_hash = validated_data.pop("cover_photo")
            photo = Photo.objects.filter(image_hash=image_hash).first()
            instance.cover_photo = photo
            instance.cover_face = photo.faces.filter(person__name=instance.name).first()
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
            return first_face.photo.square_thumbnail.url
        else:
            return None

    def get_face_photo_url(self, obj) -> str:
        first_face = obj.faces.filter(Q(person__is_null=False)).first()
        if first_face:
            return first_face.photo.image.url
        else:
            return None
