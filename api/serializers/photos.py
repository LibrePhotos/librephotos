from rest_framework import serializers

from api.models import Photo


class PhotoSuperSimpleSerializer(serializers.ModelSerializer):
    class Meta:
        model = Photo
        fields = ("image_hash", "rating", "hidden", "exif_timestamp", "public", "video")
