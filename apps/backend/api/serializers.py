from api.models import Photo, AlbumAuto, AlbumUser, Face, Person
from rest_framework import serializers
import ipdb

class PhotoSerializer(serializers.ModelSerializer):
    thumbnail_url = serializers.SerializerMethodField()
    thumbnail_height = serializers.SerializerMethodField()
    thumbnail_width = serializers.SerializerMethodField()
    square_thumbnail_url = serializers.SerializerMethodField()
    image_url = serializers.SerializerMethodField()
    # persons = PersonSerializer(many=True, read_only=True)
    class Meta:
        model = Photo
        fields = ('exif_gps_lat',
                  'exif_gps_lon',
                  'exif_timestamp',
                  'thumbnail_url',
                  'thumbnail_height',
                  'thumbnail_width',
                  'square_thumbnail_url',
                  'image_url',
                  'image_hash',
                  'image_path')
    def get_thumbnail_url(self, obj):
        return obj.thumbnail.url
    def get_thumbnail_height(self, obj):
        return obj.thumbnail.height
    def get_thumbnail_width(self, obj):
        return obj.thumbnail.width
    def get_square_thumbnail_url(self, obj):
        return obj.square_thumbnail.url
    def get_image_url(self, obj):
        return obj.image.url

class PersonSerializer(serializers.ModelSerializer):
#     faces = FaceSerializer(many=True, read_only=False)
#     faces = serializers.StringRelatedField(many=True)
#     photos = serializers.SerializerMethodField()
    class Meta:
        model = Person
        fields = ('name',
#                   'photos',
                  'id',)
#                   'faces')
#     def get_photos(self,obj):
#         faces = obj.faces.all()
#         res = []
#         for face in faces:
#             res.append(PhotoSerializer(face.photo).data)
#         return res

class FaceSerializer(serializers.ModelSerializer):
    face_url = serializers.SerializerMethodField()
#     photo = PhotoSerializer(many=False, read_only=True)
    # faces = serializers.StringRelatedField(many=True)
    person = PersonSerializer(many=False)
#     person = serializers.HyperlinkedRelatedField(view_name='person-detail',read_only=True)
    class Meta:
        model = Face
        fields = ('id',
                  'face_url',
                  'photo_id',
                  'person',
                  'person_id',
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
        instance.person_label_is_inferred = False
        instance.save()
        return instance
#         pass
#         ipdb.set_trace()
#         person_data = validated_data.pop('id')

        

class AlbumPersonSerializer(serializers.ModelSerializer):
#     faces = FaceSerializer(many=True, read_only=False)
#     faces = serializers.StringRelatedField(many=True)
    photos = serializers.SerializerMethodField()
    class Meta:
        model = Person
        fields = ('name',
                  'photos',
                  'id',)
#                   'faces')
    def get_photos(self,obj):
        faces = obj.faces.all()
        res = []
        for face in faces:
            res.append(PhotoSerializer(face.photo).data)
        return res



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
