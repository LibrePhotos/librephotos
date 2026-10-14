from typing import Any

from django.core.cache import cache
from django.db.models import QuerySet
from drf_spectacular.utils import OpenApiParameter, OpenApiTypes, extend_schema
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from api.drf.params import parse_query
from api.drf.request_user import request_user, scope_user
from api.models import Photo
from api.search.filters import SemanticSearchFilter
from api.search.metadata_filter import MetadataFilterQuery, metadata_values
from api.search.term_examples import get_search_term_examples
from api.serializers.photos import (
    GroupedPhotosSerializer,
    PhotoSummarySerializer,
    SearchResultsSerializer,
    with_photo_summary_relations,
)
from api.serializers.PhotosGroupedByDate import get_photos_ordered_by_date
from api.serializers.search import (
    MetadataValuesQuery,
    MetadataValuesSerializer,
    SearchTermExamplesSerializer,
)
from api.views.custom_api_view import ListViewSet

# The date of the undated group in search results. The other grouped lists send
# null, but the web and mobile search schemas require a string here, and null
# would fail the whole search in mobile apps already installed. Switch to null
# once a mobile release that accepts it has shipped.
LEGACY_UNDATED_DATE = "No timestamp"


class SearchListViewSet(ListViewSet):
    """Every match in one answer: grouped by date, or the semantic top k."""

    permission_classes = (IsAuthenticated,)
    serializer_class = GroupedPhotosSerializer
    pagination_class = None
    filter_backends = (SemanticSearchFilter,)

    search_fields = [
        "search_instance__search_captions",
        "search_instance__search_location",
        "tags__name",
        "exif_timestamp",
    ]

    def get_queryset(self) -> QuerySet[Photo]:
        return Photo.visible.owned_by(scope_user(self.request)).order_by(
            "-exif_timestamp"
        )

    @extend_schema(
        parameters=[
            OpenApiParameter("search", OpenApiTypes.STR),
            OpenApiParameter("video", OpenApiTypes.BOOL),
            OpenApiParameter("photo", OpenApiTypes.BOOL),
            OpenApiParameter("is_screenshot", OpenApiTypes.BOOL),
            OpenApiParameter("is_document", OpenApiTypes.BOOL),
            MetadataFilterQuery,
        ],
        description=(
            "Search photos and videos. Pass video=true to return only videos "
            "or photo=true to return only photos. The structured filters "
            "(camera, lens, exposure ranges, rating, capture days, location, "
            "file type, people) narrow the results with or without a search "
            "term; a bad value is a 400 naming the parameter. With semantic "
            "search on (the user's semantic_search_topk), results is a flat "
            "list of photo summaries instead of date groups."
        ),
        responses=SearchResultsSerializer,
    )
    def list(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        # The helper loads the stacks, files and local_orientation the summary
        # serializer reads; without them every match cost three more queries.
        user = request_user(request)
        photos = with_photo_summary_relations(Photo.visible.owned_by(user))
        if user.semantic_search_topk == 0:
            queryset = self.filter_queryset(photos.order_by("-exif_timestamp"))
            grouped_photos = get_photos_ordered_by_date(
                queryset, undated_date=LEGACY_UNDATED_DATE
            )
            serializer = GroupedPhotosSerializer(grouped_photos, many=True)
            return Response({"results": serializer.data})
        else:
            queryset = self.filter_queryset(photos)
            summary_serializer = PhotoSummarySerializer(queryset, many=True)
            return Response({"results": summary_serializer.data})


class MetadataValuesView(APIView):
    """The cameras, makers or lenses of the requester's photos, for the
    suggestions of the search filters: each distinct value with its photo
    count, most photos first, in one answer (a library has few)."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(parameters=[MetadataValuesQuery], responses=MetadataValuesSerializer)
    def get(self, request: Request) -> Response:
        field = parse_query(request, MetadataValuesQuery)["field"]
        return Response({"results": metadata_values(request_user(request), field)})


SEARCH_TERM_EXAMPLES_CACHE_SECONDS = 60 * 60 * 2


class SearchTermExamples(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(responses=SearchTermExamplesSerializer)
    def get(self, request: Request, format: str | None = None) -> Response:
        # The examples are built from the caller's own photos, people and places,
        # so the cache is keyed on the user. cache_page + vary_on_cookie keyed
        # it on the request instead, which says nothing about who a
        # header-authenticated client is.
        user = request_user(request)
        cache_key = f"search_term_examples:{user.pk}"
        search_term_examples = cache.get(cache_key)
        if search_term_examples is None:
            search_term_examples = get_search_term_examples(user)
            cache.set(
                cache_key, search_term_examples, SEARCH_TERM_EXAMPLES_CACHE_SECONDS
            )
        return Response({"results": search_term_examples})
