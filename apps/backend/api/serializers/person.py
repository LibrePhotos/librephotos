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
            "title",
            "grouped_photos",
        )

    def get_id(self, obj):
        return str(obj.id)

    def get_grouped_photos(self, obj):
        user = None
        request = self.context.get("request")
        if request and hasattr(request, "user"):
            user = request.user
        grouped_photos = get_photos_ordered_by_date(obj.get_photos(user))
        res = GroupedPhotosSerializer(grouped_photos, many=True).data
        return res


class PersonSerializer(serializers.ModelSerializer):
    face_url = serializers.SerializerMethodField()
    face_count = serializers.SerializerMethodField()
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

    def get_face_count(self, obj):
        return obj.viewable_face_count

    def get_face_url(self, obj):
        try:
            face = obj.faces.filter(
                Q(person_label_is_inferred=False) & Q(photo__hidden=False)
            ).first()
            return face.image.url
        except Exception:
            return None

    def get_face_photo_url(self, obj):
        if obj.cover_photo:
            return obj.cover_photo.image_hash
        first_face = obj.faces.filter(
            Q(person_label_is_inferred=False) & Q(photo__hidden=False)
        ).first()
        if first_face:
            return first_face.photo.image_hash
        else:
            return None

    def get_video(self, obj):
        if obj.cover_photo:
            return obj.cover_photo.video
        first_face = obj.faces.filter(
            Q(person_label_is_inferred=False) & Q(photo__hidden=False)
        ).first()
        if first_face:
            return first_face.photo.video
        else:
            return False

    def create(self, validated_data):
        name = validated_data.pop("name")
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

    def get_photo_count(self, obj):
        return obj.filter(Q(person_label_is_inferred=False)).faces.count()

    def get_cover_photo_url(self, obj):
        first_face = obj.faces.filter(Q(person_label_is_inferred=False)).first()
        if first_face:
            return first_face.photo.square_thumbnail.url
        else:
            return None

    def get_face_photo_url(self, obj):
        first_face = obj.faces.filter(Q(person_label_is_inferred=False)).first()
        if first_face:
            return first_face.photo.image.url
        else:
            return None
