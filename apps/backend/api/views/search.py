from django.core.cache import cache
from django.db.models import Prefetch
from drf_spectacular.utils import OpenApiParameter, OpenApiTypes, extend_schema
from rest_framework.response import Response
from rest_framework.views import APIView

from api.api_util import get_search_term_examples
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
        "search_instance__search_captions",
        "search_instance__search_location",
        "tags__name",
        "exif_timestamp",
    ]

    def get_queryset(self):
        return Photo.visible.owned_by(self.request.user).order_by("-exif_timestamp")

    @extend_schema(
        parameters=[
            OpenApiParameter("search", OpenApiTypes.STR),
            OpenApiParameter("video", OpenApiTypes.BOOL),
            OpenApiParameter("photo", OpenApiTypes.BOOL),
            OpenApiParameter("is_screenshot", OpenApiTypes.BOOL),
            OpenApiParameter("is_document", OpenApiTypes.BOOL),
        ],
        description=(
            "Search photos and videos. Pass video=true to return only videos "
            "or photo=true to return only photos."
        ),
    )
    def list(self, request):
        if request.user.semantic_search_topk == 0:
            queryset = self.filter_queryset(
                Photo.visible.owned_by(self.request.user)
                .select_related("thumbnail", "search_instance", "main_file")
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
                    "thumbnail__aspect_ratio",
                    "thumbnail__dominant_color",
                    "video",
                    "main_file",
                    "search_instance__search_location",
                    "public",
                    "rating",
                    "hidden",
                    "exif_timestamp",
                    "owner",
                    "video_length",
                    "exif_gps_lat",
                    "exif_gps_lon",
                    "removed",
                    "in_trashcan",
                )
            )
            grouped_photos = get_photos_ordered_by_date(queryset)
            serializer = GroupedPhotosSerializer(grouped_photos, many=True)
            return Response({"results": serializer.data})
        else:
            queryset = self.filter_queryset(
                Photo.visible.owned_by(self.request.user)
                .select_related("thumbnail", "search_instance", "main_file")
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
                    "thumbnail__aspect_ratio",
                    "thumbnail__dominant_color",
                    "video",
                    "main_file",
                    "search_instance__search_location",
                    "public",
                    "rating",
                    "hidden",
                    "exif_timestamp",
                    "owner",
                    "video_length",
                    "exif_gps_lat",
                    "exif_gps_lon",
                    "removed",
                    "in_trashcan",
                )
            )
            serializer = PhotoSummarySerializer(queryset, many=True)
            return Response({"results": serializer.data})


SEARCH_TERM_EXAMPLES_CACHE_SECONDS = 60 * 60 * 2


class SearchTermExamples(APIView):
    def get(self, request, format=None):
        # The examples are built from the caller's own photos, people and places,
        # so the cache is keyed on the user. cache_page + vary_on_cookie keyed
        # it on the request instead, which says nothing about who a
        # header-authenticated client is.
        cache_key = f"search_term_examples:{request.user.pk}"
        search_term_examples = cache.get(cache_key)
        if search_term_examples is None:
            search_term_examples = get_search_term_examples(request.user)
            cache.set(
                cache_key, search_term_examples, SEARCH_TERM_EXAMPLES_CACHE_SECONDS
            )
        return Response({"results": search_term_examples})
