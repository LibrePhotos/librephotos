from django.db.models import Prefetch, Q
from rest_framework.response import Response

from api.filters import SemanticSearchFilter
from api.models import File, Photo, User
from api.serializers.photos import GroupedPhotosSerializer, PhotoSummarySerializer
from api.serializers.PhotosGroupedByDate import get_photos_ordered_by_date
from api.views.custom_api_view import ListViewSet
from api.views.pagination import HugeResultsSetPagination


class SearchListViewSet(ListViewSet):
    serializer_class = GroupedPhotosSerializer
    pagination_class = HugeResultsSetPagination
    filter_backends = (SemanticSearchFilter,)

    search_fields = [
        "search_captions",
        "search_location",
        "exif_timestamp",
    ]

    def get_queryset(self):
        return Photo.visible.filter(Q(owner=self.request.user)).order_by(
            "-exif_timestamp"
        )

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
                    Prefetch(
                        "main_file__embedded_media",
                        queryset=File.objects.only("hash"),
                    ),
                )
                .order_by("-exif_timestamp")
                .only(
                    "image_hash",
                    "aspect_ratio",
                    "video",
                    "main_file",
                    "search_location",
                    "dominant_color",
                    "public",
                    "rating",
                    "hidden",
                    "exif_timestamp",
                    "owner",
                    "video_length",
                )
            )
            grouped_photos = get_photos_ordered_by_date(queryset)
            serializer = GroupedPhotosSerializer(grouped_photos, many=True)
            return Response({"results": serializer.data})
        else:
            queryset = self.filter_queryset(
                Photo.visible.filter(Q(owner=self.request.user))
                .prefetch_related(
                    Prefetch(
                        "owner",
                        queryset=User.objects.only(
                            "id", "username", "first_name", "last_name"
                        ),
                    ),
                    Prefetch(
                        "main_file__embedded_media",
                        queryset=File.objects.only("hash"),
                    ),
                )
                .only(
                    "image_hash",
                    "aspect_ratio",
                    "video",
                    "main_file",
                    "search_location",
                    "dominant_color",
                    "public",
                    "rating",
                    "hidden",
                    "exif_timestamp",
                    "owner",
                    "video_length",
                )
            )
            serializer = PhotoSummarySerializer(queryset, many=True)
            return Response({"results": serializer.data})
