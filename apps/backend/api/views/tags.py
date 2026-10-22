import uuid
from collections.abc import Callable, Iterable
from typing import Any

from django.db.models import Prefetch, Q, QuerySet
from drf_spectacular.utils import extend_schema
from rest_framework import filters, mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.serializers import BaseSerializer

from api.drf.pagination import DefaultPagination
from api.drf.params import parse_body, parse_query
from api.drf.request_user import request_user
from api.metadata import edits
from api.models import Photo, Tag
from api.models.user import User
from api.photos.selection import build_photo_queryset
from api.serializers.tag import (
    GroupedTagPhotosSerializer,
    TagCreateRequest,
    TagListQuery,
    TagListSerializer,
    TagMergeRequest,
    TagPhotosRequest,
    TagSerializer,
)
from api.views.albums import _with_photo_summary_relations
from api.views.mixins import PartialUpdateModelMixin
from api.views.photos import _get_photo_filter_kwargs

# A select-all tag edit can cover a whole library, so the links are written in
# batches instead of one statement over every row. Small selections still take
# a single pass, so nothing changes for a handful of photos.
PHOTO_LINK_BATCH_SIZE = 2000


class TagViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    PartialUpdateModelMixin[Tag],
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """List, create, rename, delete and merge user-defined tags.

    Every queryset is scoped to ``request.user``: another account's tag id has
    to behave exactly like an id that does not exist.
    """

    serializer_class = TagSerializer
    pagination_class = DefaultPagination
    permission_classes = [IsAuthenticated]
    filter_backends = (filters.SearchFilter,)
    search_fields = ["name"]

    def get_queryset(self) -> QuerySet[Tag]:
        user = self.request.user
        if not isinstance(user, User):
            return Tag.objects.none()

        queryset = Tag.objects.owned_by(user)

        if self.action == "list":
            # "Tags of this photo" on the list only: on a tag album's detail
            # ?photo=true is the Photos media filter, and reading it as an
            # image hash 404'd the album.
            photo = parse_query(self.request, TagListQuery).get("photo")
            if photo:
                queryset = queryset.filter(
                    **{
                        f"photos__{field}": value
                        for field, value in _get_photo_filter_kwargs(photo).items()
                    }
                ).distinct()

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

    def get_serializer_class(
        self,
    ) -> (
        type[TagListSerializer] | type[GroupedTagPhotosSerializer] | type[TagSerializer]
    ):
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
    def create(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        name = parse_body(request, TagCreateRequest)["name"]
        existing = Tag.objects.owned_by(request_user(request)).filter(name=name).first()
        if existing is not None:
            return Response(TagSerializer(existing).data)
        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer: BaseSerializer[Tag]) -> None:
        serializer.save(owner=request_user(self.request))

    def _resolve_photos(self, request: Request) -> list[Photo] | QuerySet[Photo] | None:
        """Resolve the request's photos to the ones the user owns.

        Either an explicit list of ids/hashes, or ``select_all=True`` plus the
        ``query`` describing the photoset on screen -- the same payload the
        bulk favourite/hide/delete endpoints take, so tagging a whole filtered
        view does not depend on the client enumerating every hash first.

        An id the requester does not own is a 404 rather than a silent no-op:
        answering 200 for an empty queryset had the UI report a save that never
        happened.
        """
        data = parse_body(request, TagPhotosRequest)
        if data["select_all"]:
            return self._select_all_photos(request, data)

        identifiers = data.get("photos")
        if not identifiers:
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
            Photo.objects.owned_by(request_user(request)).filter(
                Q(pk__in=ids) | Q(image_hash__in=hashes)
            )
        )
        resolved = {str(photo.pk) for photo in photos}
        resolved.update(photo.image_hash for photo in photos)
        if not (ids | hashes) <= resolved:
            raise NotFound("Unknown photo")

        return photos

    def _select_all_photos(
        self, request: Request, data: dict[str, Any]
    ) -> QuerySet[Photo]:
        """The photos behind a ``select_all`` payload, as a lazy queryset."""
        excluded_hashes = data["excluded_hashes"] or []

        photos = build_photo_queryset(request_user(request), data["query"])
        if excluded_hashes:
            photos = photos.exclude(image_hash__in=excluded_hashes)
        return photos

    @staticmethod
    def _link_photos(
        relation_method: Callable[..., None],
        photos: list[Photo] | QuerySet[Photo],
    ) -> list[uuid.UUID]:
        """Add or remove ``photos`` on a tag's m2m, a batch at a time.

        Takes primary keys rather than instances so a select-all edit never
        loads the whole photoset into memory. Returns the keys, for the
        write-back of the edit.
        """
        pks: Iterable[uuid.UUID]
        if isinstance(photos, list):
            pks = [photo.pk for photo in photos]
        else:
            pks = photos.values_list("pk", flat=True).iterator(
                chunk_size=PHOTO_LINK_BATCH_SIZE
            )

        linked: list[uuid.UUID] = []
        batch: list[uuid.UUID] = []
        for pk in pks:
            batch.append(pk)
            if len(batch) == PHOTO_LINK_BATCH_SIZE:
                relation_method(*batch)
                linked.extend(batch)
                batch = []
        if batch:
            relation_method(*batch)
            linked.extend(batch)
        return linked

    @staticmethod
    def _photo_ids(tag: Tag) -> list[uuid.UUID]:
        return list(tag.photos.values_list("pk", flat=True))

    def perform_update(self, serializer: BaseSerializer[Tag]) -> None:
        """Rename the tag; its photos' files follow when they are written to."""
        tag = serializer.instance
        assert tag is not None
        old_name = tag.name
        renamed = serializer.save()
        if renamed.name != old_name:
            edits.tags_changed(
                request_user(self.request),
                self._photo_ids(renamed),
                [old_name, renamed.name],
            )

    def perform_destroy(self, instance: Tag) -> None:
        """Delete the tag; it leaves its photos' files when they are written to."""
        photo_ids = self._photo_ids(instance)
        name = instance.name
        instance.delete()
        edits.tags_changed(request_user(self.request), photo_ids, [name])

    @extend_schema(
        parameters=[TagListQuery],
        description=(
            "List the requesting user's tags. Pass photo=<id or image hash> to "
            "only get the tags attached to that photo."
        ),
    )
    def list(self, *args: Any, **kwargs: Any) -> Response:
        return super().list(*args, **kwargs)

    def retrieve(self, request: Request, *args: Any, **kwargs: Any) -> Response:
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
        request=TagPhotosRequest,
        responses={200: TagSerializer},
    )
    @action(detail=True, methods=["post"], url_path="add")
    def add_photos(self, request: Request, pk: str | None = None) -> Response:
        tag = self.get_object()
        photos = self._resolve_photos(request)
        if photos is None:
            raise ValidationError("No photos provided")

        linked = self._link_photos(tag.photos.add, photos)
        edits.tags_changed(request_user(request), linked, [tag.name])
        return Response(TagSerializer(tag).data)

    @extend_schema(
        description=(
            "Detach photos from this tag. Takes the same explicit `photos` "
            "list or `select_all` payload as the add action."
        ),
        request=TagPhotosRequest,
        responses={200: TagSerializer},
    )
    @action(detail=True, methods=["post"], url_path="remove")
    def remove_photos(self, request: Request, pk: str | None = None) -> Response:
        tag = self.get_object()
        photos = self._resolve_photos(request)
        if photos is None:
            raise ValidationError("No photos provided")

        unlinked = self._link_photos(tag.photos.remove, photos)
        edits.tags_changed(request_user(request), unlinked, [tag.name])
        return Response(TagSerializer(tag).data)

    @extend_schema(
        description=(
            "Merge another tag into this one: its photos move over and the "
            "merged tag is deleted."
        ),
        request=TagMergeRequest,
        responses={200: TagSerializer},
    )
    @action(detail=True, methods=["post"], url_path="merge")
    def merge(self, request: Request, pk: str | None = None) -> Response:
        tag = self.get_object()
        source_id = parse_body(request, TagMergeRequest)["tag"]
        source = (
            Tag.objects.owned_by(request_user(request)).filter(pk=source_id).first()
        )
        if source is None:
            raise NotFound()
        if source.pk == tag.pk:
            raise ValidationError("A tag cannot be merged into itself")

        photo_ids = self._photo_ids(source)
        tag.photos.add(*source.photos.all())
        source.delete()
        edits.tags_changed(request_user(request), photo_ids, [source.name, tag.name])
        return Response(TagSerializer(tag).data)
