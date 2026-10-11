from rest_framework import serializers

from api import video_color
from api.models import Photo, User
from api.serializers.sync import dominant_hex


class PhotoSuperSimpleSerializer(serializers.ModelSerializer):
    class Meta:
        model = Photo
        fields = ("image_hash", "rating", "hidden", "exif_timestamp", "public", "video")


class PhotoSimpleSerializer(serializers.ModelSerializer):
    square_thumbnail = serializers.SerializerMethodField()
    # What a grid tile needs beyond the hash, named as PhotoSummarySerializer
    # names them, so an event's photos lay out like every other grid's.
    aspectRatio = serializers.SerializerMethodField()
    dominantColor = serializers.SerializerMethodField()
    video_length = serializers.SerializerMethodField()
    is_hdr = serializers.SerializerMethodField()

    class Meta:
        model = Photo
        fields = (
            "id",
            "square_thumbnail",
            "image_hash",
            "exif_timestamp",
            "exif_gps_lat",
            "exif_gps_lon",
            "rating",
            "geolocation_json",
            "public",
            "video",
            "aspectRatio",
            "dominantColor",
            "video_length",
            "is_hdr",
        )

    def get_square_thumbnail(self, obj: Photo) -> str:
        # ``obj.thumbnail`` raises when the photo has no thumbnail row, as before.
        thumbnail = obj.thumbnail
        return thumbnail.square_thumbnail.url if thumbnail.square_thumbnail else ""

    def get_aspectRatio(self, obj: Photo) -> float | None:
        thumbnail = getattr(obj, "thumbnail", None)
        return thumbnail.aspect_ratio if thumbnail else None

    def get_dominantColor(self, obj: Photo) -> str:
        thumbnail = getattr(obj, "thumbnail", None)
        return dominant_hex(thumbnail and thumbnail.dominant_color) or ""

    def get_video_length(self, obj: Photo) -> str:
        return obj.video_length or ""

    def get_is_hdr(self, obj: Photo) -> bool:
        return bool(obj.video and obj.video_color_transfer in video_color.HDR_TRANSFERS)


class SimpleUserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = (
            "id",
            "username",
            "first_name",
            "last_name",
        )
