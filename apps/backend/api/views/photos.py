import six
from api.views.serializers_serpy import PigPhotoSerilizer, GroupedPhotosSerializer
from api.views.pagination import HugeResultsSetPagination
from constance import config as site_config
from rest_framework import filters, viewsets
from django.db.models import Q
from rest_framework_extensions.cache.decorators import cache_response
from api.views.caching import CustomListKeyConstructor, CustomObjectKeyConstructor, CACHE_TTL
from api.models import Photo, User
from rest_framework.response import Response
from api.views.PhotosGroupedByDate import get_photos_ordered_by_date
from api.drf_optimize import OptimizeRelatedModelViewSetMetaclass
from rest_framework.permissions import AllowAny

class RecentlyAddedPhotoListViewSet(viewsets.ModelViewSet):
    serializer_class = PigPhotoSerilizer 
    pagination_class = HugeResultsSetPagination

    def get_queryset(self):
        latestDate = Photo.visible.filter(Q(owner=self.request.user)).only('added_on').order_by('-added_on').first().added_on
        queryset = Photo.visible.filter(Q(owner=self.request.user) & Q(aspect_ratio__isnull=False) & Q(added_on__year=latestDate.year, added_on__month=latestDate.month, added_on__day=latestDate.day)).only(
            'image_hash', 'exif_timestamp', 'rating', 'public','added_on',
            'hidden').order_by('-added_on')
        return queryset

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        queryset = self.get_queryset()
        latestDate = Photo.visible.filter(Q(owner=self.request.user)).only('added_on').order_by('-added_on').first().added_on
        serializer = PigPhotoSerilizer(queryset, many=True)
        return Response({'date': latestDate, 'results': serializer.data})

class FavoritePhotoListViewset(viewsets.ModelViewSet):
    serializer_class = PigPhotoSerilizer
    pagination_class = HugeResultsSetPagination

    def get_queryset(self):
        user = User.objects.get(username=self.request.user)
        return Photo.objects.filter(
            Q(rating__gte=user.favorite_min_rating) & Q(hidden=False) & Q(owner=self.request.user)).only(
                'image_hash', 'exif_timestamp', 'rating', 'public',
                'hidden').order_by('-exif_timestamp')

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(FavoritePhotoListViewset, self).retrieve(*args, **kwargs)

    def list(self, request):
        queryset = self.get_queryset()
        grouped_photos = get_photos_ordered_by_date(queryset)
        serializer = GroupedPhotosSerializer(grouped_photos, many=True)
        return Response({'results': serializer.data})

class HiddenPhotoListViewset(viewsets.ModelViewSet):
    serializer_class = PigPhotoSerilizer
    pagination_class = HugeResultsSetPagination

    def get_queryset(self):
        return Photo.objects.filter(
            Q(hidden=True) & Q(owner=self.request.user)).only(
                'image_hash', 'exif_timestamp', 'rating', 'public',
                'hidden').order_by('-exif_timestamp')

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(HiddenPhotoListViewset, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, request):
        queryset = self.get_queryset()
        grouped_photos = get_photos_ordered_by_date(queryset)
        serializer = GroupedPhotosSerializer(grouped_photos, many=True)
        return Response({'results': serializer.data})

class PublicPhotoListViewset(viewsets.ModelViewSet):
    serializer_class = PigPhotoSerilizer
    pagination_class = HugeResultsSetPagination
    permission_classes = (AllowAny, )

    def get_queryset(self):
        if 'username' in self.request.query_params.keys():
            username = self.request.query_params['username']
            return Photo.visible.filter(
                Q(public=True) & Q(owner__username=username)).only(
                    'image_hash', 'exif_timestamp', 'rating',
                    'hidden').order_by('-exif_timestamp')

        return Photo.visible.filter(Q(public=True)).only(
            'image_hash', 'exif_timestamp', 'rating',
            'hidden').order_by('-exif_timestamp')

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(PublicPhotoListViewset, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, request):
        queryset = self.get_queryset()
        grouped_photos = get_photos_ordered_by_date(queryset)
        serializer = GroupedPhotosSerializer(grouped_photos, many=True)
        return Response({'results': serializer.data})

@six.add_metaclass(OptimizeRelatedModelViewSetMetaclass)
class NoTimestampPhotoHashListViewSet(viewsets.ModelViewSet):
    serializer_class = PigPhotoSerilizer
    pagination_class = HugeResultsSetPagination
    filter_backends = (filters.SearchFilter, )
    search_fields = ([
        'search_captions', 'search_location', 'faces__person__name'
    ])

    def get_queryset(self):
        return Photo.visible.filter(Q(exif_timestamp=None) & Q(owner=self.request.user)).order_by('image_paths')

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(NoTimestampPhotoHashListViewSet, self).retrieve(
            *args, **kwargs)

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(NoTimestampPhotoHashListViewSet, self).list(
            *args, **kwargs)

