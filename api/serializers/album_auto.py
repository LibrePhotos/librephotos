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
        res = []
        for photo in obj.photos.all():
            faces = photo.faces.all()
            for face in faces:
                serialized_person = PersonSerializer(face.person).data
                if serialized_person not in res:
                    res.append(serialized_person)
        return res

    def delete(self, validated_data, id):
        album = AlbumAuto.objects.filter(id=id).get()
        album.delete()


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
