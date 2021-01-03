from api.models import Photo, AlbumAuto, AlbumUser, AlbumPlace, Face, Person, AlbumDate, AlbumThing, LongRunningJob, User
from rest_framework import serializers
import ipdb
import json
import time
from api.util import logger
from datetime import datetime
from django.contrib.auth import get_user_model
from django.db.models import Count
from django.db.models import Q
from django.db.models import Prefetch
import os
from api.image_similarity import search_similar_image


class SimpleUserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = (
            'id',
            'username',
            'first_name',
            'last_name',
        )


class PhotoEditSerializer(serializers.ModelSerializer):
    class Meta:
        model = Photo
        fields = ('image_hash', 'hidden', 'favorited')

    def update(self, instance, validated_data):
        ipdb.set_trace()


class PhotoHashListSerializer(serializers.ModelSerializer):
    class Meta:
        model = Photo
        fields = ('image_hash', )


class PhotoSuperSimpleSerializer(serializers.ModelSerializer):
    class Meta:
        model = Photo
        fields = (
            'image_hash',
            'favorited',
            'hidden',
            'exif_timestamp',
            'public',
        )


class PhotoSuperSimpleSerializerWithAddedOn(serializers.ModelSerializer):
    class Meta:
        model = Photo
        fields = ('image_hash', 'favorited', 'hidden', 'exif_timestamp',
                  'public', 'added_on')


class PhotoSimpleSerializer(serializers.ModelSerializer):
    class Meta:
        model = Photo
        fields = (
            'thumbnail',
            'square_thumbnail',
            'image',
            'image_hash',
            'exif_timestamp',
            'exif_gps_lat',
            'exif_gps_lon',
            'favorited',
            'geolocation_json',
            'public',
        )


class PhotoSerializer(serializers.ModelSerializer):
    thumbnail_url = serializers.SerializerMethodField()
    thumbnail_height = serializers.SerializerMethodField()
    thumbnail_width = serializers.SerializerMethodField()
    square_thumbnail_url = serializers.SerializerMethodField()
    small_thumbnail_url = serializers.SerializerMethodField()
    big_thumbnail_url = serializers.SerializerMethodField()
    big_square_thumbnail_url = serializers.SerializerMethodField()
    small_square_thumbnail_url = serializers.SerializerMethodField()
    tiny_square_thumbnail_url = serializers.SerializerMethodField()
    similar_photos = serializers.SerializerMethodField()

    image_url = serializers.SerializerMethodField()
    people = serializers.SerializerMethodField()
    shared_to = serializers.PrimaryKeyRelatedField(many=True, read_only=True)

    class Meta:
        model = Photo
        fields = ('exif_gps_lat', 'exif_gps_lon', 'exif_timestamp',
                  'search_captions', 'search_location', 'captions_json',
                  'thumbnail_url', 'thumbnail_height', 'thumbnail_width',
                  'small_thumbnail_url', 'big_thumbnail_url',
                  'square_thumbnail_url', 'big_square_thumbnail_url',
                  'small_square_thumbnail_url', 'tiny_square_thumbnail_url',
                  'geolocation_json', 'exif_json', 'people', 'image_url',
                  'image_hash', 'image_path', 'favorited', 'hidden', 'public',
                  'shared_to', 'similar_photos')

    def get_similar_photos(self, obj):
        res = search_similar_image(obj.owner,obj)
        return [ {'image_hash':e} for e in res['result']]

    def get_thumbnail_url(self, obj):
        try:
            return obj.thumbnail.url
        except:
            return None

    def get_thumbnail_height(self, obj):
        try:
            return obj.thumbnail.height
        except:
            return None

    def get_thumbnail_width(self, obj):
        try:
            return obj.thumbnail.width
        except:
            return None

    def get_square_thumbnail_url(self, obj):
        try:
            return obj.square_thumbnail.url
        except:
            return None

    def get_small_thumbnail_url(self, obj):
        try:
            return obj.thumbnail_small.url
        except:
            return None

    def get_big_square_thumbnail_url(self, obj):
        try:
            return obj.square_thumbnail_big.url
        except:
            return None

    def get_small_square_thumbnail_url(self, obj):
        try:
            return obj.square_thumbnail_small.url
        except:
            return None

    def get_tiny_square_thumbnail_url(self, obj):
        try:
            return obj.square_thumbnail_tiny.url
        except:
            return None

    def get_big_thumbnail_url(self, obj):
        try:
            return obj.thumbnail_big.url
        except:
            return None

    def get_image_url(self, obj):
        try:
            return obj.image.url
        except:
            return None

    def get_geolocation(self, obj):
        if obj.geolocation_json:
            return json.loads(obj.geolocation_json)
        else:
            return None

    def get_people(self, obj):
        return [f.person.name for f in obj.faces.all()]


class PersonSerializer(serializers.ModelSerializer):
    face_url = serializers.SerializerMethodField()
    face_count = serializers.SerializerMethodField()
    face_photo_url = serializers.SerializerMethodField()

    class Meta:
        model = Person
        fields = (
            'name',
            'face_url',
            'face_count',
            'face_photo_url',
            'id',
        )

    def get_face_count(self, obj):
        return obj.viewable_face_count

    def get_face_url(self, obj):
        try:
            face = obj.faces.first()
            return face.image.url
        except:
            return None

    def get_face_photo_url(self, obj):
        try:
            face = obj.faces.first()
            return face.photo.square_thumbnail.url
        except:
            return None

    def create(self, validated_data):
        name = validated_data.pop('name')
        qs = Person.objects.filter(name=name)
        if qs.count() > 0:
            return qs[0]
        else:
            new_person = Person()
            new_person.name = name
            new_person.save()
            logger.info('created person {}' % new_person.id)
            return new_person


class FaceListSerializer(serializers.ModelSerializer):
    person_name = serializers.SerializerMethodField()

    class Meta:
        model = Face
        fields = ('id', 'image', 'photo', 'person', 'person_label_probability',
                  'person_name')

    def get_person_name(self, obj):
        return obj.person.name


class FaceSerializer(serializers.ModelSerializer):
    face_url = serializers.SerializerMethodField()
    person = PersonSerializer(many=False)

    class Meta:
        model = Face
        fields = ('id', 'face_url', 'photo_id', 'person', 'person_id',
                  'person_label_is_inferred')

    def get_face_url(self, obj):
        return obj.image.url

    def update(self, instance, validated_data):
        name = validated_data.pop('person')['name']
        p = Person.objects.filter(name=name)
        if p.count() > 0:
            instance.person = p[0]
        else:
            p = Person()
            p.name = name
            p.save()
            instance.person = p
            logger.info('created person with name %s' % name)
        if instance.person.name == 'unknown':
            instance.person_label_is_inferred = None
            instance.person_label_probability = 0.
        else:
            instance.person_label_is_inferred = False
            instance.person_label_probability = 1.
        logger.info('updated label for face %d to %s' % (instance.id,
                                                         instance.person.name))
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
        fields = (
            "id",
            "geolocation_level",
            "cover_photos",
            "title",
            "photo_count")

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
        fields = (
            "id",
            "cover_photos",
            "title",
            "photo_count")

    def get_photo_count(self, obj):
        return obj.photo_count

class AlbumDateSerializer(serializers.ModelSerializer):
    photos = PhotoSerializer(many=True, read_only=True)

    class Meta:
        model = AlbumDate
        fields = ("id", "title", "date", "favorited", "photos")


class AlbumDateListSerializer(serializers.ModelSerializer):
    people = serializers.SerializerMethodField()
    cover_photo_url = serializers.SerializerMethodField()
    photo_count = serializers.SerializerMethodField()

    class Meta:
        model = AlbumDate
        fields = (
            "id",
            "people",
            "cover_photo_url",
            "title",
            "favorited",
            "photo_count",
            "date")

    def get_photo_count(self, obj):
        return obj.photos.count()

    def get_cover_photo_url(self, obj):
        first_photo = obj.photos.first()
        return first_photo.square_thumbnail.url

    def get_people(self, obj):
        photos = obj.photos.all()
        res = []
        for photo in photos:
            faces = photo.faces.all()
            for face in faces:
                serialized_person = PersonSerializer(face.person).data
                if serialized_person not in res:
                    res.append(serialized_person)
        return res


class AlbumDateListWithPhotoHashSerializer(serializers.ModelSerializer):
    photos = PhotoSuperSimpleSerializer(many=True, read_only=True)
    class Meta:
        model = AlbumDate
        fields = ("location", "id", "photos", "date")


class AlbumPersonSerializer(serializers.ModelSerializer):
    photos = serializers.SerializerMethodField()
    class Meta:
        model = Person
        fields = (
            'name',
            'photos',
            'id',
        )
    def get_photos(self, obj):
        start = datetime.now()

        user = None
        request = self.context.get("request")
        if request and hasattr(request, "user"):
            user = request.user

        res = PhotoSuperSimpleSerializer(obj.get_photos(user), many=True).data

        elapsed = (datetime.now() - start).total_seconds()
        logger.info('serializing photos of faces took %.2f seconds' % elapsed)
        return res

class AlbumPersonListSerializer(serializers.ModelSerializer):
    photo_count = serializers.SerializerMethodField()
    cover_photo_url = serializers.SerializerMethodField()

    class Meta:
        model = Person
        fields = (
            'name',
            "photo_count",
            "cover_photo_url",
            'id',
        )

    def get_photo_count(self, obj):
        return obj.faces.count()

    def get_cover_photo_url(self, obj):
        first_face = obj.faces.first()
        if first_face:
            return first_face.photo.square_thumbnail.url
        else:
            return None

    def get_face_photo_url(self, obj):
        first_face = obj.faces.first()
        if first_face:
            return first_face.image.url
        else:
            return None


class AlbumUserEditSerializer(serializers.ModelSerializer):
    photos = serializers.PrimaryKeyRelatedField(
        many=True, read_only=False, queryset=Photo.objects.all())

    class Meta:
        model = AlbumUser
        fields = ("id", "title", "photos", "created_on", "favorited")

    def validate_photos(self, value):
        return [v.image_hash for v in value]

    def create(self, validated_data):
        title = validated_data['title']
        image_hashes = validated_data['photos']

        user = None
        request = self.context.get("request")
        if request and hasattr(request, "user"):
            user = request.user

        # check if an album exists with the given title and call the update method if it does
        instance, created = AlbumUser.objects.get_or_create(
            title=title, owner=user)
        if not created:
            return self.update(instance, validated_data)

        photos = Photo.objects.in_bulk(image_hashes)
        for pk, obj in photos.items():
            instance.photos.add(obj)
            if instance.cover_photos.count() < 4:
                instance.cover_photos.add(obj)
        instance.save()
        logger.info(u'Created user album {} with {} photos'.format(
            instance.id, len(photos)))
        return instance

    def update(self, instance, validated_data):
        image_hashes = validated_data['photos']

        photos = Photo.objects.in_bulk(image_hashes)
        photos_already_in_album = instance.photos.all()
        cnt = 0
        for pk, obj in photos.items():
            if obj not in photos_already_in_album:
                cnt += 1
                instance.photos.add(obj)
                if instance.cover_photos.count() < 4:
                    instance.cover_photos.add(obj)
        instance.save()
        logger.info(u'Added {} photos to user album {}'.format(
            cnt, instance.id))
        return instance


class AlbumUserSerializer(serializers.ModelSerializer):
    photos = PhotoSuperSimpleSerializer(many=True, read_only=True)
    shared_to = SimpleUserSerializer(many=True, read_only=True)
    owner = SimpleUserSerializer(many=False, read_only=True)

    class Meta:
        model = AlbumUser
        fields = ("id", "title", "photos", "created_on", "favorited", "owner",
                  "shared_to")


class AlbumUserListSerializer(serializers.ModelSerializer):
    cover_photos = PhotoHashListSerializer(many=True, read_only=True)
    photo_count = serializers.SerializerMethodField()
    shared_to = SimpleUserSerializer(many=True, read_only=True)
    owner = SimpleUserSerializer(many=False, read_only=True)

    class Meta:
        model = AlbumUser
        fields = (
            "id",
            "cover_photos",
            "created_on",
            "favorited",
            "title",
            "shared_to",
            "owner",
            "photo_count")

    def get_photo_count(self, obj):
        try:
            return obj.photo_count
        except:  # for when calling AlbumUserListSerializer(obj).data directly
            return obj.photos.count()


class AlbumAutoSerializer(serializers.ModelSerializer):
    photos = PhotoSerializer(many=True, read_only=False)
    people = serializers.SerializerMethodField()

    class Meta:
        model = AlbumAuto
        fields = ("id", "title", "favorited", "timestamp", "created_on",
                  "gps_lat", 'people', "gps_lon", "photos")

    def get_people(self, obj):
        photos = obj.photos.all().prefetch_related(
            Prefetch(
                'faces__person',
                queryset=Person.objects.all().annotate(
                    viewable_face_count=Count('faces'))))

        res = []
        for photo in photos:
            faces = photo.faces.all()
            for face in faces:
                serialized_person = PersonSerializer(face.person).data
                if serialized_person not in res:
                    res.append(serialized_person)
        return res


class AlbumAutoListSerializer(serializers.ModelSerializer):
    photos = PhotoSuperSimpleSerializer
    class Meta:
        model = AlbumAuto
        fields = (
            "id",
            "title",
            "timestamp",
            "photos",
            "favorited",
        )


class LongRunningJobSerializer(serializers.ModelSerializer):
    job_type_str = serializers.SerializerMethodField()
    started_by = SimpleUserSerializer(read_only=True)

    class Meta:
        model = LongRunningJob
        fields = ('job_id', 'queued_at', 'finished', 'finished_at', 'started_at', 'failed',
                  'job_type_str', 'job_type', 'started_by', 'result', 'id')

    def get_job_type_str(self, obj):
        return dict(LongRunningJob.JOB_TYPES)[obj.job_type]


class UserSerializer(serializers.ModelSerializer):
    public_photo_count = serializers.SerializerMethodField()
    public_photo_samples = serializers.SerializerMethodField()
    photo_count = serializers.SerializerMethodField()

    class Meta:
        model = User
        extra_kwargs = {
            'password': {
                'write_only': True
            },
            'first_name': {
                'required': False
            },
            'last_name': {
                'required': False
            },
            'scan_directory': {
                'required': False
            },
            'confidence': {
                'required': False
            },
            'nextcloud_server_address': {
                'required': False
            },
            'nextcloud_username': {
                'required': False
            },
            'nextcloud_scan_directory': {
                'required': False
            },
            'nextcloud_app_password': {
                'write_only': True
            }
        }
        fields = ('id', 'username', 'email', 'scan_directory', 'confidence', 'first_name',
                  'public_photo_samples', 'last_name', 'public_photo_count',
                  'date_joined', 'password', 'avatar', 'photo_count',
                  'nextcloud_server_address', 'nextcloud_username',
                  'nextcloud_app_password', 'nextcloud_scan_directory')

    def validate_nextcloud_app_password(self, value):
        return value

    def create(self, validated_data):
        if 'scan_directory' in validated_data.keys():
            validated_data.pop('scan_directory')

        user = User.objects.create_user(**validated_data)
        logger.info("Created user {}".format(user.id))
        return user

    def update(self, instance, validated_data):
        # user can only update the following
        if 'email' in validated_data:
            instance.email = validated_data.pop('email')
            instance.save()
        if 'first_name' in validated_data:
            instance.first_name = validated_data.pop('first_name')
            instance.save()
        if 'last_name' in validated_data:
            instance.last_name = validated_data.pop('last_name')
            instance.save()

        if 'nextcloud_server_address' in validated_data:
            instance.nextcloud_server_address = validated_data.pop(
                'nextcloud_server_address')
            instance.save()
        if 'nextcloud_username' in validated_data:
            instance.nextcloud_username = validated_data.pop(
                'nextcloud_username')
            instance.save()
        if 'nextcloud_app_password' in validated_data:
            instance.nextcloud_app_password = validated_data.pop(
                'nextcloud_app_password')
            instance.save()
        if 'nextcloud_scan_directory' in validated_data:
            instance.nextcloud_scan_directory = validated_data.pop(
                'nextcloud_scan_directory')
            instance.save()

        return instance

    def get_photo_count(self, obj):
        return Photo.objects.filter(owner=obj).count()

    def get_public_photo_count(self, obj):
        return Photo.objects.filter(Q(owner=obj) & Q(public=True)).count()

    def get_public_photo_samples(self, obj):
        return PhotoSuperSimpleSerializer(
            Photo.objects.filter(Q(owner=obj) & Q(public=True))[:10],
            many=True).data


class ManageUserSerializer(serializers.ModelSerializer):
    photo_count = serializers.SerializerMethodField()

    class Meta:
        model = get_user_model()
        fields = ('username', 'scan_directory', 'confidence', 'last_login', 'date_joined',
                  'photo_count', 'id')
        extra_kwargs = {
            'password': {
                'write_only': True
            },
        }

    def get_photo_count(self, obj):
        return Photo.objects.filter(owner=obj).count()

    def update(self, instance, validated_data):
        if 'scan_directory' in validated_data:
            new_scan_directory = validated_data.pop('scan_directory')
            if os.path.exists(new_scan_directory):
                instance.scan_directory = new_scan_directory
                instance.save()
                logger.info("Updated scan directory for user {}".format(
                    instance.scan_directory))
        if 'confidence' in validated_data:
            new_confidence = validated_data.pop('confidence')
            instance.confidence = new_confidence
            instance.save()
            logger.info("Updated confidence for user {}".format(
                instance.confidence))
        return instance


class SharedToMePhotoSuperSimpleSerializer(serializers.ModelSerializer):
    owner = SimpleUserSerializer(many=False, read_only=True)

    class Meta:
        model = Photo
        fields = ('image_hash', 'favorited', 'hidden', 'exif_timestamp',
                  'public', 'owner')


class SharedPhotoSuperSimpleSerializer(serializers.ModelSerializer):
    owner = SimpleUserSerializer(many=False, read_only=True)

    shared_to = SimpleUserSerializer(many=True, read_only=True)

    class Meta:
        model = Photo
        fields = ('image_hash', 'favorited', 'hidden', 'exif_timestamp',
                  'public', 'owner', 'shared_to')


class SharedFromMePhotoThroughSerializer(serializers.ModelSerializer):
    photo = PhotoSuperSimpleSerializer(many=False, read_only=True)
    user = SimpleUserSerializer(many=False, read_only=True)

    class Meta:
        model = Photo.shared_to.through
        fields = ('user_id', 'user', 'photo')
