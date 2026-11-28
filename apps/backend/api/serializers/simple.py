from django.db.models import Case, F, Value, When
from django.db.models.expressions import CombinedExpression
from django.db.models.functions import Coalesce
from rest_framework import serializers

from api.models import Photo, User
from api.models.photo_edit import PhotoEdit
from api.serializers.fields import loaded_count
from api.serializers.sync import dominant_hex
from api.video import color


def has_animated_preview(photo: Photo) -> bool:
    """Whether the photo's grid square is an animated clip.

    A video's square is an mp4 clip, or a WebP still when it was scanned with
    the animated previews switched off (#649). Read from the stored name, so
    a video keeps the kind it has until a rescan replaces it.
    """
    if not photo.video:
        return False
    thumbnail = getattr(photo, "thumbnail", None)
    return bool(thumbnail and thumbnail.has_animated_squares)


def has_video_poster(photo: Photo) -> bool:
    """Whether the video has WebP stills beside its squares (#2026).

    The grid shows ``/media/square_thumbnails[_small]/<image_hash>.webp`` and
    plays the clip only while the tile is pointed at. False for the videos an
    older release scanned until the Make Video Posters job has run.
    """
    if not photo.video:
        return False
    thumbnail = getattr(photo, "thumbnail", None)
    return bool(thumbnail and thumbnail.video_poster)


THUMBNAIL_VERSION = "thumbnail_version_annotation"
THUMBNAIL_VERSION_HELP = (
    "Which thumbnails the grid shows: twice the edit's version, plus one once its "
    "rendition is ready, plus the times the thumbnails were made again (a rotation, "
    "a rebuild); 0 for a photo never edited nor rebuilt. It never goes back. Grids "
    "fold it into the thumbnail URL's v with the ThumbHash"
)


def thumbnail_version_annotation() -> CombinedExpression:
    ready = Case(
        When(edit__rendition=PhotoEdit.Rendition.READY, then=Value(1)),
        default=Value(0),
    )
    edits = Coalesce(F("edit__version") * 2 + ready, Value(0))
    return edits + Coalesce(F("thumbnail__revision"), Value(0))


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
    thumbhash = serializers.SerializerMethodField()
    thumbnail_version = serializers.SerializerMethodField(
        help_text=THUMBNAIL_VERSION_HELP
    )
    video_length = serializers.SerializerMethodField()
    is_hdr = serializers.SerializerMethodField()
    animated_preview = serializers.SerializerMethodField()
    video_poster = serializers.SerializerMethodField()

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
            "thumbhash",
            "thumbnail_version",
            "video_length",
            "is_hdr",
            "animated_preview",
            "video_poster",
            # The tile's 360° badge (#483), as in PhotoSummarySerializer.
            "projection_type",
        )
        # What the scan read from the file, never written through an event.
        read_only_fields = ("projection_type",)

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

    def get_thumbhash(self, obj: Photo) -> str | None:
        thumbnail = getattr(obj, "thumbnail", None)
        return thumbnail.thumbhash if thumbnail else None

    def get_thumbnail_version(self, obj: Photo) -> int:
        return loaded_count(obj, THUMBNAIL_VERSION)

    def get_video_length(self, obj: Photo) -> str:
        return obj.video_length or ""

    def get_is_hdr(self, obj: Photo) -> bool:
        return bool(obj.video and obj.video_color_transfer in color.HDR_TRANSFERS)

    def get_animated_preview(self, obj: Photo) -> bool:
        return has_animated_preview(obj)

    def get_video_poster(self, obj: Photo) -> bool:
        return has_video_poster(obj)


class SimpleUserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = (
            "id",
            "username",
            "first_name",
            "last_name",
        )
