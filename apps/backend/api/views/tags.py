import uuid

from django.db.models import Prefetch, Q
from drf_spectacular.utils import OpenApiParameter, OpenApiTypes, extend_schema
from rest_framework import filters, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from api.models import Photo, Tag
from api.serializers.tag import (
    GroupedTagPhotosSerializer,
    TagListSerializer,
    TagSerializer,
)
from api.views.albums import _with_photo_summary_relations
from api.views.pagination import StandardResultsSetPagination
from api.views.photo_filters import build_photo_queryset
from api.views.photos import _get_photo_filter_kwargs

# A select-all tag edit can cover a whole library, so the links are written in
# batches instead of one statement over every row. Small selections still take
# a single pass, so nothing changes for a handful of photos.
PHOTO_LINK_BATCH_SIZE = 2000


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
            # The same photos the detail action serves: a tile must not cover
            # itself with a trashed photo whose file is already gone.
            cover_photos = Photo.visible.only("image_hash", "video")
            queryset = queryset.prefetch_related(
                Prefetch("photos", queryset=cover_photos[:4], to_attr="cover_photos")
            )
        elif self.action == "retrieve":
            queryset = queryset.prefetch_related(
                Prefetch(
                    "photos",
                    queryset=_with_photo_summary_relations(
                        Photo.visible.order_by("-exif_timestamp")
                    ),
                )
            )

        return queryset.order_by("name")

    def get_serializer_class(self):
        if self.action == "list":
            return TagListSerializer
        if self.action == "retrieve":
            return GroupedTagPhotosSerializer
        return TagSerializer

    @extend_schema(
        description=(
            "Create a tag. A name the account already uses answers with the "
            "existing tag instead of failing, so a client that cannot see the "
            "whole (paginated) tag list still ends up with one tag."
        ),
        responses={200: TagSerializer, 201: TagSerializer},
    )
    def create(self, request, *args, **kwargs):
        name = str(request.data.get("name") or "").strip()
        existing = Tag.objects.filter(name=name, owner=request.user).first()
        if existing is not None:
            return Response(TagSerializer(existing).data)
        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)

    def _resolve_photos(self, request):
        """Resolve the request's photos to the ones the user owns.

        Either an explicit list of ids/hashes, or ``select_all=True`` plus the
        ``query`` describing the photoset on screen -- the same payload the
        bulk favourite/hide/delete endpoints take, so tagging a whole filtered
        view does not depend on the client enumerating every hash first.

        An id the requester does not own is a 404 rather than a silent no-op:
        answering 200 for an empty queryset had the UI report a save that never
        happened.
        """
        if request.data.get("select_all"):
            return self._select_all_photos(request)

        identifiers = request.data.get("photos")
        if not isinstance(identifiers, list) or not identifiers:
            return None

        ids = set()
        hashes = set()
        for identifier in identifiers:
            filter_kwargs = _get_photo_filter_kwargs(str(identifier))
            if "pk" in filter_kwargs:
                ids.add(str(uuid.UUID(filter_kwargs["pk"])))
            else:
                hashes.add(filter_kwargs["image_hash"])

        photos = list(
            Photo.objects.filter(
                Q(pk__in=ids) | Q(image_hash__in=hashes), owner=request.user
            )
        )
        resolved = {str(photo.pk) for photo in photos}
        resolved.update(photo.image_hash for photo in photos)
        if not (ids | hashes) <= resolved:
            raise NotFound("Unknown photo")

        return photos

    def _select_all_photos(self, request):
        """The photos behind a ``select_all`` payload, as a lazy queryset."""
        query = request.data.get("query")
        excluded_hashes = request.data.get("excluded_hashes") or []

        photos = build_photo_queryset(
            request.user, query if isinstance(query, dict) else {}
        )
        # build_photo_queryset does not scope to the requester when
        # query.public is set, so bind the write target to the requester's own
        # photos -- the same guard the bulk photo endpoints carry (issue
        # #1982). Without it a public photoset would let one account hang its
        # tags on another account's photos.
        photos = photos.filter(owner=request.user)
        if excluded_hashes:
            photos = photos.exclude(image_hash__in=excluded_hashes)
        return photos

    @staticmethod
    def _link_photos(relation_method, photos):
        """Add or remove ``photos`` on a tag's m2m, a batch at a time.

        Takes primary keys rather than instances so a select-all edit never
        loads the whole photoset into memory.
        """
        if isinstance(photos, list):
            pks = [photo.pk for photo in photos]
        else:
            pks = photos.values_list("pk", flat=True).iterator(
                chunk_size=PHOTO_LINK_BATCH_SIZE
            )

        batch = []
        for pk in pks:
            batch.append(pk)
            if len(batch) == PHOTO_LINK_BATCH_SIZE:
                relation_method(*batch)
                batch = []
        if batch:
            relation_method(*batch)

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
        description=(
            "Attach photos to this tag: either an explicit `photos` list of "
            "ids/image hashes, or `select_all: true` with the `query` "
            "describing the photoset on screen and optional `excluded_hashes`."
        ),
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

        self._link_photos(tag.photos.add, photos)
        return Response(TagSerializer(tag).data)

    @extend_schema(
        description=(
            "Detach photos from this tag. Takes the same explicit `photos` "
            "list or `select_all` payload as the add action."
        ),
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

        self._link_photos(tag.photos.remove, photos)
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
