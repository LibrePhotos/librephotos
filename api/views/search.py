from django.db.models import Prefetch, Q
from rest_framework import viewsets
from rest_framework.response import Response

from api.filters import SemanticSearchFilter
from api.models import Photo, User
from api.serializers.PhotosGroupedByDate import get_photos_ordered_by_date
from api.serializers.serializers_serpy import GroupedPhotosSerializer, PigPhotoSerilizer
from api.views.pagination import HugeResultsSetPagination


class SearchListViewSet(viewsets.ModelViewSet):
    serializer_class = GroupedPhotosSerializer
    pagination_class = HugeResultsSetPagination
    filter_backends = (SemanticSearchFilter,)

    search_fields = [
        "search_captions",
        "search_location",
        "faces__person__name",
        "exif_timestamp",
        "image_paths",
        # To-Do: Allow searching for videos
    ]

    def get_queryset(self):
        return Photo.visible.filter(Q(owner=self.request.user)).order_by(
            "-exif_timestamp"
        )

    def retrieve(self, *args, **kwargs):
        return super(SearchListViewSet, self).retrieve(*args, **kwargs)

    def list(self, request):
        if request.user.semantic_search_topk == 0:
            queryset = self.filter_queryset(
                Photo.visible.filter(Q(owner=self.request.user))
                .prefetch_related(
                    Prefetch(
                        "owner",
                        queryset=User.objects.only(
                            "id", "username", "first_name", "last_name"
                        ),
                    ),
                )
                .order_by("-exif_timestamp")
            )
            grouped_photos = get_photos_ordered_by_date(queryset)
            serializer = GroupedPhotosSerializer(grouped_photos, many=True)
            return Response({"results": serializer.data})
        else:
            queryset = self.filter_queryset(
                Photo.visible.filter(Q(owner=self.request.user)).prefetch_related(
                    Prefetch(
                        "owner",
                        queryset=User.objects.only(
                            "id", "username", "first_name", "last_name"
                        ),
                    ),
                )
            )
            serializer = PigPhotoSerilizer(queryset, many=True)
            return Response({"results": serializer.data})
