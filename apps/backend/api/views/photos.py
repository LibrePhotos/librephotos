
from api.views.serializers_serpy import PigPhotoSerilizer
from api.views.pagination import HugeResultsSetPagination
from rest_framework import viewsets
from django.db.models import Q
from rest_framework_extensions.cache.decorators import cache_response
from api.views.caching import CustomListKeyConstructor, CACHE_TTL
from api.models import Photo


class RecentlyAddedPhotoListViewSet(viewsets.ModelViewSet):
    serializer_class = PigPhotoSerilizer 
    pagination_class = HugeResultsSetPagination

    def get_queryset(self):
        queryset = Photo.visible.filter(Q(owner=self.request.user)).only(
            'image_hash', 'exif_timestamp', 'favorited', 'public','added_on',
            'hidden').order_by('-added_on')
        return queryset

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(RecentlyAddedPhotoListViewSet, self).list(*args, **kwargs)