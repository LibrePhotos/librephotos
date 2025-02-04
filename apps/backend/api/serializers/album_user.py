from rest_framework import serializers

from api.models import AlbumUser, Photo
from api.serializers.photos import GroupedPhotosSerializer
from api.serializers.PhotosGroupedByDate import get_photos_ordered_by_date
from api.serializers.simple import PhotoSuperSimpleSerializer, SimpleUserSerializer
from api.util import logger


class AlbumUserSerializer(serializers.ModelSerializer):
    id = serializers.SerializerMethodField()
    owner = SimpleUserSerializer(many=False, read_only=True)
    shared_to = SimpleUserSerializer(many=True, read_only=True)
    date = serializers.SerializerMethodField()
    location = serializers.SerializerMethodField()
    grouped_photos = serializers.SerializerMethodField()

    class Meta:
        model = AlbumUser
        fields = (
            "id",
            "title",
            "owner",
            "shared_to",
            "date",
            "location",
            "grouped_photos",
        )

    # To-Do: Legacy definition, should be a number instead
    def get_id(self, obj) -> str:
        return str(obj.id)

    def get_grouped_photos(self, obj) -> GroupedPhotosSerializer(many=True):
        grouped_photos = get_photos_ordered_by_date(
            obj.photos.all().order_by("-exif_timestamp")
        )
        res = GroupedPhotosSerializer(grouped_photos, many=True).data
        return res

    def get_location(self, obj) -> str:
        for photo in obj.photos.all():
            if photo and photo.search_location:
                return photo.search_location
        return ""

    def get_date(self, obj) -> str:
        for photo in obj.photos.all():
            if photo and photo.exif_timestamp:
                return photo.exif_timestamp
        return ""


class AlbumUserEditSerializer(serializers.ModelSerializer):
    photos = serializers.PrimaryKeyRelatedField(
        many=True, read_only=False, queryset=Photo.objects.all()
    )
    removedPhotos = serializers.ListField(
        child=serializers.CharField(max_length=100, default=""),
        write_only=True,
        required=False,
    )

    class Meta:
        model = AlbumUser
        fields = (
            "id",
            "title",
            "photos",
            "created_on",
            "favorited",
            "removedPhotos",
            "cover_photo",
        )

    def validate_photos(self, value):
        return [v.image_hash for v in value]

    def create(self, validated_data):
        title = validated_data["title"]
        image_hashes = validated_data["photos"]

        user = None
        request = self.context.get("request")
        if request and hasattr(request, "user"):
            user = request.user

        # check if an album exists with the given title and call the update method if it does
        instance, created = AlbumUser.objects.get_or_create(title=title, owner=user)
        if not created:
            return self.update(instance, validated_data)

        photos = Photo.objects.in_bulk(image_hashes)
        for pk, obj in photos.items():
            instance.photos.add(obj)
        instance.save()
        logger.info(f"Created user album {instance.id} with {len(photos)} photos")
        return instance

    def update(self, instance, validated_data):
        if "title" in validated_data.keys():
            title = validated_data["title"]
            instance.title = title
            logger.info(f"Renamed user album to {title}")

        if "removedPhotos" in validated_data.keys():
            image_hashes = validated_data["removedPhotos"]
            photos_already_in_album = instance.photos.all()
            cnt = 0
            for obj in photos_already_in_album:
                if obj.image_hash in image_hashes:
                    cnt += 1
                    instance.photos.remove(obj)

            logger.info(f"Removed {cnt} photos to user album {instance.id}")

        if "cover_photo" in validated_data.keys():
            cover_photo = validated_data["cover_photo"]
            instance.cover_photo = cover_photo
            logger.info(f"Changed cover photo to {cover_photo}")

        if "photos" in validated_data.keys():
            image_hashes = validated_data["photos"]
            photos = Photo.objects.in_bulk(image_hashes)
            photos_already_in_album = instance.photos.all()
            cnt = 0
            for pk, obj in photos.items():
                if obj not in photos_already_in_album:
                    cnt += 1
                    instance.photos.add(obj)

            logger.info(f"Added {cnt} photos to user album {instance.id}")

        instance.save()
        return instance


class AlbumUserListSerializer(serializers.ModelSerializer):
    cover_photo = serializers.SerializerMethodField()
    photo_count = serializers.SerializerMethodField()
    shared_to = SimpleUserSerializer(many=True, read_only=True)
    owner = SimpleUserSerializer(many=False, read_only=True)

    class Meta:
        model = AlbumUser
        fields = (
            "id",
            "cover_photo",
            "created_on",
            "favorited",
            "title",
            "shared_to",
            "owner",
            "photo_count",
        )

    def get_cover_photo(self, obj) -> PhotoSuperSimpleSerializer:
        if obj.cover_photo:
            return PhotoSuperSimpleSerializer(obj.cover_photo).data
        return PhotoSuperSimpleSerializer(obj.photos.first()).data

    def get_photo_count(self, obj) -> int:
        try:
            return obj.photo_count
        except Exception:  # for when calling AlbumUserListSerializer(obj).data directly
            return obj.photos.count()
