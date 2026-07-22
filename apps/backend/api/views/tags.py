from django.db.models import Prefetch, Q
from drf_spectacular.utils import OpenApiParameter, OpenApiTypes, extend_schema
from rest_framework import filters, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from api.models import Photo, Tag
from api.serializers.tag import (
    GroupedTagPhotosSerializer,
    TagListSerializer,
    TagSerializer,
)
from api.views.pagination import StandardResultsSetPagination
from api.views.photos import _get_photo_filter_kwargs


class TagViewSet(viewsets.ModelViewSet):
    """List, create, rename, delete and merge user-defined tags.

    Every queryset is scoped to ``request.user``: another account's tag id has
    to behave exactly like an id that does not exist.
    """

    serializer_class = TagSerializer
    pagination_class = StandardResultsSetPagination
    permission_classes = [IsAuthenticated]
    filter_backends = (filters.SearchFilter,)
    search_fields = ["name"]

    def get_queryset(self):
        if self.request.user.is_anonymous:
            return Tag.objects.none()

        queryset = Tag.objects.filter(owner=self.request.user)

        photo = self.request.query_params.get("photo")
        if photo:
            queryset = queryset.filter(
                **{
                    f"photos__{field}": value
                    for field, value in _get_photo_filter_kwargs(photo).items()
                }
            )

        if self.action == "list":
            cover_photos = Photo.objects.filter(hidden=False).only(
                "image_hash", "video"
            )
            queryset = queryset.prefetch_related(
                Prefetch("photos", queryset=cover_photos[:4], to_attr="cover_photos")
            )
        elif self.action == "retrieve":
            queryset = queryset.prefetch_related(
                Prefetch(
                    "photos",
                    queryset=Photo.visible.order_by("-exif_timestamp"),
                )
            )

        return queryset.order_by("name")

    def get_serializer_class(self):
        if self.action == "list":
            return TagListSerializer
        if self.action == "retrieve":
            return GroupedTagPhotosSerializer
        return TagSerializer

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)

    def _resolve_photos(self, request):
        """Resolve the request's photo ids/hashes to photos the user owns."""
        identifiers = request.data.get("photos")
        if not isinstance(identifiers, list) or not identifiers:
            return None

        ids = []
        hashes = []
        for identifier in identifiers:
            filter_kwargs = _get_photo_filter_kwargs(str(identifier))
            if "pk" in filter_kwargs:
                ids.append(filter_kwargs["pk"])
            else:
                hashes.append(filter_kwargs["image_hash"])

        return Photo.objects.filter(
            Q(pk__in=ids) | Q(image_hash__in=hashes), owner=request.user
        )

    @extend_schema(
        parameters=[OpenApiParameter("photo", OpenApiTypes.STR)],
        description=(
            "List the requesting user's tags. Pass photo=<id or image hash> to "
            "only get the tags attached to that photo."
        ),
    )
    def list(self, *args, **kwargs):
        return super().list(*args, **kwargs)

    def retrieve(self, request, *args, **kwargs):
        serializer = GroupedTagPhotosSerializer(
            self.get_object(), context={"request": request}
        )
        return Response({"results": serializer.data})

    @extend_schema(
        description="Attach photos to this tag.",
        responses={200: TagSerializer},
    )
    @action(detail=True, methods=["post"], url_path="add")
    def add_photos(self, request, pk=None):
        tag = self.get_object()
        photos = self._resolve_photos(request)
        if photos is None:
            return Response(
                {"error": "No photos provided"}, status=status.HTTP_400_BAD_REQUEST
            )

        tag.photos.add(*photos)
        return Response(TagSerializer(tag).data)

    @extend_schema(
        description="Detach photos from this tag.",
        responses={200: TagSerializer},
    )
    @action(detail=True, methods=["post"], url_path="remove")
    def remove_photos(self, request, pk=None):
        tag = self.get_object()
        photos = self._resolve_photos(request)
        if photos is None:
            return Response(
                {"error": "No photos provided"}, status=status.HTTP_400_BAD_REQUEST
            )

        tag.photos.remove(*photos)
        return Response(TagSerializer(tag).data)

    @extend_schema(
        description=(
            "Merge another tag into this one: its photos move over and the "
            "merged tag is deleted."
        ),
        responses={200: TagSerializer},
    )
    @action(detail=True, methods=["post"], url_path="merge")
    def merge(self, request, pk=None):
        tag = self.get_object()
        source_id = request.data.get("tag")
        if source_id is None:
            return Response(
                {"error": "No tag provided"}, status=status.HTTP_400_BAD_REQUEST
            )

        try:
            source = Tag.objects.filter(pk=source_id, owner=request.user).first()
        except (TypeError, ValueError):
            source = None
        if source is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        if source.pk == tag.pk:
            return Response(
                {"error": "A tag cannot be merged into itself"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        tag.photos.add(*source.photos.all())
        source.delete()
        return Response(TagSerializer(tag).data)
