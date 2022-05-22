import json

from django.core.cache import cache
from django.db.models import Count, Prefetch, Q
from rest_framework import serializers

from api.image_similarity import search_similar_image
from api.models import (
    AlbumAuto,
    AlbumDate,
    AlbumPlace,
    AlbumThing,
    Face,
    LongRunningJob,
    Person,
    Photo,
)
from api.serializers.photos import PhotoSuperSimpleSerializer
from api.serializers.serializers_serpy import PigPhotoSerilizer
from api.serializers.user import SimpleUserSerializer
from api.util import logger


class PhotoEditSerializer(serializers.ModelSerializer):
    class Meta:
        model = Photo
        fields = (
            "image_hash",
            "hidden",
            "rating",
            "deleted",
            "video",
            "exif_timestamp",
            "timestamp",
        )

    def update(self, instance, validated_data):
        # photo can only update the following
        if "exif_timestamp" in validated_data:
            instance.timestamp = validated_data.pop("exif_timestamp")
            instance.save()
            instance._extract_date_time_from_exif()
        return instance


class PhotoHashListSerializer(serializers.ModelSerializer):
    class Meta:
        model = Photo
        fields = ("image_hash", "video")


class PhotoSimpleSerializer(serializers.ModelSerializer):
    class Meta:
        model = Photo
        fields = (
            "square_thumbnail",
            "image_hash",
            "exif_timestamp",
            "exif_gps_lat",
            "exif_gps_lon",
            "rating",
            "geolocation_json",
            "public",
            "video",
        )


class PhotoSerializer(serializers.ModelSerializer):
    square_thumbnail_url = serializers.SerializerMethodField()
    big_thumbnail_url = serializers.SerializerMethodField()
    small_square_thumbnail_url = serializers.SerializerMethodField()
    similar_photos = serializers.SerializerMethodField()
    captions_json = serializers.SerializerMethodField()
    people = serializers.SerializerMethodField()
    shared_to = serializers.PrimaryKeyRelatedField(many=True, read_only=True)
    image_path = serializers.SerializerMethodField()
    owner = SimpleUserSerializer(many=False, read_only=True)

    class Meta:
        model = Photo
        fields = (
            "exif_gps_lat",
            "exif_gps_lon",
            "exif_timestamp",
            "search_captions",
            "search_location",
            "captions_json",
            "big_thumbnail_url",
            "square_thumbnail_url",
            "small_square_thumbnail_url",
            "geolocation_json",
            "exif_json",
            "people",
            "image_hash",
            "image_path",
            "rating",
            "hidden",
            "public",
            "deleted",
            "shared_to",
            "similar_photos",
            "video",
            "owner",
        )

    def get_similar_photos(self, obj):
        res = search_similar_image(obj.owner, obj, threshold=90)
        arr = []
        if len(res) > 0:
            [arr.append(e) for e in res["result"]]
            photos = Photo.objects.filter(image_hash__in=arr).all()
            res = []
            for photo in photos:
                type = "image"
                if photo.video:
                    type = "video"
                res.append({"image_hash": photo.image_hash, "type": type})
            return res
        else:
            return []

    def get_captions_json(self, obj):
        if obj.captions_json and len(obj.captions_json) > 0:
            return obj.captions_json
        else:
            emptyArray = {
                "im2txt": "",
                "places365": {"attributes": [], "categories": [], "environment": []},
            }
            return emptyArray

    def get_image_path(self, obj):
        try:
            return obj.image_paths[0]
        except Exception:
            return "Missing"

    def get_square_thumbnail_url(self, obj):
        try:
            return obj.square_thumbnail.url
        except Exception:
            return None

    def get_small_square_thumbnail_url(self, obj):
        try:
            return obj.square_thumbnail_small.url
        except Exception:
            return None

    def get_big_thumbnail_url(self, obj):
        try:
            return obj.thumbnail_big.url
        except Exception:
            return None

    def get_geolocation(self, obj):
        if obj.geolocation_json:
            return json.loads(obj.geolocation_json)
        else:
            return None

    def get_people(self, obj):
        return [
            {"name": f.person.name, "face_url": f.image.url, "face_id": f.id}
            for f in obj.faces.all()
        ]


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
            return None

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
            cache.clear()
            return new_person

    def update(self, instance, validated_data):
        if "newPersonName" in validated_data.keys():
            new_name = validated_data.pop("newPersonName")
            instance.name = new_name
            instance.save()
            cache.clear()
            return instance
        if "cover_photo" in validated_data.keys():
            image_hash = validated_data.pop("cover_photo")
            photo = Photo.objects.filter(image_hash=image_hash).first()
            instance.cover_photo = photo
            instance.save()
            cache.clear()
            return instance
        return instance

    def delete(self, validated_data, id):
        person = Person.objects.filter(id=id).get()
        person.delete()


class FaceListSerializer(serializers.ModelSerializer):
    person_name = serializers.SerializerMethodField()
    face_url = serializers.SerializerMethodField()

    class Meta:
        model = Face
        fields = (
            "id",
            "image",
            "face_url",
            "photo",
            "person",
            "person_label_probability",
            "person_name",
        )

    def get_face_url(self, obj):
        return obj.image.url

    def get_person_name(self, obj):
        return obj.person.name


class FaceSerializer(serializers.ModelSerializer):
    face_url = serializers.SerializerMethodField()
    person = PersonSerializer(many=False)

    class Meta:
        model = Face
        fields = (
            "id",
            "face_url",
            "photo_id",
            "person",
            "person_id",
            "person_label_is_inferred",
        )

    def get_face_url(self, obj):
        return obj.image.url

    def update(self, instance, validated_data):
        name = validated_data.pop("person")["name"]
        p = Person.objects.filter(name=name)
        if p.count() > 0:
            instance.person = p[0]
        else:
            p = Person()
            p.name = name
            p.save()
            instance.person = p
            logger.info("created person with name %s" % name)
        if instance.person.name == "unknown":
            instance.person_label_is_inferred = None
            instance.person_label_probability = 0.0
        else:
            instance.person_label_is_inferred = False
            instance.person_label_probability = 1.0
        logger.info(
            "updated label for face %d to %s" % (instance.id, instance.person.name)
        )
        cache.clear()
        instance.save()
        return instance


class AlbumPlaceSerializer(serializers.ModelSerializer):
    photos = PhotoSuperSimpleSerializer(many=True, read_only=True)

    class Meta:
        model = AlbumPlace
        fields = ("id", "title", "photos")


class AlbumPlaceListSerializer(serializers.ModelSerializer):
    cover_photos = PhotoHashListSerializer(many=True, read_only=True)
    photo_count = serializers.SerializerMethodField()

    class Meta:
        model = AlbumPlace
        fields = ("id", "geolocation_level", "cover_photos", "title", "photo_count")

    def get_photo_count(self, obj):
        return obj.photo_count


class AlbumThingSerializer(serializers.ModelSerializer):
    photos = PhotoSuperSimpleSerializer(many=True, read_only=True)

    class Meta:
        model = AlbumThing
        fields = ("id", "title", "photos")


class AlbumThingListSerializer(serializers.ModelSerializer):
    cover_photos = PhotoHashListSerializer(many=True, read_only=True)
    photo_count = serializers.SerializerMethodField()

    class Meta:
        model = AlbumThing
        fields = ("id", "cover_photos", "title", "photo_count")

    def get_photo_count(self, obj):
        return obj.photo_count


class AlbumDateSerializer(serializers.ModelSerializer):
    photos = PhotoSerializer(many=True, read_only=True)

    class Meta:
        model = AlbumDate
        fields = ("id", "title", "date", "favorited", "photos")


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


class AlbumAutoSerializer(serializers.ModelSerializer):
    photos = PhotoSimpleSerializer(many=True, read_only=False)
    people = serializers.SerializerMethodField()

    class Meta:
        model = AlbumAuto
        fields = (
            "id",
            "title",
            "favorited",
            "timestamp",
            "created_on",
            "gps_lat",
            "people",
            "gps_lon",
            "photos",
        )

    def get_people(self, obj):
        photos = obj.photos.all().prefetch_related(
            Prefetch(
                "faces__person",
                queryset=Person.objects.all().annotate(
                    viewable_face_count=Count("faces")
                ),
            )
        )

        res = []
        for photo in photos:
            faces = photo.faces.all()
            for face in faces:
                serialized_person = PersonSerializer(face.person).data
                if serialized_person not in res:
                    res.append(serialized_person)
        return res


class AlbumAutoListSerializer(serializers.ModelSerializer):
    photos = serializers.SerializerMethodField()
    photo_count = serializers.SerializerMethodField()

    class Meta:
        model = AlbumAuto
        fields = (
            "id",
            "title",
            "timestamp",
            "photos",
            "photo_count",
            "favorited",
        )

    def get_photo_count(self, obj):
        try:
            return obj.photo_count
        except Exception:
            return obj.photos.count()

    def get_photos(self, obj):
        try:
            return PhotoHashListSerializer(obj.photos.first()).data
        except Exception:
            return ""


class LongRunningJobSerializer(serializers.ModelSerializer):
    job_type_str = serializers.SerializerMethodField()
    started_by = SimpleUserSerializer(read_only=True)

    class Meta:
        model = LongRunningJob
        fields = (
            "job_id",
            "queued_at",
            "finished",
            "finished_at",
            "started_at",
            "failed",
            "job_type_str",
            "job_type",
            "started_by",
            "result",
            "id",
        )

    def get_job_type_str(self, obj):
        return dict(LongRunningJob.JOB_TYPES)[obj.job_type]


class SharedFromMePhotoThroughSerializer(serializers.ModelSerializer):
    photo = serializers.SerializerMethodField()
    user = SimpleUserSerializer(many=False, read_only=True)

    class Meta:
        model = Photo.shared_to.through
        fields = ("user_id", "user", "photo")

    def get_photo(self, obj):
        return PigPhotoSerilizer(obj.photo).data
