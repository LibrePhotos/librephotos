from django.shortcuts import render

from rest_framework.views import APIView
from rest_framework.response import Response

from api.models import Photo, AlbumAuto, AlbumUser, Face, Person, AlbumDate, AlbumPlace,AlbumThing
from django.db.models import Count
from django.db.models import Q


from django.http import HttpResponse
from django.http import HttpResponseForbidden

from rest_framework import viewsets
from api.serializers import PhotoSerializer
from api.serializers import PhotoHashListSerializer
from api.serializers import FaceSerializer
from api.serializers import FaceListSerializer
from api.serializers import PersonSerializer
from api.serializers import AlbumAutoSerializer
from api.serializers import AlbumPersonSerializer
from api.serializers import AlbumDateSerializer
from api.serializers import AlbumThingSerializer
from api.serializers import AlbumPlaceSerializer


from api.serializers import AlbumAutoListSerializer
from api.serializers import AlbumPersonListSerializer
from api.serializers import AlbumDateListSerializer
from api.serializers import AlbumDateListWithPhotoHashSerializer
from api.serializers import AlbumThingListSerializer
from api.serializers import AlbumPlaceListSerializer


from api.face_classify import train_faces, cluster_faces
from api.social_graph import build_social_graph, build_ego_graph
from api.autoalbum import generate_event_albums

from api.drf_optimize import OptimizeRelatedModelViewSetMetaclass
from django.utils import six

from api.api_util import \
    get_count_stats, \
    get_location_clusters, \
    get_photo_country_counts, \
    get_photo_month_counts, \
    get_searchterms_wordcloud, \
    get_search_term_examples, \
    get_location_sunburst, \
    get_location_timeline

from api.directory_watcher import  scan_photos
from api.autoalbum import generate_event_albums

from api.flags import is_photos_being_added
from api.flags import is_auto_albums_being_processed



from rest_framework.pagination import PageNumberPagination

from rest_framework import filters

import random
import numpy as np
import base64
import datetime

from django.core.cache import cache
from django.utils.encoding import force_text
from rest_framework_extensions.cache.mixins import CacheResponseMixin

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

import ipdb

# CACHE_TTL = 60 * 60 * 24 # 1 day
CACHE_TTL = 60*60*24*30  # 1 month

#caching stuff straight out of https://chibisov.github.io/drf-extensions/docs/#caching
class UpdatedAtKeyBit(KeyBitBase):
    def get_data(self, **kwargs):
        key = 'api_updated_at_timestamp'
        value = cache.get(key, None)
        if not value:
            value = datetime.datetime.utcnow()
            cache.set(key, value=value)
            print('key not found, key: %s, value: %s'%(key,value))
        else:
            print('key found, key: %s, value: %s'%(key,value))
        return force_text(value)

class CustomObjectKeyConstructor(DefaultKeyConstructor):
    retrieve_sql = RetrieveSqlQueryKeyBit()
    updated_at = UpdatedAtKeyBit()

class CustomListKeyConstructor(DefaultKeyConstructor):
    list_sql = ListSqlQueryKeyBit()
    pagination = PaginationKeyBit()
    updated_at = UpdatedAtKeyBit()




class HugeResultsSetPagination(PageNumberPagination):
    page_size = 50000
    page_size_query_param = 'page_size'
    max_page_size = 100000

class StandardResultsSetPagination(PageNumberPagination):
    page_size = 10000
    page_size_query_param = 'page_size'
    max_page_size = 100000

class SmallResultsSetPagination(PageNumberPagination):
    page_size = 100
    page_size_query_param = 'page_size'
    max_page_size = 200

# Create your views here.

@six.add_metaclass(OptimizeRelatedModelViewSetMetaclass)
class PhotoViewSet(viewsets.ModelViewSet):
    queryset = Photo.objects.all().order_by('-exif_timestamp')
    serializer_class = PhotoSerializer
    pagination_class = StandardResultsSetPagination
    filter_backends = (filters.SearchFilter,)
    search_fields = (['search_captions','search_location','faces__person__name','exif_timestamp','image_path'])
    # search_fields = (['faces__person__name','faces__person__name'])


    @cache_response(CACHE_TTL,key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(PhotoViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL,key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(PhotoViewSet, self).list(*args, **kwargs)





@six.add_metaclass(OptimizeRelatedModelViewSetMetaclass)
class PhotoHashListViewSet(CacheResponseMixin, viewsets.ModelViewSet):
    queryset = Photo.objects.all().order_by('-exif_timestamp')
    serializer_class = PhotoHashListSerializer
    pagination_class = HugeResultsSetPagination
    filter_backends = (filters.SearchFilter,)
    search_fields = (['search_captions','search_location','faces__person__name','exif_timestamp','image_path'])
    # search_fields = (['faces__person__name','faces__person__name'])

    @cache_response(CACHE_TTL,key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(PhotoHashListViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL,key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(PhotoHashListViewSet, self).list(*args, **kwargs)




@six.add_metaclass(OptimizeRelatedModelViewSetMetaclass)
class NoTimestampPhotoHashListViewSet(viewsets.ModelViewSet):
    queryset = Photo.objects.filter(exif_timestamp=None).order_by('image_path')
    serializer_class = PhotoHashListSerializer
    pagination_class = HugeResultsSetPagination
    filter_backends = (filters.SearchFilter,)
    search_fields = (['search_captions','search_location','faces__person__name'])

    # @cache_response(CACHE_TTL,key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(NoTimestampPhotoHashListViewSet, self).retrieve(*args, **kwargs)

    # @cache_response(CACHE_TTL,key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(NoTimestampPhotoHashListViewSet, self).list(*args, **kwargs)








@six.add_metaclass(OptimizeRelatedModelViewSetMetaclass)
class FaceListViewSet(viewsets.ModelViewSet):
    queryset = Face.objects.all().select_related('person').order_by('id')
    serializer_class = FaceListSerializer
    pagination_class = StandardResultsSetPagination

    @cache_response(CACHE_TTL,key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(FaceListViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL,key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(FaceListViewSet, self).list(*args, **kwargs)


@six.add_metaclass(OptimizeRelatedModelViewSetMetaclass)
class FaceInferredListViewSet(viewsets.ModelViewSet):
    queryset = Face.objects.filter(person_label_is_inferred=True).select_related('person').order_by('id')
    serializer_class = FaceListSerializer
    pagination_class = StandardResultsSetPagination

    @cache_response(CACHE_TTL,key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(FaceInferredListViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL,key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(FaceInferredListViewSet, self).list(*args, **kwargs)


@six.add_metaclass(OptimizeRelatedModelViewSetMetaclass)
class FaceLabeledListViewSet(viewsets.ModelViewSet):
    queryset = Face.objects.filter(Q(person_label_is_inferred=False) | Q(person__name='unknown')).select_related('person').order_by('id')
    serializer_class = FaceListSerializer
    pagination_class = StandardResultsSetPagination

#     @cache_response(CACHE_TTL,key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(FaceLabeledListViewSet, self).retrieve(*args, **kwargs)

#     @cache_response(CACHE_TTL,key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(FaceLabeledListViewSet, self).list(*args, **kwargs)






@six.add_metaclass(OptimizeRelatedModelViewSetMetaclass)
class FaceViewSet(viewsets.ModelViewSet):
    queryset = Face.objects.all().prefetch_related('person').order_by('id')
    serializer_class = FaceSerializer
    pagination_class = StandardResultsSetPagination

    @cache_response(CACHE_TTL,key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(FaceViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL,key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(FaceViewSet, self).list(*args, **kwargs)



@six.add_metaclass(OptimizeRelatedModelViewSetMetaclass)
class FaceInferredViewSet(viewsets.ModelViewSet):
    queryset = Face.objects.filter(person_label_is_inferred=True).order_by('id')
    serializer_class = FaceSerializer
    pagination_class = StandardResultsSetPagination

    @cache_response(CACHE_TTL,key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(FaceInferredViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL,key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(FaceInferredViewSet, self).list(*args, **kwargs)


@six.add_metaclass(OptimizeRelatedModelViewSetMetaclass)
class FaceLabeledViewSet(viewsets.ModelViewSet):
    queryset = Face.objects.filter(person_label_is_inferred=False).order_by('id')
    serializer_class = FaceSerializer
    pagination_class = StandardResultsSetPagination

    @cache_response(CACHE_TTL,key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(FaceLabeledViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL,key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(FaceLabeledViewSet, self).list(*args, **kwargs)



@six.add_metaclass(OptimizeRelatedModelViewSetMetaclass)
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






@six.add_metaclass(OptimizeRelatedModelViewSetMetaclass)
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

@six.add_metaclass(OptimizeRelatedModelViewSetMetaclass)
class AlbumAutoListViewSet(viewsets.ModelViewSet):
    queryset = AlbumAuto.objects.all().prefetch_related('photos').order_by('-timestamp')
    serializer_class = AlbumAutoListSerializer
    pagination_class = StandardResultsSetPagination
    filter_backends = (filters.SearchFilter,)
    search_fields = (['photos__search_captions','photos__search_location','photos__faces__person__name'])

    @cache_response(CACHE_TTL,key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(AlbumAutoListViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL,key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(AlbumAutoListViewSet, self).list(*args, **kwargs)







@six.add_metaclass(OptimizeRelatedModelViewSetMetaclass)
class AlbumPersonViewSet(viewsets.ModelViewSet):
    queryset = Person.objects.all().prefetch_related('faces__photo').order_by('name')
    serializer_class = AlbumPersonSerializer
    pagination_class = StandardResultsSetPagination

    @cache_response(CACHE_TTL,key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(AlbumPersonViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL,key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(AlbumPersonViewSet, self).list(*args, **kwargs)


@six.add_metaclass(OptimizeRelatedModelViewSetMetaclass)
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






@six.add_metaclass(OptimizeRelatedModelViewSetMetaclass)
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


@six.add_metaclass(OptimizeRelatedModelViewSetMetaclass)
class AlbumDateListViewSet(viewsets.ModelViewSet):
    queryset = AlbumDate.objects.all().order_by('-date')
    serializer_class = AlbumDateListSerializer
    pagination_class = StandardResultsSetPagination
    filter_backends = (filters.SearchFilter,)
    search_fields = (['photos__search_captions','photos__search_location','photos__faces__person__name'])

    @cache_response(CACHE_TTL,key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(AlbumDateListViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL,key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(AlbumDateListViewSet, self).list(*args, **kwargs)


# @six.add_metaclass(OptimizeRelatedModelViewSetMetaclass)
class AlbumDateListWithPhotoHashViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = AlbumDate.objects.exclude(date=None).prefetch_related('photos').order_by('-date')
    serializer_class = AlbumDateListWithPhotoHashSerializer
    pagination_class = StandardResultsSetPagination
    filter_backends = (filters.SearchFilter,)
    search_fields = (['photos__search_captions','photos__search_location','photos__faces__person__name'])

    @cache_response(CACHE_TTL,key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(AlbumDateListWithPhotoHashViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL,key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(AlbumDateListWithPhotoHashViewSet, self).list(*args, **kwargs)




@six.add_metaclass(OptimizeRelatedModelViewSetMetaclass)
class AlbumThingViewSet(viewsets.ModelViewSet):
    queryset = AlbumThing.objects.all().order_by('title')
    serializer_class = AlbumThingSerializer
    pagination_class = StandardResultsSetPagination

    @cache_response(CACHE_TTL,key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(AlbumThingViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL,key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(AlbumThingViewSet, self).list(*args, **kwargs)


@six.add_metaclass(OptimizeRelatedModelViewSetMetaclass)
class AlbumThingListViewSet(viewsets.ModelViewSet):
    queryset = AlbumThing.objects.annotate(photo_count=Count('photos')).filter(photo_count__gte=3).order_by('-photo_count')[:400]
    serializer_class = AlbumThingListSerializer
    pagination_class = StandardResultsSetPagination

    @cache_response(CACHE_TTL,key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(AlbumThingListViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL,key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(AlbumThingListViewSet, self).list(*args, **kwargs)










@six.add_metaclass(OptimizeRelatedModelViewSetMetaclass)
class AlbumPlaceViewSet(viewsets.ModelViewSet):
    queryset = AlbumPlace.objects.all().order_by('title')
    serializer_class = AlbumPlaceSerializer
    pagination_class = StandardResultsSetPagination

    # @cache_response(CACHE_TTL,key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(AlbumPlaceViewSet, self).retrieve(*args, **kwargs)

    # @cache_response(CACHE_TTL,key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(AlbumPlaceViewSet, self).list(*args, **kwargs)


@six.add_metaclass(OptimizeRelatedModelViewSetMetaclass)
class AlbumPlaceListViewSet(viewsets.ModelViewSet):
    queryset = AlbumPlace.objects.annotate(photo_count=Count('photos')).filter(photo_count__gte=3).order_by('-photo_count')[:400]
    serializer_class = AlbumPlaceListSerializer
    pagination_class = StandardResultsSetPagination

    @cache_response(CACHE_TTL,key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(AlbumPlaceListViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL,key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(AlbumPlaceListViewSet, self).list(*args, **kwargs)











# API Views

class SearchTermExamples(APIView):
    def get(self, request, format=None):
        search_term_examples = get_search_term_examples()
        return Response({"results":search_term_examples})

class FaceToLabelView(APIView):
    def get(self, request, format=None):
        # return a single face for labeling

        qs = Face.objects.filter(person_label_probability__gt=0).filter(person_label_probability__lt=1).order_by('person_label_probability')
        if qs.count() > 0:
            face_to_label = qs[0]
            data = FaceListSerializer(face_to_label).data
            
            # dirty hack to make the serializer image field to return full url
            if request.is_secure(): 
                protocol = 'https://'
            else:
                protocol = 'http://'

            image = protocol + request.META['HTTP_HOST'] + data['image']
            data['image'] = image
            return Response(data)

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
            face_encoding = np.frombuffer(bytes.fromhex(face.encoding))
            labeled_face_encodings.append(face_encoding)
        labeled_face_encodings = np.array(labeled_face_encodings)
        labeled_faces_mean = labeled_face_encodings.mean(0)

        distances_to_labeled_faces_mean = []
        for face in unlabeled_faces:
            face_encoding = np.frombuffer(bytes.fromhex(face.encoding))
            distance = np.linalg.norm(labeled_faces_mean-face_encoding)
            distances_to_labeled_faces_mean.append(distance)

        try:
            most_unsure_face_idx = np.argmax(distances_to_labeled_faces_mean)
            face_to_label = unlabeled_faces[most_unsure_face_idx]
            data = FaceListSerializer(face_to_label).data
            
            # dirty hack to make the serializer image field to return full url
            if request.is_secure(): 
                protocol = 'https://'
            else:
                protocol = 'http://'

            image = protocol + request.META['HTTP_HOST'] + data['image']
            data['image'] = image
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


class EgoGraphView(APIView):
    def get(self, request, format=None):
        res = build_ego_graph(request.GET['person_id'])
        return Response(res)



class AutoAlbumGenerateView(APIView):
    def get(self, request, format=None):
        res = generate_event_albums()
        return Response(res)

class StatsView(APIView):
    def get(self, requests, format=None):
        res = get_count_stats()
        return Response(res)

class LocationClustersView(APIView):
    def get(self, requests, format=None):
        res = get_location_clusters()
        return Response(res)

class LocationSunburst(APIView):
    def get(self, requests, format=None):
        res = get_location_sunburst()
        return Response(res)

class LocationTimeline(APIView):
    def get(self, requests, format=None):
        res = get_location_timeline()
        return Response(res)

class PhotoMonthCountsView(APIView):
    def get(self, requests, format=None):
        res = get_photo_month_counts()
        return Response(res)

class PhotoCountryCountsView(APIView):
    def get(self, requests, format=None):
        res = get_photo_country_counts()
        return Response(res)

class SearchTermWordCloudView(APIView):
    def get(self, requests, format=None):
        res = get_searchterms_wordcloud()
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




def media_access(request, path):
    # ipdb.set_trace()
    """
    When trying to access :
    myproject.com/media/uploads/passport.png

    If access is authorized, the request will be redirected to
    myproject.com/protected/media/uploads/passport.png

    This special URL will be handle by nginx we the help of X-Accel
    """

    access_granted = False

    user = request.user
    print('AUTHORIZATION' in request.META.keys())
    if user.is_authenticated:
        if user.is_staff:
            # If admin, everything is granted
            access_granted = True
        else:
            # For simple user, only their documents can be accessed
            user_documents = [
                user.identity_document,
                # add here more allowed documents
            ]

            for doc in user_documents:
                if path == doc.name:
                    access_granted = True

    if access_granted:
        response = HttpResponse()
        # Content-type will be detected by nginx
        del response['Content-Type']
        response['X-Accel-Redirect'] = '/media/' + path
        return response
    else:
        return HttpResponseForbidden('Not authorized to access this media.')