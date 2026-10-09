from django.core.cache import cache
from drf_spectacular.utils import OpenApiParameter, OpenApiTypes, extend_schema
from rest_framework.response import Response
from rest_framework.views import APIView

from api.api_util import get_search_term_examples
from api.filters import SemanticSearchFilter
from api.models import Photo
from api.serializers.photos import (
    GroupedPhotosSerializer,
    PhotoSummarySerializer,
    with_photo_summary_relations,
)
from api.serializers.PhotosGroupedByDate import get_photos_ordered_by_date
from api.views.custom_api_view import ListViewSet
from api.views.pagination import HugeResultsSetPagination

# The date of the undated group in search results. The other grouped lists send
# null, but the web and mobile search schemas require a string here, and null
# would fail the whole search in mobile apps already installed. Switch to null
# once a mobile release that accepts it has shipped.
LEGACY_UNDATED_DATE = "No timestamp"


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
        # The helper loads the stacks, files and local_orientation the summary
        # serializer reads; without them every match cost three more queries.
        photos = with_photo_summary_relations(Photo.visible.owned_by(request.user))
        if request.user.semantic_search_topk == 0:
            queryset = self.filter_queryset(photos.order_by("-exif_timestamp"))
            grouped_photos = get_photos_ordered_by_date(
                queryset, undated_date=LEGACY_UNDATED_DATE
            )
            serializer = GroupedPhotosSerializer(grouped_photos, many=True)
            return Response({"results": serializer.data})
        else:
            queryset = self.filter_queryset(photos)
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
