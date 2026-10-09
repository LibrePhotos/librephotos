from rest_framework import serializers

from api.models import AlbumAuto
from api.serializers.person import PersonSerializer
from api.serializers.photos import PhotoHashListSerializer
from api.serializers.simple import PhotoSimpleSerializer


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

    def get_people(self, obj) -> PersonSerializer(many=True):
        # Each person once, in order of first appearance: serializing one per
        # face cost a cover lookup per face and a quadratic de-duplication.
        persons = {}
        for photo in obj.photos.all():
            for face in photo.faces.all():
                if face.deleted or face.person_id is None:
                    continue
                persons.setdefault(face.person_id, face.person)
        return PersonSerializer(list(persons.values()), many=True).data

    def delete(self, validated_data, id):
        album = AlbumAuto.objects.filter(id=id).get()
        album.delete()


class AlbumAutoListSerializer(serializers.ModelSerializer):
    photos = serializers.SerializerMethodField()
    photo_count = serializers.SerializerMethodField()
    # The first photo's exif_timestamp, annotated by AlbumAutoListViewSet.
    start = serializers.DateTimeField(read_only=True, allow_null=True)

    class Meta:
        model = AlbumAuto
        fields = (
            "id",
            "title",
            "timestamp",
            "start",
            "photos",
            "photo_count",
            "favorited",
        )

    def get_photo_count(self, obj) -> int:
        try:
            return obj.photo_count
        except Exception:
            return obj.photos.count()

    def get_photos(self, obj) -> PhotoHashListSerializer:
        try:
            return PhotoHashListSerializer(obj.cover_photo[0]).data
        except Exception:
            return ""
