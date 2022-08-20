from rest_framework import serializers

from api.models import Photo, User


class PhotoSuperSimpleSerializer(serializers.ModelSerializer):
    class Meta:
        model = Photo
        fields = ("image_hash", "rating", "hidden", "exif_timestamp", "public", "video")


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


class SimpleUserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = (
            "id",
            "username",
            "first_name",
            "last_name",
        )
