from api.models import Photo, AlbumAuto, AlbumUser, Face, Person
from rest_framework import serializers

class PhotoSerializer(serializers.ModelSerializer):
    thumbnail_url = serializers.SerializerMethodField()
    # persons = PersonSerializer(many=True, read_only=True)
    class Meta:
        model = Photo
        fields = ('exif_gps_lat',
                  'exif_gps_lon',
                  'exif_timestamp',
                  'thumbnail_url',
                  'image_hash',
                  'image_path')
    def get_thumbnail_url(self, obj):
        return obj.thumbnail.url

class FaceSerializer(serializers.ModelSerializer):
    face_url = serializers.SerializerMethodField()
    photo = PhotoSerializer(many=False, read_only=True)
    # faces = serializers.StringRelatedField(many=True)
    person = serializers.StringRelatedField(many=False)
    class Meta:
        model = Face
        fields = ('id',
                  'face_url',
                  'photo',
                  'person',
                  'person_label_is_inferred')
    def get_face_url(self, obj):
        return obj.image.url

class PersonSerializer(serializers.ModelSerializer):
    faces = FaceSerializer(many=True, read_only=False)
    # faces = serializers.StringRelatedField(many=True)
    photos = PhotoSerializer(many=True, read_only=True)
    class Meta:
        model = Person
        fields = ('name',
                  'id',
                  'faces',
                  'photos')


class AlbumAutoSerializer(serializers.ModelSerializer):
    photos = PhotoSerializer(many=True, read_only=True)

    class Meta:
        model = AlbumAuto
        fields = (
            "id",   
            "title",
            "timestamp",
            "created_on",
            "gps_lat",
            "gps_lon",
            "photos")
