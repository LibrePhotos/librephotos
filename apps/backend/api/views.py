from django.shortcuts import render

from rest_framework.views import APIView
from rest_framework.response import Response

from api.models import Photo, AlbumAuto, AlbumUser, Face, Person, AlbumDate
from rest_framework import viewsets
from api.serializers import PhotoSerializer
from api.serializers import FaceSerializer
from api.serializers import PersonSerializer
from api.serializers import AlbumAutoSerializer
from api.serializers import AlbumPersonSerializer
from api.serializers import AlbumDateSerializer


from api.serializers import AlbumAutoListSerializer
from api.serializers import AlbumPersonListSerializer
from api.serializers import AlbumDateListSerializer


from api.face_classify import train_faces, cluster_faces
from api.social_graph import build_social_graph
from api.autoalbum import generate_event_albums
from api.api_util import get_count_stats
from api.directory_watcher import is_photos_being_added, scan_photos
from api.autoalbum import is_auto_albums_being_processed

from rest_framework.pagination import PageNumberPagination

import random
import numpy as np
import base64
import datetime

from django.core.cache import cache
from django.utils.encoding import force_text
from rest_framework_extensions.cache.decorators import cache_response
from rest_framework_extensions.key_constructor.constructors import (
    DefaultKeyConstructor
)
from rest_framework_extensions.key_constructor.bits import (
    KeyBitBase,
    RetrieveSqlQueryKeyBit,
    ListSqlQueryKeyBit,
    PaginationKeyBit
)

# CACHE_TTL = 60 * 60 * 24 # 1 day
CACHE_TTL = 60 * 60 * 24  # 1 min

#caching stuff straight out of https://chibisov.github.io/drf-extensions/docs/#caching
class UpdatedAtKeyBit(KeyBitBase):
    def get_data(self, **kwargs):
        key = 'api_updated_at_timestamp'
        value = cache.get(key, None)
        if not value:
            value = datetime.datetime.utcnow()
            cache.set(key, value=value)
        return force_text(value)

class CustomObjectKeyConstructor(DefaultKeyConstructor):
    retrieve_sql = RetrieveSqlQueryKeyBit()
    updated_at = UpdatedAtKeyBit()

class CustomListKeyConstructor(DefaultKeyConstructor):
    list_sql = ListSqlQueryKeyBit()
    pagination = PaginationKeyBit()
    updated_at = UpdatedAtKeyBit()





class StandardResultsSetPagination(PageNumberPagination):
    page_size = 1000
    page_size_query_param = 'page_size'
    max_page_size = 10000

# Create your views here.

class PhotoViewSet(viewsets.ModelViewSet):
    queryset = Photo.objects.all().order_by('-exif_timestamp')
    serializer_class = PhotoSerializer
    pagination_class = StandardResultsSetPagination

    @cache_response(CACHE_TTL,key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(PhotoViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL,key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(PhotoViewSet, self).list(*args, **kwargs)

class FaceViewSet(viewsets.ModelViewSet):
    queryset = Face.objects.all().order_by('id')
    serializer_class = FaceSerializer
    pagination_class = StandardResultsSetPagination

    @cache_response(CACHE_TTL,key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(FaceViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL,key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(FaceViewSet, self).list(*args, **kwargs)



class FaceInferredViewSet(viewsets.ModelViewSet):
    queryset = Face.objects.filter(person_label_is_inferred=True)
    serializer_class = FaceSerializer
    pagination_class = StandardResultsSetPagination

    @cache_response(CACHE_TTL,key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(FaceInferredViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL,key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(FaceInferredViewSet, self).list(*args, **kwargs)


class FaceLabeledViewSet(viewsets.ModelViewSet):
    queryset = Face.objects.filter(person_label_is_inferred=False)
    serializer_class = FaceSerializer
    pagination_class = StandardResultsSetPagination

    @cache_response(CACHE_TTL,key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(FaceLabeledViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL,key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(FaceLabeledViewSet, self).list(*args, **kwargs)



class PersonViewSet(viewsets.ModelViewSet):
    queryset = Person.objects.all().order_by('name')
    serializer_class = PersonSerializer
    pagination_class = StandardResultsSetPagination
    
    @cache_response(CACHE_TTL,key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(PersonViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL,key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(PersonViewSet, self).list(*args, **kwargs)






class AlbumAutoViewSet(viewsets.ModelViewSet):
    queryset = AlbumAuto.objects.all().order_by('-timestamp')
    serializer_class = AlbumAutoSerializer
    pagination_class = StandardResultsSetPagination

    @cache_response(CACHE_TTL,key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(AlbumAutoViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL,key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(AlbumAutoViewSet, self).list(*args, **kwargs)

class AlbumAutoListViewSet(viewsets.ModelViewSet):
    queryset = AlbumAuto.objects.all().order_by('-timestamp')
    serializer_class = AlbumAutoListSerializer
    pagination_class = StandardResultsSetPagination

    @cache_response(CACHE_TTL,key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(AlbumAutoListViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL,key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(AlbumAutoListViewSet, self).list(*args, **kwargs)







class AlbumPersonViewSet(viewsets.ModelViewSet):
    queryset = Person.objects.all().order_by('name')
    serializer_class = AlbumPersonSerializer
    pagination_class = StandardResultsSetPagination

    @cache_response(CACHE_TTL,key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(AlbumPersonViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL,key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(AlbumPersonViewSet, self).list(*args, **kwargs)


class AlbumPersonListViewSet(viewsets.ModelViewSet):
    queryset = Person.objects.all().order_by('name')
    serializer_class = AlbumPersonListSerializer
    pagination_class = StandardResultsSetPagination

    @cache_response(CACHE_TTL,key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(AlbumPersonListViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL,key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(AlbumPersonListViewSet, self).list(*args, **kwargs)






class AlbumDateViewSet(viewsets.ModelViewSet):
    queryset = AlbumDate.objects.all().order_by('-date')
    serializer_class = AlbumDateSerializer
    pagination_class = StandardResultsSetPagination

    @cache_response(CACHE_TTL,key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(AlbumDateViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL,key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(AlbumDateViewSet, self).list(*args, **kwargs)


class AlbumDateListViewSet(viewsets.ModelViewSet):
    queryset = AlbumDate.objects.all().order_by('-date')
    serializer_class = AlbumDateListSerializer
    pagination_class = StandardResultsSetPagination

    @cache_response(CACHE_TTL,key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(AlbumDateListViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL,key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(AlbumDateListViewSet, self).list(*args, **kwargs)



# API Views

class FaceToLabelView(APIView):
    def get(self, request, format=None):
        # return a single face for labeling
        faces_all = Face.objects.all()
        unlabeled_faces = []
        labeled_faces = []
        for face in faces_all:
            if face.person_label_is_inferred is not False:
                unlabeled_faces.append(face)
            if face.person_label_is_inferred is False:
                labeled_faces.append(face)

        labeled_face_encodings = []
        for face in labeled_faces:
            face_encoding = np.frombuffer(base64.b64decode(face.encoding),dtype=np.float64)
            labeled_face_encodings.append(face_encoding)
        labeled_face_encodings = np.array(labeled_face_encodings)
        labeled_faces_mean = labeled_face_encodings.mean(0)

        distances_to_labeled_faces_mean = []
        for face in unlabeled_faces:
            face_encoding = np.frombuffer(base64.b64decode(face.encoding),dtype=np.float64)
            distance = np.linalg.norm(labeled_faces_mean-face_encoding)
            distances_to_labeled_faces_mean.append(distance)

        try:
            most_unsure_face_idx = np.argmax(distances_to_labeled_faces_mean)
            face_to_label = unlabeled_faces[most_unsure_face_idx]
            data = FaceSerializer(face_to_label).data
        except:
            data = {'results':[]}
        return Response(data)

class ClusterFaceView(APIView):
    def get(self, request, format=None):
        res = cluster_faces()
        return Response(res)

class TrainFaceView(APIView):
    def get(self, request, format=None):
        res = train_faces()
        return Response(res)

class SocialGraphView(APIView):
    def get(self, request, format=None):
        res = build_social_graph()
        return Response(res)

class AutoAlbumGenerateView(APIView):
    def get(self, request, format=None):
        res = generate_event_albums()
        return Response(res)

class StatsView(APIView):
    def get(self, requests, format=None):
        res = get_count_stats()
        return Response(res)

class ScanPhotosView(APIView):
    def get(self, requests, format=None):
        res = scan_photos()
        return Response(res)


# watchers
class IsPhotosBeingAddedView(APIView):
    def get(self, requests, format=None):
        res = is_photos_being_added()
        return Response(res)

class IsAutoAlbumsBeingProcessed(APIView):
    def get(self, requests, format=None):
        res = is_auto_albums_being_processed()
        return Response(res)
