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

from rest_framework.pagination import PageNumberPagination

import random
import numpy as np
import base64

class StandardResultsSetPagination(PageNumberPagination):
    page_size = 100
    page_size_query_param = 'page_size'
    max_page_size = 1000


# Create your views here.

class PhotoViewSet(viewsets.ModelViewSet):
    queryset = Photo.objects.all().order_by('-exif_timestamp')
    serializer_class = PhotoSerializer

class FaceViewSet(viewsets.ModelViewSet):
    queryset = Face.objects.all().order_by('id')
    serializer_class = FaceSerializer
    pagination_class = StandardResultsSetPagination

class PersonViewSet(viewsets.ModelViewSet):
    queryset = Person.objects.all().order_by('name')
    serializer_class = PersonSerializer
    pagination_class = StandardResultsSetPagination
    
class AlbumAutoViewSet(viewsets.ModelViewSet):
    queryset = AlbumAuto.objects.all().order_by('-timestamp')
    serializer_class = AlbumAutoSerializer

class AlbumPersonViewSet(viewsets.ModelViewSet):
    queryset = Person.objects.all().order_by('name')
    serializer_class = AlbumPersonSerializer

class AlbumDateViewSet(viewsets.ModelViewSet):
    queryset = AlbumDate.objects.all().order_by('-date')
    serializer_class = AlbumDateSerializer

class FaceToLabelView(APIView):
    def get(self, request, format=None):
        # return a single face for labeling
        faces_all = Face.objects.all()
        unlabelled_faces = []
        labelled_faces = []
        for face in faces_all:
            if face.person_label_is_inferred is not False:
                unlabelled_faces.append(face)
            if face.person_label_is_inferred is False:
                labelled_faces.append(face)

        labelled_face_encodings = []
        for face in labelled_faces:
            face_encoding = np.frombuffer(base64.b64decode(face.encoding),dtype=np.float64)
            labelled_face_encodings.append(face_encoding)
        labelled_face_encodings = np.array(labelled_face_encodings)
        labelled_faces_mean = labelled_face_encodings.mean(0)

        distances_to_labelled_faces_mean = []
        for face in unlabelled_faces:
            face_encoding = np.frombuffer(base64.b64decode(face.encoding),dtype=np.float64)
            distance = np.linalg.norm(labelled_faces_mean-face_encoding)
            distances_to_labelled_faces_mean.append(distance)

        most_unsure_face_idx = np.argmax(distances_to_labelled_faces_mean)

        face_to_label = unlabelled_faces[most_unsure_face_idx]
        return Response(FaceSerializer(face_to_label).data)

