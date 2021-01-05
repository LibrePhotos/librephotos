from django.shortcuts import render

from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated, IsAdminUser, AllowAny

from constance import config as site_config

from api.models import Photo, AlbumAuto, AlbumUser, Face, Person, AlbumDate, AlbumPlace, AlbumThing, LongRunningJob, User, get_or_create_person
from django.db.models import Count
from django.db.models import Q, F
from django.db.models import Prefetch
from api.places365.places365 import inference_places365
from django.http import HttpResponse
from django.http import HttpResponseForbidden

from rest_framework import viewsets

from api.serializers import PhotoSerializer
from api.serializers import PhotoEditSerializer
from api.serializers import PhotoHashListSerializer
from api.serializers import PhotoSuperSimpleSerializer
from api.serializers import PhotoSimpleSerializer
from api.serializers import FaceSerializer
from api.serializers import FaceListSerializer
from api.serializers import PersonSerializer
from api.serializers import AlbumAutoSerializer
from api.serializers import AlbumPersonSerializer
from api.serializers import AlbumDateSerializer
from api.serializers import AlbumThingSerializer
from api.serializers import AlbumPlaceSerializer
from api.serializers import AlbumUserSerializer

from api.serializers import AlbumUserEditSerializer

from api.serializers import AlbumAutoListSerializer
from api.serializers import AlbumPersonListSerializer
from api.serializers import AlbumDateListSerializer
from api.serializers import AlbumDateListWithPhotoHashSerializer
from api.serializers import AlbumThingListSerializer
from api.serializers import AlbumPlaceListSerializer
from api.serializers import AlbumUserListSerializer

from api.serializers import LongRunningJobSerializer

from api.serializers import SharedPhotoSuperSimpleSerializer
from api.serializers import SharedToMePhotoSuperSimpleSerializer

from api.serializers import SharedFromMePhotoThroughSerializer

from api.serializers import UserSerializer
from api.serializers import ManageUserSerializer

from api.serializers_serpy import AlbumDateListWithPhotoHashSerializer as AlbumDateListWithPhotoHashSerializerSerpy
from api.serializers_serpy import PhotoSuperSimpleSerializer as PhotoSuperSimpleSerializerSerpy
from api.serializers_serpy import PhotoSuperSimpleSerializerWithAddedOn as PhotoSuperSimpleSerializerWithAddedOnSerpy
from api.serializers_serpy import SharedPhotoSuperSimpleSerializer as SharedPhotoSuperSimpleSerializerSerpy
from api.permissions import IsOwnerOrReadOnly, IsUserOrReadOnly, IsPhotoOrAlbumSharedTo, IsRegistrationAllowed

from api.face_classify import train_faces, cluster_faces
from api.social_graph import build_social_graph, build_ego_graph
from api.autoalbum import generate_event_albums

from api.image_similarity import search_similar_image
from django_rq import get_worker
from api.drf_optimize import OptimizeRelatedModelViewSetMetaclass
import six as six
import uuid
from api.api_util import \
    get_count_stats, \
    get_location_clusters, \
    get_photo_country_counts, \
    get_photo_month_counts, \
    get_searchterms_wordcloud, \
    get_search_term_examples, \
    get_location_sunburst, \
    get_location_timeline, \
    path_to_dict, \
    get_current_job

import config

from api.directory_watcher import scan_photos
from api.autoalbum import generate_event_albums, regenerate_event_titles

from rest_framework.pagination import PageNumberPagination

from rest_framework import filters

import random
import numpy as np
import base64
import datetime
import pytz

from django.core.cache import cache
from django.utils.encoding import force_text

from rest_framework_extensions.cache.decorators import cache_response
from rest_framework_extensions.key_constructor.constructors import (
    DefaultKeyConstructor)
from rest_framework_extensions.key_constructor.bits import (
    KeyBitBase, RetrieveSqlQueryKeyBit, ListSqlQueryKeyBit, PaginationKeyBit)

import ipdb
from tqdm import tqdm
import time

from django_rq import job
import django_rq
from django_bulk_update.helper import bulk_update

from api.util import logger

# CACHE_TTL = 60 * 60 * 24 # 1 day
CACHE_TTL = 60 * 60 * 24 * 30  # 1 month
CACHE_TTL = 60 * 60 * 24  # 1 day
CACHE_TTL_VIZ = 60 * 60  # 1 hour
CACHE_TTL = 1  # 1 sec


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
class TinyResultsSetPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = 'page_size'
    max_page_size = 50

def queue_can_accept_job():
    default_queue_stat = [
        q for q in django_rq.utils.get_statistics()['queues']
        if q['name'] == 'default'
    ][0]
    started_jobs = default_queue_stat['started_jobs']
    runninb_jobs = default_queue_stat['jobs']
    if started_jobs + runninb_jobs > 0:
        return False
    else:
        return True

class PhotoViewSet(viewsets.ModelViewSet):
    serializer_class = PhotoSerializer
    pagination_class = HugeResultsSetPagination
    filter_backends = (filters.SearchFilter, )
    permission_classes = (IsPhotoOrAlbumSharedTo, )
    search_fields = ([
        'search_captions', 'search_location', 'faces__person__name',
        'exif_timestamp', 'image_path'
    ])

    def get_queryset(self):
        if self.request.user.is_anonymous:
            return Photo.visible.filter(Q(public=True)).order_by('-exif_timestamp')
        else:
            return Photo.visible.order_by('-exif_timestamp')

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(PhotoViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(PhotoViewSet, self).list(*args, **kwargs)


class PhotoEditViewSet(viewsets.ModelViewSet):
    serializer_class = PhotoEditSerializer
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        return Photo.visible.filter(Q(owner=self.request.user))

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(PhotoEditViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(PhotoEditViewSet, self).list(*args, **kwargs)


class PhotoHashListViewSet(viewsets.ModelViewSet):
    serializer_class = PhotoHashListSerializer
    pagination_class = HugeResultsSetPagination
    permission_classes = (IsAuthenticated, )
    filter_backends = (filters.SearchFilter, )
    search_fields = ([
        'search_captions', 'search_location', 'faces__person__name',
        'exif_timestamp', 'image_path'
    ])

    def get_queryset(self):
        return Photo.visible.filter(Q(owner=self.request.user)).order_by('-exif_timestamp')

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(PhotoHashListViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(PhotoHashListViewSet, self).list(*args, **kwargs)


class PhotoSimpleListViewSet(viewsets.ModelViewSet):
    serializer_class = PhotoSimpleSerializer
    pagination_class = HugeResultsSetPagination
    filter_backends = (filters.SearchFilter, )
    search_fields = ([
        'search_captions', 'search_location', 'faces__person__name',
        'exif_timestamp', 'image_path'
    ])

    def get_queryset(self):
        return Photo.visible.filter(Q(owner=self.request.user)).order_by('-exif_timestamp')

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(PhotoSimpleListViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(PhotoSimpleListViewSet, self).list(*args, **kwargs)


class PhotoSuperSimpleSearchListViewSet(viewsets.ModelViewSet):

    serializer_class = PhotoSuperSimpleSerializer
    pagination_class = HugeResultsSetPagination
    filter_backends = (filters.SearchFilter, )
    search_fields = ([
        'search_captions', 'search_location', 'faces__person__name',
        'exif_timestamp', 'image_path'
    ])

    def get_queryset(self):
        return Photo.visible.filter(Q(owner=self.request.user)).order_by('-exif_timestamp')

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(PhotoSuperSimpleSearchListViewSet, self).retrieve(
            *args, **kwargs)

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(PhotoSuperSimpleSearchListViewSet, self).list(
            *args, **kwargs)


class PhotoSuperSimpleListViewSet(viewsets.ModelViewSet):

    queryset = Photo.visible.order_by('-exif_timestamp')
    serializer_class = PhotoSuperSimpleSerializerSerpy
    pagination_class = HugeResultsSetPagination
    filter_backends = (filters.SearchFilter, )
    search_fields = ([
        'search_captions', 'search_location', 'faces__person__name',
        'exif_timestamp', 'image_path'
    ])

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(PhotoSuperSimpleListViewSet, self).retrieve(
            *args, **kwargs)

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, request):
        queryset = Photo.visible.only(
            'image_hash', 'exif_timestamp', 'favorited', 'public',
            'hidden').order_by('exif_timestamp')
        serializer = PhotoSuperSimpleSerializer(queryset, many=True)
        return Response({'results': serializer.data})


class RecentlyAddedPhotoListViewSet(viewsets.ModelViewSet):
    serializer_class = PhotoSuperSimpleSerializerWithAddedOnSerpy
    pagination_class = HugeResultsSetPagination

    def get_queryset(self):
        queryset = Photo.visible.filter(Q(owner=self.request.user)).only(
            'image_hash', 'exif_timestamp', 'favorited', 'public','added_on',
            'hidden').order_by('-added_on')
        return queryset

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(RecentlyAddedPhotoListViewSet, self).list(*args, **kwargs)


class SharedToMePhotoSuperSimpleListViewSet(viewsets.ModelViewSet):

    serializer_class = SharedToMePhotoSuperSimpleSerializer
    pagination_class = HugeResultsSetPagination

    def get_queryset(self):
        return Photo.visible.filter(Q(shared_to__id__exact=self.request.user.id)) \
            .only(
                'image_hash',
                'public',
                'favorited',
                'owner',
                'hidden',
                'exif_timestamp',
            ).prefetch_related('owner').order_by('exif_timestamp')


class SharedFromMePhotoSuperSimpleListViewSet(viewsets.ModelViewSet):

    serializer_class = SharedPhotoSuperSimpleSerializerSerpy
    pagination_class = HugeResultsSetPagination

    def get_queryset(self):
        qs = Photo.objects.filter(hidden=False) \
            .prefetch_related('owner') \
            .prefetch_related(
                Prefetch(
                    'shared_to',
                    queryset=User.objects.only(
                        'id',
                        'username',
                        'first_name',
                        'last_name'))) \
            .annotate(shared_to_count=Count('shared_to')) \
            .filter(shared_to_count__gt=0) \
            .filter(owner=self.request.user.id) \
            .only(
                'image_hash',
                'favorited',
                'hidden',
                'exif_timestamp',
                'public',
                'shared_to',
                'owner').distinct().order_by('exif_timestamp')
        return qs


class SharedFromMePhotoSuperSimpleListViewSet2(viewsets.ModelViewSet):

    serializer_class = SharedFromMePhotoThroughSerializer
    pagination_class = HugeResultsSetPagination

    def get_queryset(self):
        ThroughModel = Photo.shared_to.through

        user_photos = Photo.visible.filter(Q(
            owner=self.request.user.id)).only('image_hash')
        qs = ThroughModel.objects.filter(photo_id__in=user_photos) \
            .prefetch_related(Prefetch('user',queryset=User.objects.only(
                'id',
                'username',
                'first_name',
                'last_name'))) \
            .prefetch_related(Prefetch('photo',queryset=Photo.objects.filter(hidden=False).only(
                'image_hash',
                'favorited',
                'hidden',
                'exif_timestamp',
                'public'))).order_by('photo__exif_timestamp')
        return qs


class FavoritePhotoListViewset(viewsets.ModelViewSet):
    serializer_class = PhotoSuperSimpleSerializerSerpy
    pagination_class = HugeResultsSetPagination

    def get_queryset(self):
        return Photo.objects.filter(
            Q(favorited=True) & Q(hidden=False) & Q(owner=self.request.user)).only(
                'image_hash', 'exif_timestamp', 'favorited', 'public',
                'hidden').order_by('-exif_timestamp')

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(FavoritePhotoListViewset, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, request):
        queryset = Photo.objects.filter(
            Q(favorited=True) & Q(hidden=False) & Q(owner=self.request.user)).only(
                'image_hash', 'exif_timestamp', 'favorited', 'public',
                'hidden').order_by('exif_timestamp')
        serializer = PhotoSuperSimpleSerializer(queryset, many=True)
        return Response({'results': serializer.data})

class HiddenPhotoListViewset(viewsets.ModelViewSet):
    serializer_class = PhotoSuperSimpleSerializerSerpy
    pagination_class = HugeResultsSetPagination

    def get_queryset(self):
        return Photo.objects.filter(
            Q(hidden=True) & Q(owner=self.request.user)).only(
                'image_hash', 'exif_timestamp', 'favorited', 'public',
                'hidden').order_by('-exif_timestamp')

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(HiddenPhotoListViewset, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, request):
        queryset = Photo.objects.filter(
            Q(hidden=True) & Q(owner=self.request.user)).only(
                'image_hash', 'exif_timestamp', 'favorited', 'public',
                'hidden').order_by('exif_timestamp')
        serializer = PhotoSuperSimpleSerializer(queryset, many=True)
        return Response({'results': serializer.data})

class PublicPhotoListViewset(viewsets.ModelViewSet):
    serializer_class = PhotoSuperSimpleSerializer
    pagination_class = HugeResultsSetPagination
    permission_classes = (AllowAny, )

    def get_queryset(self):
        if 'username' in self.request.query_params.keys():
            username = self.request.query_params['username']
            return Photo.visible.filter(
                Q(public=True) & Q(owner__username=username)).only(
                    'image_hash', 'exif_timestamp', 'favorited',
                    'hidden').order_by('-exif_timestamp')

        return Photo.visible.filter(Q(public=True)).only(
            'image_hash', 'exif_timestamp', 'favorited',
            'hidden').order_by('-exif_timestamp')

@six.add_metaclass(OptimizeRelatedModelViewSetMetaclass)
class NoTimestampPhotoHashListViewSet(viewsets.ModelViewSet):
    serializer_class = PhotoSuperSimpleSerializerSerpy
    pagination_class = HugeResultsSetPagination
    filter_backends = (filters.SearchFilter, )
    search_fields = ([
        'search_captions', 'search_location', 'faces__person__name'
    ])

    def get_queryset(self):
        return Photo.objects.filter(Q(hidden=False) & Q(exif_timestamp=None) & Q(owner=self.request.user)).order_by('image_path')

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(NoTimestampPhotoHashListViewSet, self).retrieve(
            *args, **kwargs)

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(NoTimestampPhotoHashListViewSet, self).list(
            *args, **kwargs)


@six.add_metaclass(OptimizeRelatedModelViewSetMetaclass)
class FaceListViewSet(viewsets.ModelViewSet):
    serializer_class = FaceListSerializer
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        queryset = Face.objects \
        .filter(Q(photo__hidden=False) & Q(photo__owner=self.request.user)) \
        .select_related('person').order_by('id')

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(FaceListViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(FaceListViewSet, self).list(*args, **kwargs)


@six.add_metaclass(OptimizeRelatedModelViewSetMetaclass)
class FaceInferredListViewSet(viewsets.ModelViewSet):
    serializer_class = FaceListSerializer
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        # Todo: optimze query by only prefetching relevant models & fields
        queryset = Face.objects.filter(
            Q(photo__hidden=False) & Q(photo__owner=self.request.user) & Q(
                person_label_is_inferred=True)).select_related(
                    'person').order_by('id')
        return queryset

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(FaceInferredListViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(FaceInferredListViewSet, self).list(*args, **kwargs)


@six.add_metaclass(OptimizeRelatedModelViewSetMetaclass)
class FaceLabeledListViewSet(viewsets.ModelViewSet):
    serializer_class = FaceListSerializer
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        # Todo: optimze query by only prefetching relevant models & fields
        queryset = Face.objects.filter(
            Q(photo__hidden=False) &
            Q(photo__owner=self.request.user),
            Q(person_label_is_inferred=False)
            |
            Q(person__name='unknown')).select_related('person').order_by('id')
        return queryset

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(FaceLabeledListViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(FaceLabeledListViewSet, self).list(*args, **kwargs)


@six.add_metaclass(OptimizeRelatedModelViewSetMetaclass)
class FaceViewSet(viewsets.ModelViewSet):
    queryset = Face.objects \
        .filter(Q(photo__hidden=False)).prefetch_related('person').order_by('id')
    serializer_class = FaceSerializer
    pagination_class = StandardResultsSetPagination

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(FaceViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(FaceViewSet, self).list(*args, **kwargs)


@six.add_metaclass(OptimizeRelatedModelViewSetMetaclass)
class FaceInferredViewSet(viewsets.ModelViewSet):
    serializer_class = FaceSerializer
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        return Face.objects.filter(
            Q(photo__hidden=False) & Q(photo__owner=self.request.user) & Q(
                person_label_is_inferred=True)).order_by('id')

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(FaceInferredViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(FaceInferredViewSet, self).list(*args, **kwargs)


@six.add_metaclass(OptimizeRelatedModelViewSetMetaclass)
class FaceLabeledViewSet(viewsets.ModelViewSet):
    serializer_class = FaceSerializer
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        return Face.objects.filter(
            Q(photo__hidden=False) & Q(photo__owner=self.request.user) & Q(
                person_label_is_inferred=False)).order_by('id')

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(FaceLabeledViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(FaceLabeledViewSet, self).list(*args, **kwargs)


@six.add_metaclass(OptimizeRelatedModelViewSetMetaclass)
class PersonViewSet(viewsets.ModelViewSet):
    serializer_class = PersonSerializer
    pagination_class = StandardResultsSetPagination
    filter_backends = (filters.SearchFilter, )
    search_fields = (['name'])

    def get_queryset(self):
        qs = Person.objects \
            .filter(Q(faces__photo__hidden=False) & Q(faces__photo__owner=self.request.user)) \
            .distinct() \
            .annotate(viewable_face_count=Count('faces')) \
            .filter(Q(viewable_face_count__gt=0)) \
            .order_by('name')
        return qs

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(PersonViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(PersonViewSet, self).list(*args, **kwargs)


@six.add_metaclass(OptimizeRelatedModelViewSetMetaclass)
class AlbumAutoViewSet(viewsets.ModelViewSet):
    serializer_class = AlbumAutoSerializer
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        return AlbumAuto.objects \
                .annotate(photo_count=Count('photos', filter=Q(photos__hidden=False), distinct=True)) \
                .filter(Q(photo_count__gt=0)&Q(owner=self.request.user)) \
                .prefetch_related(
                    Prefetch('photos',queryset=Photo.objects.filter(hidden=False).only(
                        'image_hash',
                        'public',
                        'favorited',
                        'hidden',
                        'exif_timestamp'
                    ))
                    ) \
                .only('id','title','favorited','timestamp','created_on','gps_lat','gps_lon') \
                .order_by('-timestamp')

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(AlbumAutoViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(AlbumAutoViewSet, self).list(*args, **kwargs)


@six.add_metaclass(OptimizeRelatedModelViewSetMetaclass)
class AlbumAutoListViewSet(viewsets.ModelViewSet):
    serializer_class = AlbumAutoListSerializer
    pagination_class = StandardResultsSetPagination
    filter_backends = (filters.SearchFilter, )
    search_fields = ([
        'photos__search_captions', 'photos__search_location',
        'photos__faces__person__name'
    ])

    def get_queryset(self):
        return AlbumAuto.objects \
            .annotate(photo_count=Count('photos', filter=Q(photos__hidden=False), distinct=True)) \
            .filter(Q(photo_count__gt=0)&Q(owner=self.request.user)) \
            .prefetch_related(
                Prefetch(
                    'photos',
                    queryset=Photo.objects.filter(hidden=False).only(
                        'image_hash',
                        'shared_to',
                        'public',
                        'exif_timestamp',
                        'favorited',
                        'hidden'))
                ) \
            .only('id','title','timestamp','favorited','shared_to') \
            .order_by('-timestamp')

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(AlbumAutoListViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(AlbumAutoListViewSet, self).list(*args, **kwargs)


class SharedToMeAlbumAutoListViewSet(viewsets.ModelViewSet):

    serializer_class = AlbumAutoListSerializer
    pagination_class = HugeResultsSetPagination

    def get_queryset(self):
        return AlbumAuto.objects \
            .annotate(photo_count=Count('photos', filter=Q(photos__hidden=False), distinct=True)) \
            .filter(Q(photo_count__gt=0)&Q(shared_to__id__exact=self.request.user.id)) \
            .filter(owner=self.request.user) \
            .prefetch_related('photos') \
            .order_by('-timestamp')


class SharedFromMeAlbumAutoListViewSet(viewsets.ModelViewSet):

    serializer_class = AlbumAutoListSerializer
    pagination_class = HugeResultsSetPagination

    def get_queryset(self):
        return AlbumAuto.objects \
            .annotate(photo_count=Count('photos', filter=Q(photos__hidden=False), distinct=True)) \
            .filter(Q(photo_count__gt=0) & Q(owner=self.request.user)) \
            .prefetch_related('photos') \
            .order_by('-timestamp') \
            .annotate(shared_to_count=Count('shared_to')) \
            .filter(shared_to_count__gt=0) \
            .filter(owner=self.request.user.id)

@six.add_metaclass(OptimizeRelatedModelViewSetMetaclass)
class AlbumPersonViewSet(viewsets.ModelViewSet):
    serializer_class = AlbumPersonSerializer
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        return Person.objects \
            .annotate(photo_count=Count('faces', filter=Q(faces__photo__hidden=False), distinct=True)) \
            .filter(Q(photo_count__gt=0)) \
            .prefetch_related(
                Prefetch(
                    'faces__photo',
                    queryset=Photo.objects.filter(Q(faces__photo__hidden=False) &
                        Q(owner=self.request.user)).order_by('-exif_timestamp').only(
                            'image_hash', 'exif_timestamp', 'favorited', 'public',
                            'hidden'))).order_by('name')

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(AlbumPersonViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(AlbumPersonViewSet, self).list(*args, **kwargs)


@six.add_metaclass(OptimizeRelatedModelViewSetMetaclass)
class AlbumPersonListViewSet(viewsets.ModelViewSet):
    serializer_class = AlbumPersonListSerializer
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        ipdb.set_trace()

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(AlbumPersonListViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(AlbumPersonListViewSet, self).list(*args, **kwargs)


@six.add_metaclass(OptimizeRelatedModelViewSetMetaclass)
class AlbumDateViewSet(viewsets.ModelViewSet):
    queryset = AlbumDate.objects.all().order_by('-date')
    serializer_class = AlbumDateSerializer
    pagination_class = StandardResultsSetPagination

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(AlbumDateViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(AlbumDateViewSet, self).list(*args, **kwargs)


@six.add_metaclass(OptimizeRelatedModelViewSetMetaclass)
class AlbumDateListViewSet(viewsets.ModelViewSet):
    queryset = AlbumDate.objects.annotate(photo_count=Count('photos', filter=Q(photos__hidden=False), distinct=True)) \
            .filter(Q(photo_count__gt=0)).order_by('-date')
    serializer_class = AlbumDateListSerializer
    pagination_class = StandardResultsSetPagination
    filter_backends = (filters.SearchFilter, )
    search_fields = ([
        'photos__search_captions', 'photos__search_location',
        'photos__faces__person__name'
    ])

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(AlbumDateListViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(AlbumDateListViewSet, self).list(*args, **kwargs)


class AlbumDateListWithPhotoHashViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = AlbumDateListWithPhotoHashSerializerSerpy
    pagination_class = StandardResultsSetPagination
    filter_backends = (filters.SearchFilter, )
    ordering_fields = ('photos__exif_timestamp', )
    search_fields = ([
        'photos__search_captions', 'photos__search_location',
        'photos__faces__person__name'
    ])

    def get_queryset(self):
            qs = AlbumDate.objects \
                .filter(Q(owner=self.request.user) & Q(photos__hidden=False)) \
                .exclude(date=None) \
                .annotate(photo_count=Count('photos')) \
                .filter(Q(photo_count__gt=0)) \
                .order_by('-date') \
                .prefetch_related(
                    Prefetch(
                        'photos',
                        queryset=Photo.visible.filter(Q(owner=self.request.user)).order_by('-exif_timestamp').only(
                            'image_hash',
                            'public',
                            'exif_timestamp',
                            'favorited',
                            'hidden')))
            return qs


    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(AlbumDateListWithPhotoHashViewSet, self).retrieve(
            *args, **kwargs)

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        start = datetime.datetime.now()
        res = super(AlbumDateListWithPhotoHashViewSet, self).list(
            *args, **kwargs)
        elapsed = (datetime.datetime.now() - start).total_seconds()
        logger.info('querying & serializing took %.2f seconds'%elapsed)
        return res



@six.add_metaclass(OptimizeRelatedModelViewSetMetaclass)
class AlbumThingViewSet(viewsets.ModelViewSet):
    serializer_class = AlbumThingSerializer
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        return AlbumThing.objects \
                .filter(Q(owner=self.request.user) & Q(photos__hidden=False)) \
                .annotate(photo_count=Count('photos')) \
                .filter(Q(photo_count__gt=0)) \
                .order_by('title')

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(AlbumThingViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(AlbumThingViewSet, self).list(*args, **kwargs)


@six.add_metaclass(OptimizeRelatedModelViewSetMetaclass)
class AlbumThingListViewSet(viewsets.ModelViewSet):
    serializer_class = AlbumThingListSerializer
    pagination_class = StandardResultsSetPagination
    filter_backends = (filters.SearchFilter, )
    search_fields = (['title'])

    def get_queryset(self):      
        return AlbumThing.objects \
            .filter(Q(owner=self.request.user) & Q(photos__hidden=False)) \
            .annotate(photo_count=Count('photos')) \
            .filter(Q(photo_count__gt=0)) \
            .order_by('-title') \
            .prefetch_related(
                Prefetch(
                    'photos',
                    queryset=Photo.visible.only('image_hash')))
        

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
            return super(AlbumThingListViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
            return super(AlbumThingListViewSet, self).list(*args, **kwargs)


@six.add_metaclass(OptimizeRelatedModelViewSetMetaclass)
class AlbumPlaceViewSet(viewsets.ModelViewSet):
    serializer_class = AlbumPlaceSerializer
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        return AlbumPlace.objects.annotate(photo_count=Count('photos', filter=Q(photos__hidden=False), distinct=True)) \
                .filter(Q(photo_count__gt=0)&Q(owner=self.request.user)) \
                .order_by('title')

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(AlbumPlaceViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(AlbumPlaceViewSet, self).list(*args, **kwargs)


@six.add_metaclass(OptimizeRelatedModelViewSetMetaclass)
class AlbumPlaceListViewSet(viewsets.ModelViewSet):
    serializer_class = AlbumPlaceListSerializer
    pagination_class = StandardResultsSetPagination
    filter_backends = (filters.SearchFilter, )
    search_fields = (['title'])

    def get_queryset(self):
        return AlbumPlace.objects.filter(owner=self.request.user) \
            .annotate(photo_count=Count('photos', filter=Q(photos__hidden=False), distinct=True)) \
            .filter(Q(photo_count__gt=0)&Q(owner=self.request.user)) \
            .order_by('-title') \
            .prefetch_related(
                Prefetch(
                    'photos',
                    queryset=Photo.visible.only('image_hash')))

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(AlbumPlaceListViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(AlbumPlaceListViewSet, self).list(*args, **kwargs)


@six.add_metaclass(OptimizeRelatedModelViewSetMetaclass)
class AlbumUserEditViewSet(viewsets.ModelViewSet):
    serializer_class = AlbumUserEditSerializer
    pagination_class = StandardResultsSetPagination

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(AlbumUserEditViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(AlbumUserEditViewSet, self).list(*args, **kwargs)

    def get_queryset(self):
        return AlbumUser.objects.filter(
            owner=self.request.user).order_by('title')


@six.add_metaclass(OptimizeRelatedModelViewSetMetaclass)
class AlbumUserViewSet(viewsets.ModelViewSet):
    serializer_class = AlbumUserSerializer
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        qs = AlbumUser.objects.filter(
            Q(owner=self.request.user)
            | Q(shared_to__exact=self.request.user.id)).distinct(
                'id').order_by('-id')
        return qs

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(AlbumUserViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(AlbumUserViewSet, self).list(*args, **kwargs)


@six.add_metaclass(OptimizeRelatedModelViewSetMetaclass)
class AlbumUserListViewSet(viewsets.ModelViewSet):
    serializer_class = AlbumUserListSerializer
    pagination_class = StandardResultsSetPagination
    filter_backends = (filters.SearchFilter, )
    search_fields = (['title'])

    def get_queryset(self):
        return AlbumUser.objects.filter(owner=self.request.user) \
            .annotate(photo_count=Count('photos', filter=Q(photos__hidden=False), distinct=True)) \
            .filter(Q(photo_count__gt=0)&Q(owner=self.request.user)) \
            .order_by('-created_on') \
            .prefetch_related(
                Prefetch(
                    'photos',
                    queryset=Photo.visible.only('image_hash')))

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(AlbumUserListViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(AlbumUserListViewSet, self).list(*args, **kwargs)


class SharedToMeAlbumUserListViewSet(viewsets.ModelViewSet):

    serializer_class = AlbumUserListSerializer
    pagination_class = HugeResultsSetPagination

    def get_queryset(self):
        return AlbumUser.objects.filter(
            shared_to__id__exact=self.request.user.id)


class SharedFromMeAlbumUserListViewSet(viewsets.ModelViewSet):

    serializer_class = AlbumUserListSerializer
    pagination_class = HugeResultsSetPagination

    def get_queryset(self):
        return AlbumUser.objects.annotate(shared_to_count=Count('shared_to')) \
            .filter(shared_to_count__gt=0) \
            .filter(owner=self.request.user.id)


class SharedFromMeAlbumUserListViewSet2(viewsets.ModelViewSet):

    serializer_class = AlbumUserListSerializer
    pagination_class = HugeResultsSetPagination

    def get_queryset(self):
        ThroughModel = AlbumUser.shared_to.through

        user_albums = AlbumUser.objects.filter(
            owner=self.request.user.id).only('id')

        qs = ThroughModel.objects.filter(albumuser_id__in=user_albums) \
            .prefetch_related(Prefetch('user',queryset=User.objects.only(
                'id',
                'username',
                'first_name',
                'last_name'))) \
            .prefetch_related(Prefetch('photo',queryset=AlbumUser.objects.only(
                'image_hash',
                'favorited',
                'hidden',
                'exif_timestamp',
                'public')))
        return AlbumUser.objects.annotate(shared_to_count=Count('shared_to')) \
            .filter(shared_to_count__gt=0) \
            .filter(owner=self.request.user.id)


class LongRunningJobViewSet(viewsets.ModelViewSet):
    queryset = LongRunningJob.objects.all().order_by('-started_at')
    serializer_class = LongRunningJobSerializer
    pagination_class = TinyResultsSetPagination


class UserViewSet(viewsets.ModelViewSet):

    serializer_class = UserSerializer

    permission_classes = (
        IsUserOrReadOnly,
        IsAdminUser,
    )

    def get_queryset(self):
        queryset = User.objects.only(
            'id', 'username', 'email', 'scan_directory', 'confidence', 'first_name',
            'last_name', 'date_joined', 'avatar', 'nextcloud_server_address',
            'nextcloud_username', 'nextcloud_scan_directory'
        ).order_by('-last_login')
        return queryset

    def get_permissions(self):
        if self.action == 'create':
            self.permission_classes = (IsRegistrationAllowed, )
        elif self.action == 'list':
            self.permission_classes = (IsAdminUser, )
        elif self.request.method == 'GET' or self.request.method == 'POST':
            self.permission_classes = (AllowAny, )
        else:
            self.permission_classes = (IsUserOrReadOnly, )
        return super(UserViewSet, self).get_permissions()

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(UserViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(UserViewSet, self).list(*args, **kwargs)


class ManageUserViewSet(viewsets.ModelViewSet):
    queryset = User.objects.all().order_by('-last_login')
    serializer_class = ManageUserSerializer
    permission_classes = (IsAdminUser, )

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(ManageUserViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(ManageUserViewSet, self).list(*args, **kwargs)


# API Views

# Views that do things I don't know how to make serializers do

# todo: set limit on number of photos to set public/shared/favorite/hidden at once?
class SiteSettingsView(APIView):
    def get_permissions(self):
        if self.request.method == 'GET':
            self.permission_classes = (AllowAny, )
        else:
            self.permission_classes = (IsAdminUser, )

        return super(SiteSettingsView, self).get_permissions()

    def get(self, request, format=None):
        out = {}
        out['allow_registration'] = site_config.ALLOW_REGISTRATION
        return Response(out)

    def post(self, request, format=None):
        if 'allow_registration' in request.data.keys():
            site_config.ALLOW_REGISTRATION = request.data['allow_registration']

        out = {}
        out['allow_registration'] = site_config.ALLOW_REGISTRATION
        return Response(out)


class SetUserAlbumShared(APIView):
    def post(self, request, format=None):
        data = dict(request.data)
        # print(data)
        shared = data['shared']  #bool
        target_user_id = data['target_user_id']  # user pk, int
        user_album_id = data['album_id']

        try:
            target_user = User.objects.get(id=target_user_id)
        except User.DoesNotExist:
            logger.warning('Cannot share album to user: target user_id {} does not exist'.format(target_user_id))
            return Response(
                {
                    'status': False,
                    'message': "No such user"
                }, status_code=400)

        try:
            user_album_to_share = AlbumUser.objects.get(id=user_album_id)
        except AlbumUser.DoesNotExist:
            logger.warning('Cannot share album to user: source user_album_id {} does not exist'.format(user_album_id))
            return Response(
                {
                    'status': False,
                    'message': "No such album"
                }, status_code=400)

        if user_album_to_share.owner != request.user:
            logger.warning('Cannot share album to user: source user_album_id {} does not belong to user_id {}'.format(user_album_id, request.user.id))
            return Response(
                {
                    'status': False,
                    'message': "You cannot share an album you don't own"
                },
                status_code=400)

        if shared:
            user_album_to_share.shared_to.add(target_user)
            logger.info('Shared user {}\'s album {} to user {}'.format(request.user.id, user_album_id, target_user_id))
        else:
            user_album_to_share.shared_to.remove(target_user)
            logger.info('Unshared user {}\'s album {} to user {}'.format(request.user.id, user_album_id, target_user_id))

        user_album_to_share.save()

        return Response(AlbumUserListSerializer(user_album_to_share).data)


class GeneratePhotoCaption(APIView):
    permission_classes = (IsOwnerOrReadOnly, )

    def post(self, request, format=None):
        data = dict(request.data)
        image_hash = data['image_hash']

        photo = Photo.objects.get(image_hash=image_hash)
        if photo.owner != request.user:
            return Response(
                {
                    'status': False,
                    'message': "you are not the owner of this photo"
                },
                status_code=400)

        res = photo._generate_captions_im2txt()
        return Response({'status': res})


class SetPhotosShared(APIView):
    def post(self, request, format=None):
        data = dict(request.data)
        shared = data['shared']  #bool
        target_user_id = data['target_user_id']  # user pk, int
        image_hashes = data['image_hashes']
        '''
        From https://stackoverflow.com/questions/6996176/how-to-create-an-object-for-a-django-model-with-a-many-to-many-field/10116452#10116452
        # Access the through model directly
        ThroughModel = Sample.users.through

        users = Users.objects.filter(pk__in=[1,2])

        sample_object = Sample()
        sample_object.save()

        ThroughModel.objects.bulk_create([
            ThroughModel(users_id=users[0].pk, sample_id=sample_object.pk),
            ThroughModel(users_id=users[1].pk, sample_id=sample_object.pk)
        ])
        '''

        ThroughModel = Photo.shared_to.through

        if shared:
            already_existing = ThroughModel.objects.filter(
                user_id=target_user_id,
                photo_id__in=image_hashes).only('photo_id')
            already_existing_image_hashes = [
                e.photo_id for e in already_existing
            ]
            # print(already_existing)
            # ipdb.set_trace()
            res = ThroughModel.objects.bulk_create([
                ThroughModel(user_id=target_user_id, photo_id=image_hash)
                for image_hash in image_hashes
                if image_hash not in already_existing_image_hashes
            ])
            logger.info("Shared {}'s {} images to user {}".format(request.user.id, len(res), target_user_id))
            res_count = len(res)
        else:
            res = ThroughModel.objects.filter(
                user_id=target_user_id, photo_id__in=image_hashes).delete()
            logger.info("Unshared {}'s {} images to user {}".format(request.user.id, len(res), target_user_id))
            res_count = res[0]

        return Response({'status': True, 'count': res_count})


class SetPhotosPublic(APIView):
    def post(self, request, format=None):
        data = dict(request.data)
        val_public = data['val_public']
        image_hashes = data['image_hashes']

        updated = []
        not_updated = []
        for image_hash in image_hashes:
            try:
                photo = Photo.objects.get(image_hash=image_hash)
            except Photo.DoesNotExist:
                logger.warning("Could not set photo {} to public. It does not exist.".format(image_hash))
                continue
            if photo.owner == request.user and photo.public != val_public:
                photo.public = val_public
                photo.save()
                updated.append(PhotoSerializer(photo).data)
            else:
                not_updated.append(PhotoSerializer(photo).data)

        if val_public:
            logger.info("{} photos were set public. {} photos were already public.".format(len(updated),len(not_updated)))
        else:
            logger.info("{} photos were set private. {} photos were already public.".format(len(updated),len(not_updated)))

        return Response({
            'status': True,
            'results': updated,
            'updated': updated,
            'not_updated': not_updated
        })


class SetPhotosFavorite(APIView):
    def post(self, request, format=None):
        data = dict(request.data)
        val_favorite = data['favorite']
        image_hashes = data['image_hashes']

        updated = []
        not_updated = []
        for image_hash in image_hashes:
            try:
                photo = Photo.objects.get(image_hash=image_hash)
            except Photo.DoesNotExist:
                logger.warning("Could not set photo {} to favorite. It does not exist.".format(image_hash))
                continue
            if photo.owner == request.user and photo.favorited != val_favorite:
                photo.favorited = val_favorite
                photo.save()
                updated.append(PhotoSerializer(photo).data)
            else:
                not_updated.append(PhotoSerializer(photo).data)

        if val_favorite:
            logger.info("{} photos were added to favorites. {} photos were already in favorites.".format(len(updated),len(not_updated)))
        else:
            logger.info("{} photos were removed from favorites. {} photos were already not in favorites.".format(len(updated),len(not_updated)))
        return Response({
            'status': True,
            'results': updated,
            'updated': updated,
            'not_updated': not_updated
        })


class SetPhotosHidden(APIView):
    def post(self, request, format=None):
        data = dict(request.data)
        val_hidden = data['hidden']
        image_hashes = data['image_hashes']

        updated = []
        not_updated = []
        for image_hash in image_hashes:
            try:
                photo = Photo.objects.get(image_hash=image_hash)
            except Photo.DoesNotExist:
                logger.warning("Could not set photo {} to hidden. It does not exist.".format(image_hash))
                continue
            if photo.owner == request.user and photo.hidden != val_hidden:
                photo.hidden = val_hidden
                photo.save()
                updated.append(PhotoSerializer(photo).data)
            else:
                not_updated.append(PhotoSerializer(photo).data)

        if val_hidden:
            logger.info("{} photos were set hidden. {} photos were already hidden.".format(len(updated),len(not_updated)))
        else:
            logger.info("{} photos were set unhidden. {} photos were already unhidden.".format(len(updated),len(not_updated)))
        return Response({
            'status': True,
            'results': updated,
            'updated': updated,
            'not_updated': not_updated
        })


class SetFacePersonLabel(APIView):
    def post(self, request, format=None):
        data = dict(request.data)
        # ipdb.set_trace()
        person = get_or_create_person(name=data['person_name'])
        faces = Face.objects.in_bulk(data['face_ids'])

        updated = []
        not_updated = []
        for face in faces.values():
            if face.photo.owner == request.user:
                face.person = person
                face.person_label_is_inferred = False
                face.person_label_probability = 1.
                face.save()
                updated.append(FaceListSerializer(face).data)
            else:
                not_updated.append(FaceListSerializer(face).data)

        return Response({
            'status': True,
            'results': updated,
            'updated': updated,
            'not_updated': not_updated
        })
        # ipdb.set_trace()


class DeleteFaces(APIView):
    def post(self, request, format=None):
        data = dict(request.data)
        faces = Face.objects.in_bulk(data['face_ids'])

        deleted = []
        not_deleted = []
        for face in faces.values():
            if face.photo.owner == request.user:
                deleted.append(face.id)
                face.delete()
            else:
                not_deleted.append(face.id)

        return Response({
            'status': True,
            'results': deleted,
            'not_deleted': not_deleted,
            'deleted': deleted
        })


# Utility views


class RootPathTreeView(APIView):
    permission_classes = (IsAdminUser, )

    def get(self, request, format=None):
        try:
            res = [path_to_dict(p) for p in config.image_dirs]
            return Response(res)
        except Exception as e:
            logger.exception(str(e))
            return Response({'message':str(e)})


class SearchTermExamples(APIView):
    def get(self, request, format=None):
        search_term_examples = get_search_term_examples(request.user)
        return Response({"results": search_term_examples})






class FaceToLabelView(APIView):
    def get(self, request, format=None):
        # return a single face for labeling

        qs = Face.objects.filter(person_label_probability__gt=0).filter(
            person_label_probability__lt=1).order_by(
                'person_label_probability')
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
            distance = np.linalg.norm(labeled_faces_mean - face_encoding)
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
            data = {'results': []}
        return Response(data)


class ClusterFaceView(APIView):
    # @cache_response(CACHE_TTL_VIZ)
    def get(self, request, format=None):
        res = cluster_faces(request.user)
        return Response(res)




class SocialGraphView(APIView):
    # @cache_response(CACHE_TTL_VIZ)
    def get(self, request, format=None):
        res = build_social_graph(request.user)
        return Response(res)


class EgoGraphView(APIView):
    # @cache_response(CACHE_TTL_VIZ)
    def get(self, request, format=None):
        res = build_ego_graph(request.GET['person_id'])
        return Response(res)




class StatsView(APIView):
    def get(self, request, format=None):
        res = get_count_stats(user=request.user)
        return Response(res)


class LocationClustersView(APIView):
    # @cache_response(CACHE_TTL_VIZ)
    def get(self, request, format=None):
        res = get_location_clusters(request.user)
        return Response(res)


class LocationSunburst(APIView):
    # @cache_response(CACHE_TTL_VIZ)
    def get(self, request, format=None):
        res = get_location_sunburst(request.user)
        return Response(res)


class LocationTimeline(APIView):
    # @cache_response(CACHE_TTL_VIZ)
    def get(self, request, format=None):
        res = get_location_timeline(request.user)
        return Response(res)


class PhotoMonthCountsView(APIView):
    # @cache_response(CACHE_TTL_VIZ)
    def get(self, request, format=None):
        res = get_photo_month_counts(request.user)
        return Response(res)


class PhotoCountryCountsView(APIView):
    # @cache_response(CACHE_TTL_VIZ)
    def get(self, request, format=None):
        res = get_photo_country_counts(request.user)
        return Response(res)


class SearchTermWordCloudView(APIView):
    # @cache_response(CACHE_TTL_VIZ)
    def get(self, request, format=None):
        res = get_searchterms_wordcloud(request.user)
        return Response(res)

class SearchSimilarPhotosView(APIView):
    permission_classes = (IsAuthenticated, )

    def get(self,request,format=None):
        image_hash = request.query_params['image_hash']
        res = search_similar_image(request.user, Photo.objects.get(image_hash=image_hash))
        return Response({'results':[ {'image_hash':e} for e in res['result'] if image_hash is not e]})


# long running jobs
class ScanPhotosView(APIView):
    def get(self, request, format=None):
        try:
            job_id = uuid.uuid4()
            scan_photos(request.user, job_id)
            return Response({'status': True, 'job_id': job_id})
        except BaseException as e:
            logger.exception("An Error occured")
            return Response({'status': False})


class RegenerateAutoAlbumTitles(APIView):
    def get(self, request, format=None):
        try:
            job_id = uuid.uuid4()
            regenerate_event_titles(user=request.user, job_id = job_id)
            return Response({'status': True, 'job_id':  job_id })
        except BaseException as e:
            logger.error(str(e))
            return Response({'status': False})


class AutoAlbumGenerateView(APIView):
    def get(self, request, format=None):
        try:
            job_id = uuid.uuid4()
            generate_event_albums(user=request.user, job_id= job_id)
            return Response({'status': True, 'job_id': job_id})
        except BaseException as e:
            logger.error(str(e))
            return Response({'status': False})


class TrainFaceView(APIView):
    def get(self, request, format=None):
        try:
            job_id = uuid.uuid4
            train_faces(user=request.user, job_id=job_id)
            return Response({'status': True, 'job_id': job_id})
        except BaseException as e:
            logger.error(str(e))
            return Response({'status': False})

# watchers
class IsPhotosBeingAddedView(APIView):
    def get(self, request, format=None):
        res = is_photos_being_added()
        return Response(res)


class IsAutoAlbumsBeingProcessed(APIView):
    def get(self, request, format=None):
        res = is_auto_albums_being_processed()
        return Response(res)


class QueueAvailabilityView(APIView):
    def get(self, request, format=None):
        job_detail = None

        running_job = LongRunningJob.objects.filter(
            finished=False).order_by('-started_at').first()
        if running_job:
            job_detail = LongRunningJobSerializer(running_job).data

        return Response({
            'status': True,
            'queue_can_accept_job': job_detail is None,
            'job_detail': job_detail
        })



class ListAllRQJobsView(APIView):
    def get(self,request,format=None):
        try:
            all_jobs = django_rq.get_queue().all()
            logger.info(str(all_jobs))
        except BaseException as e:
            logger.error(str(e))
        return Response({})


class RQJobStatView(APIView):
    def get(self, request, format=None):
        # ipdb.set_trace()
        job_id = request.query_params['job_id']
        # job_id = '1667f947-bf8c-4ca8-a1cc-f16c7f3615de'
        is_job_finished = django_rq.get_queue().fetch_job(job_id).is_finished
        return Response({'status': True, 'finished': is_job_finished})


from rest_framework_simplejwt.tokens import AccessToken
from rest_framework_simplejwt.exceptions import TokenError
import time


class MediaAccessView(APIView):
    permission_classes = (AllowAny, )
    
    # @silk_profile(name='media')
    def get(self, request, path, fname, format=None):
        if False: # allow all images to be viewable by everyone
            response = HttpResponse()
            response['Content-Type'] = 'image/jpeg'
            response[
                'X-Accel-Redirect'] = "/protected_media/" + path + '/' + fname
            return response
        start = datetime.datetime.now()

        jwt = request.COOKIES.get('jwt')
        image_hash = fname.split(".")[0].split('_')[0]
        try:
            photo = Photo.objects.get(image_hash=image_hash)
        except Photo.DoesNotExist:
            return HttpResponse(status=404)

        # grant access if the requested photo is public
        if photo.public:
            response = HttpResponse()
            response['Content-Type'] = 'image/jpeg'
            response[
                'X-Accel-Redirect'] = "/protected_media/" + path + '/' + fname
            # print((datetime.datetime.now() - start).total_seconds())
            return response

        # forbid access if trouble with jwt
        if jwt is not None:
            try:
                token = AccessToken(jwt)
            except TokenError as error:
                return HttpResponseForbidden()
        else:
            return HttpResponseForbidden()

        # grant access if the user is owner of the requested photo
        # or the photo is shared with the user
        image_hash = fname.split(".")[0].split('_')[0]  # janky alert
        query_start = datetime.datetime.now()
        user = User.objects.filter(id=token['user_id']).only('id').first()
        # print('query', (datetime.datetime.now() - query_start).total_seconds())
        if photo.owner == user or user in photo.shared_to.all():
            response = HttpResponse()
            response['Content-Type'] = 'image/jpeg'
            response[
                'X-Accel-Redirect'] = "/protected_media/" + path + '/' + fname
            # print('response', (datetime.datetime.now() - start).total_seconds())
            return response
        else:
            for album in photo.albumuser_set.only('shared_to'):
                if user in album.shared_to.all():
                    response = HttpResponse()
                    response['Content-Type'] = 'image/jpeg'
                    response[
                        'X-Accel-Redirect'] = "/protected_media/" + path + '/' + fname
                    # print((datetime.datetime.now() - start).total_seconds())
                    return response
        return HttpResponse(status=404)



class MediaAccessFullsizeOriginalView(APIView):
    permission_classes = (AllowAny, )
    
    # @silk_profile(name='media')
    def get(self, request, path, fname, format=None):
        if False: # allow all images to be viewable by everyone
            response = HttpResponse()
            response['Content-Type'] = 'image/jpeg'
            response[
                'X-Accel-Redirect'] = "/protected_media/" + path + '/' + fname
            return response

        if path.lower() != 'photos':
            start = datetime.datetime.now()

            jwt = request.COOKIES.get('jwt')
            image_hash = fname.split(".")[0].split('_')[0]
            try:
                photo = Photo.objects.get(image_hash=image_hash)
            except Photo.DoesNotExist:
                return HttpResponse(status=404)

            # grant access if the requested photo is public
            if photo.public:
                response = HttpResponse()
                response['Content-Type'] = 'image/jpeg'
                response[
                    'X-Accel-Redirect'] = "/protected_media/" + path + '/' + fname
                # print((datetime.datetime.now() - start).total_seconds())
                return response

            # forbid access if trouble with jwt
            if jwt is not None:
                try:
                    token = AccessToken(jwt)
                except TokenError as error:
                    return HttpResponseForbidden()
            else:
                return HttpResponseForbidden()

            # grant access if the user is owner of the requested photo
            # or the photo is shared with the user
            image_hash = fname.split(".")[0].split('_')[0]  # janky alert
            query_start = datetime.datetime.now()
            user = User.objects.filter(id=token['user_id']).only('id').first()
            # print('query', (datetime.datetime.now() - query_start).total_seconds())
            if photo.owner == user or user in photo.shared_to.all():
                response = HttpResponse()
                response['Content-Type'] = 'image/jpeg'
                response[
                    'X-Accel-Redirect'] = "/protected_media/" + path + '/' + fname
                # print('response', (datetime.datetime.now() - start).total_seconds())
                return response
            else:
                for album in photo.albumuser_set.only('shared_to'):
                    if user in album.shared_to.all():
                        response = HttpResponse()
                        response['Content-Type'] = 'image/jpeg'
                        response[
                            'X-Accel-Redirect'] = "/protected_media/" + path + '/' + fname
                        # print((datetime.datetime.now() - start).total_seconds())
                        return response
            return HttpResponse(status=404)
        else:
            start = datetime.datetime.now()

            jwt = request.COOKIES.get('jwt')
            image_hash = fname.split(".")[0].split('_')[0]
            try:
                photo = Photo.objects.get(image_hash=image_hash)
            except Photo.DoesNotExist:
                return HttpResponse(status=404)


            if photo.image_path.startswith('/code/nextcloud_media/'):
                internal_path = photo.image_path.replace('/code/nextcloud_media/','/nextcloud_original/')
                internal_path = '/nextcloud_original'+photo.image_path[21:]
            if photo.image_path.startswith('/data/'):
                internal_path = '/original'+photo.image_path[5:]

            # grant access if the requested photo is public
            if photo.public:
                response = HttpResponse()
                response['Content-Type'] = 'image/jpeg'
                response[
                    'X-Accel-Redirect'] = internal_path
                # print((datetime.datetime.now() - start).total_seconds())
                return response

            # forbid access if trouble with jwt
            if jwt is not None:
                try:
                    token = AccessToken(jwt)
                except TokenError as error:
                    return HttpResponseForbidden()
            else:
                return HttpResponseForbidden()

            # grant access if the user is owner of the requested photo
            # or the photo is shared with the user
            image_hash = fname.split(".")[0].split('_')[0]  # janky alert
            query_start = datetime.datetime.now()
            user = User.objects.filter(id=token['user_id']).only('id').first()
            # print('query', (datetime.datetime.now() - query_start).total_seconds())
            if photo.owner == user or user in photo.shared_to.all():
                response = HttpResponse()
                response['Content-Type'] = 'image/jpeg'
                response[
                    'X-Accel-Redirect'] = internal_path
                # print('response', (datetime.datetime.now() - start).total_seconds())
                return response
            else:
                for album in photo.albumuser_set.only('shared_to'):
                    if user in album.shared_to.all():
                        response = HttpResponse()
                        response['Content-Type'] = 'image/jpeg'
                        response[
                            'X-Accel-Redirect'] = internal_path
                        # print((datetime.datetime.now() - start).total_seconds())
                        return response
            return HttpResponse(status=404)




def media_access(request, path):
    # ipdb.set_trace()
    """
    When trying to access :
    myproject.com/media/uploads/passport.png

    If access is authorized, the request will be redirected to
    myproject.com/protected/media/uploads/passport.png

    This special URL will be handle by nginx we the help of X-Accel
    """
    ipdb.set_trace()

    access_granted = False

    user = request.user
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
