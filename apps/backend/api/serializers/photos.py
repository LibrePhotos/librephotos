import json

from rest_framework import serializers

from api.image_similarity import search_similar_image
from api.models import AlbumDate, File, Photo
from api.serializers.simple import SimpleUserSerializer


class PhotoSummarySerializer(serializers.ModelSerializer):
    id = serializers.SerializerMethodField()
    dominantColor = serializers.SerializerMethodField()
    aspectRatio = serializers.SerializerMethodField()
    url = serializers.SerializerMethodField()
    location = serializers.SerializerMethodField()
    date = serializers.SerializerMethodField()
    birthTime = serializers.SerializerMethodField()
    video_length = serializers.SerializerMethodField()
    type = serializers.SerializerMethodField()
    owner = SimpleUserSerializer()

    class Meta:
        model = Photo
        fields = (
            "id",
            "dominantColor",
            "url",
            "location",
            "date",
            "birthTime",
            "aspectRatio",
            "type",
            "video_length",
            "rating",
            "owner",
            "exif_gps_lat",
            "exif_gps_lon",
            "removed",
            "in_trashcan",
        )

    # TODO: Rename this field to image_hash
    def get_id(self, obj) -> str:
        return obj.image_hash

    # TODO: Rename this field to aspect_ratio
    def get_aspectRatio(self, obj) -> float:
        return obj.aspect_ratio

    # TODO: Remove this field in the future
    def get_url(self, obj) -> str:
        return obj.image_hash

    def get_location(self, obj) -> str:
        if obj.search_location:
            return obj.search_location
        else:
            return ""

    def get_date(self, obj) -> str:
        if obj.exif_timestamp:
            return obj.exif_timestamp.isoformat()
        else:
            return ""

    def get_video_length(self, obj) -> int:
        if obj.video_length:
            return obj.video_length
        else:
            return ""

    # TODO: Remove this field in the future
    def get_birthTime(self, obj) -> str:
        if obj.exif_timestamp:
            return obj.exif_timestamp
        else:
            return ""

    def get_dominantColor(self, obj) -> str:
        if obj.dominant_color:
            dominant_color = obj.dominant_color[1:-1]
            return "#%02x%02x%02x" % tuple(map(int, dominant_color.split(", ")))
        else:
            return ""

    def get_type(self, obj) -> str:
        if obj.video:
            return "video"
        if obj.main_file and obj.main_file.embedded_media.count() > 0:
            return "motion_photo"
        return "image"


class GroupedPhotosSerializer(serializers.ModelSerializer):
    items = serializers.SerializerMethodField()
    date = serializers.SerializerMethodField()
    location = serializers.SerializerMethodField()

    class Meta:
        model = Photo
        fields = ("date", "location", "items")

    def get_date(self, obj) -> str:
        return obj.date

    def get_location(self, obj) -> str:
        return obj.location

    def get_items(self, obj) -> PhotoSummarySerializer(many=True):
        return PhotoSummarySerializer(obj.photos, many=True).data


class PhotoEditSerializer(serializers.ModelSerializer):
    class Meta:
        model = Photo
        fields = (
            "image_hash",
            "hidden",
            "rating",
            "in_trashcan",
            "removed",
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


class PhotoDetailsSummarySerializer(serializers.ModelSerializer):
    photo_summary = serializers.SerializerMethodField()
    album_date_id = serializers.SerializerMethodField()
    processing = serializers.SerializerMethodField()

    class Meta:
        model = Photo
        fields = ("photo_summary", "album_date_id", "processing")

    def get_photo_summary(self, obj) -> PhotoSummarySerializer:
        return PhotoSummarySerializer(obj.get()).data

    def get_processing(self, obj) -> bool:
        return obj.get().aspect_ratio is None

    def get_album_date_id(self, obj) -> int:
        return (
            AlbumDate.objects.filter(photos__in=obj)
            .values_list("id", flat=True)
            .first()
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
    embedded_media = serializers.SerializerMethodField()

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
            "removed",
            "in_trashcan",
            "shared_to",
            "similar_photos",
            "video",
            "owner",
            "size",
            "height",
            "width",
            "focal_length",
            "fstop",
            "iso",
            "shutter_speed",
            "lens",
            "camera",
            "focalLength35Equivalent",
            "digitalZoomRatio",
            "subjectDistance",
            "embedded_media",
        )

    def get_similar_photos(self, obj) -> list:
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

    def get_captions_json(self, obj) -> dict:
        if obj.captions_json and len(obj.captions_json) > 0:
            return obj.captions_json
        else:
            emptyArray = {
                "im2txt": "",
                "places365": {"attributes": [], "categories": [], "environment": []},
            }
            return emptyArray

    def get_image_path(self, obj) -> list[str]:
        try:
            paths = []
            for file in obj.files.all():
                paths.append(file.path)
            return paths
        except Exception:
            return ["Missing"]

    def get_square_thumbnail_url(self, obj) -> str:
        try:
            return obj.square_thumbnail.url
        except Exception:
            return None

    def get_small_square_thumbnail_url(self, obj) -> str:
        try:
            return obj.square_thumbnail_small.url
        except Exception:
            return None

    def get_big_thumbnail_url(self, obj) -> str:
        try:
            return obj.thumbnail_big.url
        except Exception:
            return None

    def get_geolocation(self, obj) -> dict:
        if obj.geolocation_json:
            return json.loads(obj.geolocation_json)
        else:
            return None

    def get_people(self, obj) -> list:
        return [
            {
                "name": (
                    f.person.name
                    if f.person
                    else (
                        f.cluster_person.name
                        if f.cluster_person
                        else (
                            f.classification_person.name
                            if f.classification_person
                            else ""
                        )
                    )
                ),
                "type": (
                    "user"
                    if f.person
                    else (
                        "cluster"
                        if f.cluster_person
                        else ("classification" if f.classification_person else "")
                    )
                ),
                "probability": (
                    1
                    if f.person
                    else (
                        f.cluster_probability
                        if f.cluster_person
                        else (
                            f.classification_probability
                            if f.classification_person
                            else 0
                        )
                    )
                ),
                "location": {
                    "top": f.location_top,
                    "bottom": f.location_bottom,
                    "left": f.location_left,
                    "right": f.location_right,
                },
                "face_url": f.image.url,
                "face_id": f.id,
            }
            for f in obj.faces.all()
        ]

    def get_embedded_media(self, obj: Photo) -> list[dict]:
        def serialize_file(file):
            return {
                "id": file.hash,
                "type": "video" if file.type == File.VIDEO else "image",
            }

        embedded_media = obj.main_file.embedded_media.all()
        if len(embedded_media) == 0:
            return []
        return list(
            map(
                serialize_file, embedded_media.filter(type__in=[File.VIDEO, File.IMAGE])
            )
        )


class SharedFromMePhotoThroughSerializer(serializers.ModelSerializer):
    photo = serializers.SerializerMethodField()
    user = SimpleUserSerializer(many=False, read_only=True)

    class Meta:
        model = Photo.shared_to.through
        fields = ("user_id", "user", "photo")

    def get_photo(self, obj) -> PhotoSummarySerializer:
        return PhotoSummarySerializer(obj.photo).data
