from api.models import Photo, AlbumAuto, AlbumUser, Face, Person, AlbumDate
from rest_framework import serializers
import ipdb
import json

class PhotoSerializer(serializers.ModelSerializer):
    thumbnail_url = serializers.SerializerMethodField()
    thumbnail_height = serializers.SerializerMethodField()
    thumbnail_width = serializers.SerializerMethodField()
    square_thumbnail_url = serializers.SerializerMethodField()
    image_url = serializers.SerializerMethodField()
    geolocation = serializers.SerializerMethodField()
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
                  'geolocation',
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
    def get_geolocation(self, obj):
        if obj.geolocation_json:
          return json.loads(obj.geolocation_json)
        else:
          return None

class PersonSerializer(serializers.ModelSerializer):
#     faces = FaceSerializer(many=True, read_only=False)
#     faces = serializers.StringRelatedField(many=True)
#     photos = serializers.SerializerMethodField()
    face_url = serializers.SerializerMethodField()
    class Meta:
        model = Person
        fields = ('name',
                  'face_url',
                  'id',)

    def get_face_url(self,obj):
        face = obj.faces.first()
        return face.image.url

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


def extract_date(entity):
    'extracts the starting date from an entity'
    return entity.exif_timestamp.date()

from itertools import groupby

class AlbumDateSerializer(serializers.ModelSerializer):
    photos = PhotoSerializer(many=True, read_only=True)

    class Meta:
        model = AlbumDate
        fields = (
            "id",   
            "title",
            "date",
            "photos")



class AlbumPersonSerializer(serializers.ModelSerializer):
#     faces = FaceSerializer(many=True, read_only=False)
#     faces = serializers.StringRelatedField(many=True)
    photos = serializers.SerializerMethodField()
    people = serializers.SerializerMethodField()
    class Meta:
        model = Person
        fields = ('name',
                  'photos',
                  'people',
                  'id',)
#                   'faces')
    def get_photos(self,obj):
        faces = obj.faces.all()
        res = []
        for face in faces:
            res.append(PhotoSerializer(face.photo).data)
        return res

    def get_people(self,obj):
        faces = obj.faces.all()
        res = []
        for face in faces:
            serialized_person = PersonSerializer(face.person).data
            if serialized_person not in res:
                res.append(serialized_person)
        return res




class AlbumAutoSerializer(serializers.ModelSerializer):
    photos = PhotoSerializer(many=True, read_only=True)
    people = serializers.SerializerMethodField()

    class Meta:
        model = AlbumAuto
        fields = (
            "id",   
            "title",
            "timestamp",
            "created_on",
            "gps_lat",
            'people',
            "gps_lon",
            "photos")

    def get_people(self,obj):
        # ipdb.set_trace()
        photos = obj.photos.all()
        res = []
        for photo in photos:
            faces = photo.faces.all()
            for face in faces:
                serialized_person = PersonSerializer(face.person).data
                if serialized_person not in res:
                    res.append(serialized_person)
        return res