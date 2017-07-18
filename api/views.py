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

from api.face_classify import train_faces, cluster_faces
from api.social_graph import build_social_graph
from api.autoalbum import generate_event_albums

from rest_framework.pagination import PageNumberPagination

import random
import numpy as np
import base64

class StandardResultsSetPagination(PageNumberPagination):
    page_size = 1000
    page_size_query_param = 'page_size'
    max_page_size = 10000


# Create your views here.

class PhotoViewSet(viewsets.ModelViewSet):
    queryset = Photo.objects.all().order_by('-exif_timestamp')
    serializer_class = PhotoSerializer
    pagination_class = StandardResultsSetPagination

class FaceViewSet(viewsets.ModelViewSet):
    queryset = Face.objects.all().order_by('id')
    serializer_class = FaceSerializer
    pagination_class = StandardResultsSetPagination

class FaceInferredViewSet(viewsets.ModelViewSet):
    queryset = Face.objects.filter(person_label_is_inferred=True)
    serializer_class = FaceSerializer
    pagination_class = StandardResultsSetPagination

class FaceLabeledViewSet(viewsets.ModelViewSet):
    queryset = Face.objects.filter(person_label_is_inferred=False)
    serializer_class = FaceSerializer
    pagination_class = StandardResultsSetPagination

class PersonViewSet(viewsets.ModelViewSet):
    queryset = Person.objects.all().order_by('name')
    serializer_class = PersonSerializer
    pagination_class = StandardResultsSetPagination
    
class AlbumAutoViewSet(viewsets.ModelViewSet):
    queryset = AlbumAuto.objects.all().order_by('-timestamp')
    serializer_class = AlbumAutoSerializer
    pagination_class = StandardResultsSetPagination

class AlbumPersonViewSet(viewsets.ModelViewSet):
    queryset = Person.objects.all().order_by('name')
    serializer_class = AlbumPersonSerializer
    pagination_class = StandardResultsSetPagination

class AlbumDateViewSet(viewsets.ModelViewSet):
    queryset = AlbumDate.objects.all().order_by('-date')
    serializer_class = AlbumDateSerializer
    pagination_class = StandardResultsSetPagination

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