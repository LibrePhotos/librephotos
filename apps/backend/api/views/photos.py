import logging
import os
import uuid
from collections import defaultdict
from typing import Any

from django.db.models import Prefetch, Q, QuerySet
from django.http import FileResponse
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, OpenApiTypes, extend_schema
from rest_framework import filters, mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import (
    APIException,
    NotFound,
    PermissionDenied,
    ValidationError,
)
from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from api.accounts.permissions import IsOwnerOrReadOnly, IsPhotoOrAlbumSharedTo
from api.albums.timeline_filter import timeline_filter_q
from api.classification import captioning
from api.drf.exceptions import ServiceUnavailable
from api.drf.pagination import (
    DefaultPagination,
    PhotoGridPagination,
    WholeListPagination,
)
from api.drf.params import parse_body, parse_query
from api.drf.request_user import request_user, scope_user
from api.metadata import edits
from api.metadata.photo_writer import (
    rotate_photo,
    write_photo_metadata,
    write_target,
)
from api.metadata.writer import MetadataWriteError, one_exiftool_process
from api.mime import mime_type
from api.models import AlbumUser, Face, Photo, User
from api.models.album_thing import (
    album_thing_ids_for_photos,
    refresh_album_thing_photo_counts,
)
from api.models.person import Person
from api.models.photo_caption import PhotoCaption
from api.models.tag import refresh_tag_photo_counts, tag_ids_for_photos
from api.photos.files import remove_photo
from api.runtime.features import feature_enabled
from api.runtime.ml_models import (
    captioning_model_exists,
    captioning_model_selected,
    start_model_download,
)
from api.serializers.album_user import (
    AlbumUserListSerializer,
    with_album_user_list_relations,
)
from api.serializers.photos import (
    PhotoCaptionRequest,
    PhotoDetailsSummarySerializer,
    PhotoEditSerializer,
    PhotoMediaQuery,
    PhotoSelectionRequest,
    PhotoSerializer,
    PhotoSummarySerializer,
    RecentlyAddedPhotosSerializer,
    RotatePhotoRequest,
    SaveMetadataRequest,
    SavePhotoCaptionRequest,
    SetMainFileRequest,
    SetPhotosCategoryRequest,
    SetPhotosDeletedRequest,
    SetPhotosFavoriteRequest,
    SetPhotosHiddenRequest,
    SetPhotosPublicRequest,
    SetPhotosRatingRequest,
    SetPhotosSharedRequest,
    with_photo_summary_relations,
)
from api.views.custom_api_view import ListViewSet

logger = logging.getLogger(__name__)

# How long a client waits before asking for a caption again while the
# captioning model downloads (the Retry-After of the 503).
CAPTION_MODEL_RETRY_AFTER_SECONDS = 60


def _get_photo_filter_kwargs(lookup_value: str) -> dict[str, str]:
    """Return filter kwargs for looking up a photo by UUID or image_hash.

    UUID format is 36 chars with 4 hyphens (e.g. 123e4567-e89b-12d3-a456-426614174000).
    Image hash is a 32-char MD5 hex string (backward compatibility).
    """
    is_uuid_format = len(lookup_value) == 36 and lookup_value.count("-") == 4
    if is_uuid_format:
        try:
            uuid.UUID(lookup_value)  # validate; raises ValueError if malformed
            return {"pk": lookup_value}
        except (ValueError, AttributeError):
            pass
    return {"image_hash": lookup_value}


def _get_owned_photo(image_hash: str, user: User) -> Photo | None:
    """Return the user's photo for ``image_hash``, or None if there is none."""
    try:
        return Photo.objects.owned_by(user).get(image_hash=image_hash)
    except Photo.DoesNotExist:
        return None
    except Photo.MultipleObjectsReturned:
        return Photo.objects.owned_by(user).filter(image_hash=image_hash).first()


def _detect_content_type(path: str) -> str:
    """Return the MIME type of a file, falling back to a generic binary type."""
    try:
        return mime_type(path)
    except Exception:
        return "application/octet-stream"


def _media_filtered_photos(request: Request) -> QuerySet[Photo]:
    """The requester's visible photos narrowed by the ``PhotoMediaQuery`` flags.

    Only the explicit flags are read, so a saved timeline default (which
    applies to ``/`` only) never filters these lists.
    """
    media = parse_query(request, PhotoMediaQuery)
    return Photo.visible.owned_by(scope_user(request)).filter(
        *timeline_filter_q(request.user, media)
    )


class RecentlyAddedPhotoListViewSet(ListViewSet):
    """Every photo added on the day of the latest upload, in one answer.

    With a media filter, the day is the latest upload day of a matching photo.
    """

    permission_classes = (IsAuthenticated,)
    serializer_class = PhotoSummarySerializer
    pagination_class = None

    def get_queryset(self) -> QuerySet[Photo]:
        latest_photo = self._get_latest_photo()
        if latest_photo is None:
            return Photo.objects.none()
        latest_date = latest_photo.added_on

        return with_photo_summary_relations(
            _media_filtered_photos(self.request).filter(
                Q(thumbnail__aspect_ratio__isnull=False)
                & Q(added_on__date=latest_date.date())
            )
        ).order_by("-added_on")

    @extend_schema(
        parameters=[PhotoMediaQuery], responses=RecentlyAddedPhotosSerializer
    )
    def list(self, *args: Any, **kwargs: Any) -> Response:
        queryset = self.get_queryset()
        latest_photo = self._get_latest_photo()
        latest_date = latest_photo.added_on if latest_photo else None
        serializer = PhotoSummarySerializer(queryset, many=True)
        return Response({"date": latest_date, "results": serializer.data})

    def _get_latest_photo(self) -> Photo | None:
        if not hasattr(self, "_latest_photo"):
            self._latest_photo = (
                _media_filtered_photos(self.request)
                .only("added_on")
                .order_by("-added_on")
                .first()
            )
        return self._latest_photo


class NoTimestampPhotoViewSet(ListViewSet):
    """The photos without a capture time, first added first, a page at a time."""

    permission_classes = (IsAuthenticated,)
    serializer_class = PhotoSummarySerializer
    pagination_class = DefaultPagination
    filter_backends = (filters.SearchFilter,)
    search_fields = [
        "search_instance__search_captions",
        "search_instance__search_location",
        "faces__person__name",
    ]

    def get_queryset(self) -> QuerySet[Photo]:
        return with_photo_summary_relations(
            _media_filtered_photos(self.request).filter(exif_timestamp=None)
        ).order_by("added_on")

    @extend_schema(parameters=[PhotoMediaQuery])
    def list(self, *args: Any, **kwargs: Any) -> Response:
        return super().list(*args, **kwargs)


class BulkPhotoMutationView(APIView):
    """Set one flag on many of the requester's photos in a single UPDATE.

    The body carries the new value under ``value_field`` and names the photos
    either as ``image_hashes`` or as ``select_all`` with a ``query`` (and
    optional ``excluded_hashes``) for ``build_photo_queryset``. Only photos the
    requester owns are touched. A subclass declares the field, which photos
    the value would change (``differs``) and the columns it sets
    (``new_values``).

    The answer is ``count`` (photos changed) and, for ``image_hashes``, the
    hashes that changed and those that already had the value. It used to carry
    a full ``PhotoSerializer`` payload per photo, whose ``similar_photos`` asks
    the similarity sidecar over HTTP: one call per photo, inside the request.
    """

    permission_classes = (IsAuthenticated,)

    #: The body: the photo selection plus ``value_field``. drf-spectacular
    #: documents the request from it.
    serializer_class: type[PhotoSelectionRequest]
    #: Request key carrying the new value. Each subclass sets it.
    value_field: str
    #: The flag's name in the missing-photo warning ("set photo X to ...").
    flag_name: str
    #: What happened to a photo, by new value, for log lines.
    past_tense = {True: "changed", False: "changed"}
    #: Hiding or trashing a photo takes it out of its tags' and thing albums'
    #: counts, and a queryset UPDATE fires no signal to say so.
    refreshes_tag_counts = False
    #: In ``select_all`` mode, touch (and count) only photos whose state
    #: differs rather than every photo the query matches.
    select_all_only_changed = False

    def differs(self, user: User, value: object) -> Q:
        """A ``Q`` matching the photos that ``value`` would change."""
        raise NotImplementedError

    def new_values(self, user: User, value: object) -> dict[str, object]:
        """The columns to UPDATE, besides ``last_modified``."""
        raise NotImplementedError

    def apply(self, user: User, photos: QuerySet[Photo], value: object) -> int:
        """UPDATE ``photos`` to ``value``; return the number of rows changed."""
        if self.refreshes_tag_counts:
            affected_tag_ids = tag_ids_for_photos(photos)
            affected_thing_ids = album_thing_ids_for_photos(photos)
        count = photos.update(
            **self.new_values(user, value), last_modified=timezone.now()
        )
        if self.refreshes_tag_counts:
            refresh_tag_photo_counts(affected_tag_ids)
            refresh_album_thing_photo_counts(affected_thing_ids)
        return count

    @extend_schema(responses={200: OpenApiTypes.OBJECT})
    def post(self, request: Request, format: str | None = None) -> Response:
        user = request_user(request)
        # The value is a JSON boolean unless the subclass's serializer says
        # otherwise: a string is refused rather than read by truthiness, since
        # "false" would otherwise trash or hide photos.
        data = parse_body(request, self.serializer_class)
        value = data[self.value_field]
        if data["select_all"]:
            self.check_select_all(value)
            return self._post_select_all(user, data, value)
        return self._post_hashes(user, data["image_hashes"], value)

    def check_select_all(self, value: object) -> None:
        """Hook: raise ``ValidationError`` if ``value`` may not be applied by
        select_all."""

    def _post_select_all(
        self, user: User, data: dict[str, Any], value: object
    ) -> Response:
        from api.photos.selection import build_photo_queryset

        photos = build_photo_queryset(user, data["query"])
        excluded_hashes = data["excluded_hashes"]
        if excluded_hashes:
            photos = photos.exclude(image_hash__in=excluded_hashes)
        if self.select_all_only_changed:
            photos = photos.filter(self.differs(user, value))

        count = self.apply(user, photos, value)
        logger.info(
            "%s photos were %s via select_all for user %s.",
            count,
            self.past_tense[bool(value)],
            user.id,
        )
        return Response({"status": True, "count": count})

    def _post_hashes(
        self, user: User, image_hashes: list[str], value: object
    ) -> Response:
        owned = Photo.objects.owned_by(user).filter(image_hash__in=image_hashes)
        found = set(owned.values_list("image_hash", flat=True))
        changing = set(
            owned.filter(self.differs(user, value)).values_list("image_hash", flat=True)
        )
        requested = list(dict.fromkeys(image_hashes))
        updated_hashes = [h for h in requested if h in changing]
        not_updated_hashes = [h for h in requested if h in found - changing]

        if updated_hashes:
            self.apply(
                user,
                Photo.objects.owned_by(user).filter(image_hash__in=updated_hashes),
                value,
            )

        for missing_hash in set(requested) - found:
            logger.warning(
                "Could not set photo %s to %s. "
                "It does not exist or is not owned by user.",
                missing_hash,
                self.flag_name,
            )
        logger.info(
            "%s photos were %s. %s photos already were.",
            len(updated_hashes),
            self.past_tense[bool(value)],
            len(not_updated_hashes),
        )
        return Response(
            {
                "status": True,
                "count": len(updated_hashes),
                "updated_hashes": updated_hashes,
                "not_updated_hashes": not_updated_hashes,
            }
        )


class SetPhotosDeleted(BulkPhotoMutationView):
    serializer_class = SetPhotosDeletedRequest
    value_field = "deleted"
    flag_name = "deleted"
    past_tense = {True: "moved to trash", False: "restored from trash"}
    refreshes_tag_counts = True

    def differs(self, user: User, value: object) -> Q:
        return ~Q(in_trashcan=value)

    def new_values(self, user: User, value: object) -> dict[str, object]:
        return {"in_trashcan": value}


class RatingMutationView(BulkPhotoMutationView):
    """A bulk mutation that sets ``rating``: through ``edits.set_rating``,
    which records the edit history and writes the rating to disk."""

    def apply(self, user: User, photos: QuerySet[Photo], value: object) -> int:
        rating = self.new_values(user, value)["rating"]
        assert isinstance(rating, int)
        return edits.set_rating(photos, rating, user)


class SetPhotosFavorite(RatingMutationView):
    serializer_class = SetPhotosFavoriteRequest
    value_field = "favorite"
    flag_name = "favorite"
    past_tense = {True: "added to favorites", False: "removed from favorites"}
    select_all_only_changed = True

    def differs(self, user: User, value: object) -> Q:
        if value:
            return Q(rating__lt=user.favorite_min_rating)
        return Q(rating__gte=user.favorite_min_rating)

    def new_values(self, user: User, value: object) -> dict[str, object]:
        return {"rating": user.favorite_min_rating if value else 0}


class SetPhotosRating(RatingMutationView):
    """Give photos a star rating from 0 (none) to 5.

    The mobile app's star row sets any rating, which ``favorite`` (the
    favorite threshold or 0) cannot express, and ``PATCH /photos/edit/``
    ignores ``rating`` on purpose. Takes ``image_hashes`` only: no client
    rates a whole query at once.
    """

    serializer_class = SetPhotosRatingRequest
    value_field = "rating"
    flag_name = "rating"
    past_tense = {True: "rated", False: "unrated"}
    MAX_RATING = 5

    def check_select_all(self, value: object) -> None:
        raise ValidationError({"select_all": "Rating takes image_hashes only."})

    def differs(self, user: User, value: object) -> Q:
        return ~Q(rating=value)

    def new_values(self, user: User, value: object) -> dict[str, object]:
        return {"rating": value}


class SetPhotosHidden(BulkPhotoMutationView):
    serializer_class = SetPhotosHiddenRequest
    value_field = "hidden"
    flag_name = "hidden"
    past_tense = {True: "set hidden", False: "set unhidden"}
    refreshes_tag_counts = True

    def differs(self, user: User, value: object) -> Q:
        return ~Q(hidden=value)

    def new_values(self, user: User, value: object) -> dict[str, object]:
        return {"hidden": value}


class SetPhotosPublic(BulkPhotoMutationView):
    serializer_class = SetPhotosPublicRequest
    value_field = "val_public"
    flag_name = "public"
    past_tense = {True: "set public", False: "set private"}

    def differs(self, user: User, value: object) -> Q:
        return ~Q(public=value)

    def new_values(self, user: User, value: object) -> dict[str, object]:
        return {"public": value}


class SetPhotosCategory(BulkPhotoMutationView):
    """Mark photos as a photo, a screenshot or a document, or reset them.

    Fixes a wrong automatic category. The categories are exclusive here, and
    the photos are pinned with ``category_source="user"`` so neither a rescan
    nor the Classify Media job overwrites the choice. ``category: "auto"``
    hands the photos back to the detectors: ``category_source`` goes back to
    ``"auto"`` and both flags are recomputed the way Classify Media computes
    them (the lightbox's Undo of a first correction). ``category_source`` is
    never taken from the client.
    """

    serializer_class = SetPhotosCategoryRequest
    value_field = "category"
    flag_name = "category"
    past_tense = {True: "recategorized", False: "recategorized"}
    select_all_only_changed = True
    AUTO = "auto"
    #: (is_screenshot, is_document) for each category.
    CATEGORY_FLAGS = {
        "photo": (False, False),
        "screenshot": (True, False),
        "document": (False, True),
    }

    def new_values(self, user: User, value: object) -> dict[str, object]:
        # The serializer only lets category names through, and new_values is never
        # called for "auto".
        assert isinstance(value, str)
        is_screenshot, is_document = self.CATEGORY_FLAGS[value]
        return {
            "is_screenshot": is_screenshot,
            "is_document": is_document,
            "category_source": "user",
        }

    def check_select_all(self, value: object) -> None:
        # The reset runs the detectors per photo, inside the request: fine for
        # the lightbox's Undo of one photo, not for a whole library.
        if value == self.AUTO:
            raise ValidationError(
                {self.value_field: '"auto" takes image_hashes, not select_all.'}
            )

    def differs(self, user: User, value: object) -> Q:
        if value == self.AUTO:
            # A photo still on automatic already has the detectors' flags.
            return ~Q(category_source="auto")
        changes = ~Q(**self.new_values(user, value))
        if value != "photo":
            # A video is never made a screenshot or a document: the lightbox
            # offers it no category, and a select-all "Mark as document" on
            # the timeline would otherwise hide every video for good. "photo"
            # (and "auto") still reach videos, to clear a wrong flag.
            changes &= Q(video=False)
        return changes

    def apply(self, user: User, photos: QuerySet[Photo], value: object) -> int:
        if value != self.AUTO:
            return super().apply(user, photos, value)
        # Per photo, as Classify Media does it: both detectors are DB-only
        # heuristics (no sidecar call, no file read). Without an OCR row the
        # document detector has no evidence, so the photo is not a document.
        from api.directory_watcher.processing_jobs import detect_media_category

        now = timezone.now()
        reset: list[Photo] = []
        for photo in photos.select_related("ocr", "main_file", "metadata").iterator():
            is_screenshot, is_document = detect_media_category(photo)
            photo.is_screenshot = is_screenshot
            photo.is_document = bool(is_document)
            photo.category_source = "auto"
            photo.last_modified = now
            reset.append(photo)
        Photo.objects.bulk_update(
            reset,
            ["is_screenshot", "is_document", "category_source", "last_modified"],
            batch_size=200,
        )
        return len(reset)


class PhotoViewSet(
    # Every verb ModelViewSet gave it; trimming them to what the clients call
    # is a change of its own (#2328 only made them explicit).
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    serializer_class = PhotoSerializer
    pagination_class = PhotoGridPagination
    filter_backends = (filters.SearchFilter,)
    search_fields = [
        "search_instance__search_captions",
        "search_instance__search_location",
        "faces__person__name",
        "tags__name",
        "exif_timestamp",
        "main_file__path",
    ]

    def get_object(self) -> Photo:
        """
        Override get_object to support lookup by both UUID (pk) and image_hash.
        This provides backward compatibility with existing URLs using image_hash.
        """
        queryset = self.get_queryset()
        lookup_url_kwarg = self.lookup_url_kwarg or self.lookup_field
        lookup_value = self.kwargs.get(lookup_url_kwarg)

        if lookup_value:
            filter_kwargs = _get_photo_filter_kwargs(lookup_value)

            obj = queryset.filter(**filter_kwargs).first()
            if obj is None:
                raise NotFound()

            # May raise a permission denied
            self.check_object_permissions(self.request, obj)
            if self.action == "retrieve":
                return self._with_detail_relations(obj)
            return obj

        return super().get_object()

    @action(
        detail=True,
        methods=["get"],
        name="summary",
        serializer_class=PhotoDetailsSummarySerializer,
    )
    def summary(self, request: Request, pk: str) -> Response:
        # Use Photo.objects instead of get_queryset() to include processing photos
        filter_kwargs = _get_photo_filter_kwargs(pk)
        # Owner, shared to the requester, or public; anything else is a 404.
        queryset = (
            Photo.objects.visible_to(scope_user(request))
            .filter(**filter_kwargs)
            .distinct()
        )

        if not queryset.exists():
            raise NotFound()

        # Serializer expects a queryset (calls .get() internally)
        serializer = PhotoDetailsSummarySerializer(queryset, many=False)
        return Response(serializer.data)

    @action(
        detail=True,
        methods=["get"],
        name="albums",
        serializer_class=AlbumUserListSerializer,
    )
    def albums(self, request: Request, pk: str) -> Response:
        """Return user albums that contain this photo."""
        filter_kwargs = _get_photo_filter_kwargs(pk)
        user = request.user
        # Only resolve photos the requester may see -- their own, shared to
        # them, public, or in one of their own or shared-to-them albums. An
        # unscoped lookup answered 200 for anyone's hash and 404 for an unknown
        # one, telling strangers which files others have (GHSA-hq2w-x39h-8wmp).
        if isinstance(user, User):
            user_albums = AlbumUser.objects.owned_or_shared_to(user)
            candidates = Photo.objects.visible_to(user) | Photo.objects.filter(
                albumuser__in=user_albums
            )
        else:
            user_albums = AlbumUser.objects.none()
            candidates = Photo.objects.visible_to(None)
        photo = candidates.filter(**filter_kwargs).distinct().first()

        if not photo:
            raise NotFound()
        albums = with_album_user_list_relations(
            user_albums.filter(photos=photo).distinct()
        )
        serializer = AlbumUserListSerializer(albums, many=True)
        return Response({"results": serializer.data})

    def get_permissions(self) -> list[BasePermission]:
        # Not "list": no client uses it, and anonymously it rendered the full
        # detail serializer (a similarity-sidecar call each) for every public
        # photo of every user, up to 5000 a page.
        permission_classes: list[type[BasePermission]]
        if self.action in ("retrieve", "summary", "albums"):
            permission_classes = [IsPhotoOrAlbumSharedTo]
        else:
            # Writes are the owner's alone, staff included: IsAdminUser has no
            # object check, so it let staff edit or delete any photo they could
            # read (public ones, ones shared to them). IsOwnerOrReadOnly only
            # checks objects, so IsAuthenticated keeps anonymous callers out of
            # create(), which has no object.
            permission_classes = [IsAuthenticated, IsOwnerOrReadOnly]
        return [permission() for permission in permission_classes]

    def get_queryset(self) -> QuerySet[Photo]:
        # Photos in shared albums are handled by the permission class.
        user = scope_user(self.request)
        # Others see only what the library lists; the owner also opens their
        # own hidden and trashed photos, from the Hidden and Trash pages.
        own = Photo.objects.owned_by(user).filter(
            removed=False, thumbnail__aspect_ratio__isnull=False
        )
        return (
            (Photo.visible.visible_to(user) | own)
            .distinct()
            .prefetch_related("stacks")
            .order_by("-exif_timestamp")
        )

    def _with_detail_relations(self, photo: Photo) -> Photo:
        """*photo* again, with everything PhotoSerializer reads.

        A second query by primary key: joined onto the visibility queryset
        above (an OR of two filters under DISTINCT), the relations took
        Postgres ~70 ms to plan for a 1 ms query. This way the detail costs
        8 queries instead of one per relation (and three per face).
        """
        return (
            Photo.objects.select_related(
                "owner",
                "thumbnail",
                "main_file",
                "caption_instance",
                "search_instance",
                "metadata",
                "ocr",
            )
            .prefetch_related(
                "stacks",
                Prefetch(
                    "faces",
                    # By id: the order the unprefetched relation came back in.
                    queryset=Face.objects.select_related(
                        "person", "cluster_person", "classification_person"
                    ).order_by("id"),
                ),
                "files",
                "main_file__embedded_media",
            )
            .get(pk=photo.pk)
        )

    def retrieve(self, *args: Any, **kwargs: Any) -> Response:
        return super().retrieve(*args, **kwargs)

    def list(self, *args: Any, **kwargs: Any) -> Response:  # pragma: no cover - unused
        return super().list(*args, **kwargs)


class PhotoEditViewSet(
    # Every verb ModelViewSet gave it; trimming them to what the clients call
    # is a change of its own (#2328 only made them explicit).
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    permission_classes = (IsAuthenticated,)
    serializer_class = PhotoEditSerializer
    pagination_class = WholeListPagination

    def get_queryset(self) -> QuerySet[Photo]:
        # Hidden and trashed photos keep an editable date and location.
        return Photo.objects.owned_by(scope_user(self.request)).filter(removed=False)

    def get_object(self) -> Photo:
        """
        Override get_object to support lookup by both UUID (pk) and image_hash.
        """
        queryset = self.get_queryset()
        lookup_url_kwarg = self.lookup_url_kwarg or self.lookup_field
        lookup_value = self.kwargs.get(lookup_url_kwarg)

        if lookup_value:
            filter_kwargs = _get_photo_filter_kwargs(lookup_value)

            obj = queryset.filter(**filter_kwargs).first()
            if obj is None:
                raise NotFound()

            self.check_object_permissions(self.request, obj)
            return obj

        return super().get_object()

    def retrieve(  # pragma: no cover TODO(sickelap): remove unused code
        self, *args: Any, **kwargs: Any
    ) -> Response:
        return super().retrieve(*args, **kwargs)

    def list(  # pragma: no cover TODO(sickelap): remove unused code
        self, *args: Any, **kwargs: Any
    ) -> Response:
        return super().list(*args, **kwargs)


class SetPhotosShared(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(request=SetPhotosSharedRequest)
    def post(self, request: Request, format: str | None = None) -> Response:
        from api.photos.selection import build_photo_queryset

        user = request_user(request)
        data = parse_body(request, SetPhotosSharedRequest)
        shared = data["val_shared"]
        target_user_id = data["target_user_id"]

        through_model = Photo.shared_to.through

        if data["select_all"]:
            query_params = data["query"]
            excluded_hashes = data["excluded_hashes"]

            photos_qs = build_photo_queryset(user, query_params)
            if excluded_hashes:
                photos_qs = photos_qs.exclude(image_hash__in=excluded_hashes)

            image_hashes = list(photos_qs.values_list("image_hash", flat=True))
        else:
            image_hashes = data["image_hashes"]

        """
        From https://stackoverflow.com/questions/6996176/how-to-create-an-object-for-a-django-model-with-a-many-to-many-field/10116452#10116452
        # Access the through model directly
        ThroughModel = Sample.users.through

        users = Users.objects.filter(pk__in=[1,2])

        sample_object = Sample()
        sample_object.save()

        ThroughModel.objects.bulk_create([
            ThroughModel(users_id=users[0].pk, sample_id=sample_object.pk),
            ThroughModel(users_id=users[1].pk, sample_id=sample_object.pk)
        ])
        """

        # Look up photo UUIDs from image_hashes (image_hash is no longer the primary key).
        # Scope to owner=request.user so a user can only (un)share photos they actually
        # own, matching the sibling SetPhotos* endpoints. Without this, an authenticated
        # user could add an arbitrary target_user_id to the shared_to of someone else's
        # private photos (cross-user IDOR). See issue #1860.
        photos = (
            Photo.objects.owned_by(user)
            .filter(image_hash__in=image_hashes)
            .only("id", "image_hash")
        )
        photo_ids = [photo.id for photo in photos]

        # This endpoint writes the Photo.shared_to through table directly
        # (bulk_create / queryset delete), which fires no m2m_changed signal,
        # so the delta-sync bookkeeping (api/sync_signals.py) is done here by
        # hand: bump last_modified on a share so the row crosses the newly
        # shared user's cursor, and emit a tombstone on an un-share so that
        # user's mirror drops it (visibility loss = deletion, doc 04 §2).
        from api.models import DeletionLog

        if shared:
            already_existing = through_model.objects.filter(
                user_id=target_user_id, photo_id__in=photo_ids
            ).only("photo_id")
            already_existing_photo_ids = set(e.photo_id for e in already_existing)
            newly_shared_ids = [
                photo_id
                for photo_id in photo_ids
                if photo_id not in already_existing_photo_ids
            ]
            res = through_model.objects.bulk_create(
                [
                    through_model(user_id=target_user_id, photo_id=photo_id)
                    for photo_id in newly_shared_ids
                ]
            )
            if newly_shared_ids:
                Photo.objects.filter(id__in=newly_shared_ids).update(
                    last_modified=timezone.now()
                )
                # Cancel any stale tombstone from a previous un-share so the
                # resurrected row is not shadowed on the recipient's next pull.
                DeletionLog.objects.filter(
                    entity=DeletionLog.ENTITY_PHOTO,
                    entity_id__in=[str(i) for i in newly_shared_ids],
                    owner_id=target_user_id,  # owner-scope: the recipient's tombstones
                ).delete()
            logger.info(
                "Shared %s's %s images to user %s", user.id, len(res), target_user_id
            )
            res_count = len(res)
        else:
            # delete() returns (count, per-model counts): only the count matters.
            res_count, _ = through_model.objects.filter(
                user_id=target_user_id, photo_id__in=photo_ids
            ).delete()
            if photo_ids:
                Photo.objects.filter(id__in=photo_ids).update(
                    last_modified=timezone.now()
                )
                DeletionLog.objects.bulk_create(
                    [
                        DeletionLog(
                            entity=DeletionLog.ENTITY_PHOTO,
                            entity_id=str(photo_id),
                            owner_id=target_user_id,
                        )
                        for photo_id in photo_ids
                    ]
                )
            logger.info(
                "Unshared %s's %s images to user %s", user.id, res_count, target_user_id
            )

        return Response({"status": True, "count": res_count})


class GeneratePhotoCaption(APIView):
    # Ownership is the owned_by() lookup below; IsOwnerOrReadOnly listed here
    # never ran (it only has has_object_permission, and nothing calls
    # check_object_permissions), so anonymous callers reached the body.
    permission_classes = (IsAuthenticated,)

    @extend_schema(request=PhotoCaptionRequest)
    def post(self, request: Request, format: str | None = None) -> Response:
        # With "None" picked the captioner is never downloaded (#2218): asking
        # for it below would start a download that skips it, answering
        # model_downloading forever.
        if not feature_enabled("IMAGE_CAPTIONING") or not captioning_model_selected():
            raise PermissionDenied("Image captioning is disabled")

        image_hash = parse_body(request, PhotoCaptionRequest)["image_hash"]

        photo = (
            Photo.objects.owned_by(request_user(request))
            .filter(image_hash=image_hash)
            .first()
        )
        if photo is None:
            raise NotFound("photo not found")

        if not captioning_model_exists():
            # The captioner is fetched with the other models, but a fresh
            # install (or a model switch) can be asked for a caption before
            # the download ran. Start it and tell the client to try again.
            start_model_download(request_user(request))
            raise ServiceUnavailable(
                "The captioning model is being downloaded. Try again in a few minutes.",
                code="model_downloading",
                retry_after=CAPTION_MODEL_RETRY_AFTER_SECONDS,
            )

        caption_instance, created = PhotoCaption.objects.get_or_create(photo=photo)
        res = captioning.generate_photo_caption(caption_instance)

        if not res:
            raise APIException(
                "Failed to generate caption. Check service logs for details.",
                code="caption_failed",
            )
        return Response({"status": True})


class SavePhotoCaption(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(request=SavePhotoCaptionRequest)
    def post(self, request: Request, format: str | None = None) -> Response:
        data = parse_body(request, SavePhotoCaptionRequest)
        image_hash = data["image_hash"]
        caption = data["caption"]

        photo = (
            Photo.objects.owned_by(request_user(request))
            .filter(image_hash=image_hash)
            .first()
        )
        if photo is None:
            raise NotFound("photo not found")

        edits.set_caption(photo, caption, request_user(request))
        return Response({"status": True})


class DeletePhotos(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(request=PhotoSelectionRequest)
    def delete(self, request: Request) -> Response:
        from api.photos.selection import build_photo_queryset

        user = request_user(request)
        data = parse_body(request, PhotoSelectionRequest)

        if data["select_all"]:
            query_params = data["query"]
            excluded_hashes = data["excluded_hashes"]

            # For delete, we need to ensure photos are in trashcan
            # Override query to filter for trashcan photos only
            query_params["in_trashcan"] = True

            photos_qs = build_photo_queryset(user, query_params)
            if excluded_hashes:
                photos_qs = photos_qs.exclude(image_hash__in=excluded_hashes)

            # Each photo goes through remove_photo for proper cleanup
            deleted_count = 0
            failed_count = 0
            # build_photo_queryset is already bound to the requester's photos.
            for photo in photos_qs:
                try:
                    remove_photo(photo)
                except Exception:
                    logger.exception(
                        "Could not delete photo %s, skipping it.", photo.image_hash
                    )
                    failed_count += 1
                else:
                    deleted_count += 1

            logger.info(
                "%s photos were permanently deleted via select_all for user %s.",
                deleted_count,
                user.id,
            )

            return Response(
                {"status": True, "count": deleted_count, "failed_count": failed_count}
            )

        # Individual hashes. Only the requester's trashed photos are eligible;
        # a hash that is someone else's, not in the trash, or unknown is
        # reported as not deleted, all alike. image_hash is not unique, so
        # every matching row of the requester's is deleted.
        image_hashes = list(dict.fromkeys(data["image_hashes"]))
        photos_by_hash: defaultdict[str, list[Photo]] = defaultdict(list)
        for photo in Photo.objects.owned_by(user).filter(
            image_hash__in=image_hashes, in_trashcan=True
        ):
            photos_by_hash[photo.image_hash].append(photo)

        deleted: list[str] = []
        not_deleted: list[str] = []
        for image_hash in image_hashes:
            photos = photos_by_hash.get(image_hash)
            if not photos:
                not_deleted.append(image_hash)
                continue
            failed = False
            for photo in photos:
                try:
                    remove_photo(photo)
                except Exception:
                    logger.exception(
                        "Could not delete photo %s, skipping it.", image_hash
                    )
                    failed = True
            (not_deleted if failed else deleted).append(image_hash)

        return Response(
            {
                "status": True,
                "results": deleted,
                "not_deleted": not_deleted,
                "deleted": deleted,
            }
        )


class FileVariantDownloadView(APIView):
    """
    Download a specific file variant for a photo.

    Supports downloading RAW, JPEG, video (Live Photo), or other variants
    associated with a Photo entity (PhotoPrism-like file variant model).
    """

    permission_classes = (IsAuthenticated,)

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "file_hash",
                OpenApiTypes.STR,
                description="Hash of the specific file variant to download",
            ),
        ],
    )
    def get(
        self, request: Request, image_hash: str, file_hash: str
    ) -> Response | FileResponse:
        """Download a specific file variant by hash."""
        photo = _get_owned_photo(image_hash, request_user(request))
        if not photo:
            raise NotFound("Photo not found")

        file_variant = photo.files.filter(hash=file_hash).first()
        if not file_variant:
            raise NotFound("File variant not found")

        if not os.path.exists(file_variant.path):
            raise NotFound("File not found on disk")

        try:
            response = FileResponse(
                open(file_variant.path, "rb"),
                as_attachment=True,
                filename=os.path.basename(file_variant.path),
            )
        except (FileNotFoundError, PermissionError) as e:
            logger.error("Error serving file %s: %s", file_variant.path, e)
            raise APIException("Could not read file") from e

        response["Content-Type"] = _detect_content_type(file_variant.path)
        return response


class SetMainFileView(APIView):
    """
    Set the main (primary) file for a photo.

    Changes which file variant is used as the main display file for the photo.
    Useful when a photo has multiple variants (RAW, JPEG, etc.).
    """

    permission_classes = (IsAuthenticated,)

    @extend_schema(request=SetMainFileRequest)
    def post(self, request: Request, image_hash: str) -> Response:
        """Set the main file for a photo."""
        file_hash = parse_body(request, SetMainFileRequest)["file_hash"]

        photo = _get_owned_photo(image_hash, request_user(request))
        if not photo:
            raise NotFound("Photo not found")

        # Find the requested file variant
        file_variant = photo.files.filter(hash=file_hash).first()
        if not file_variant:
            raise NotFound("File variant not found in this photo")

        # Update main file
        photo.main_file = file_variant
        photo.save(update_fields=["main_file", "last_modified"])

        logger.info("Set main file for photo %s to %s", image_hash, file_hash)

        return Response(
            {
                "status": "updated",
                "main_file_hash": file_hash,
            }
        )


class SaveMetadataView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(request=SaveMetadataRequest)
    def post(self, request: Request, format: str | None = None) -> Response:
        """Bulk-write metadata to image files for the authenticated user's photos.

        Accepts {"types": ["ratings", "face_tags"]} to control what gets written.
        Defaults to ["ratings"] if not specified. Writes to the sidecar or the
        media file as the user's "Synchronize metadata to disk" says, and is a
        400 while that is Off (#2293).
        """
        user = request_user(request)
        metadata_types = parse_body(request, SaveMetadataRequest)["types"]
        use_sidecar = write_target(user)
        if use_sidecar is None:
            raise ValidationError(
                "Synchronize metadata to disk is Off: choose 'Save to sidecar' "
                "or 'Save to media file' in the settings first."
            )

        photos = Photo.objects.owned_by(user)

        # When writing face tags, only include photos that have labeled faces
        if "face_tags" in metadata_types and metadata_types == ["face_tags"]:
            photos = photos.filter(
                faces__person__kind=Person.KIND_USER,
                faces__deleted=False,
            ).distinct()

        written = 0
        errors = 0
        with one_exiftool_process():
            for photo in photos.iterator():
                try:
                    write_photo_metadata(
                        photo, use_sidecar=use_sidecar, metadata_types=metadata_types
                    )
                    written += 1
                except MetadataWriteError as error:
                    errors += 1
                    logger.warning(
                        "The metadata of photo %s was not written: %s",
                        photo.image_hash,
                        error,
                    )
                except Exception:
                    errors += 1
                    logger.exception(
                        "Failed to save metadata for photo %s", photo.image_hash
                    )

        return Response({"status": True, "written": written, "errors": errors})


def _get_rotatable_photo(image_hash: str, user: User) -> Photo:
    """The photo that may be rotated; 404 when unknown, 400 for a video."""
    # first(), as in _get_owned_photo: byte-identical files can give one user
    # two photos with the same hash, and get() turned that into a 500.
    photo = (
        Photo.objects.owned_by(user)
        .select_related("thumbnail", "main_file", "owner")
        .filter(image_hash=image_hash)
        .first()
    )
    if photo is None:
        raise NotFound("photo not found")

    if photo.video:
        raise ValidationError("rotation is not supported for videos")

    return photo


class RotatePhotoView(APIView):
    """Non-destructive photo rotation.

    Applies a clockwise rotation (and optional horizontal flip) to a photo by
    updating the ``local_orientation`` field and regenerating thumbnails.
    The original file is never modified unless the user has opted into
    ``save_metadata_to_disk``: then the orientation is also written to the
    XMP sidecar, or into a JPEG, PNG, TIFF or WebP original (never into HEIC,
    AVIF or RAW).

    **Request body (JSON)**::

        {
            "image_hash": "<md5-hash>",   // required
            "angle": 90,                  // degrees CW, must be multiple of 90
            "flip_horizontal": false      // optional, default false
        }

    Negative ``angle`` values rotate counter-clockwise (e.g. ``-90`` = 90° CCW).

    **Response**::

        {
            "status": true,
            "image_hash": "<md5-hash>",
            "local_orientation": 6,          // new EXIF orientation code (1–8)
            "last_modified": "2024-01-01T00:00:00Z",  // for client cache-busting
            "write_error": null  // why the file or sidecar was not written
        }
    """

    permission_classes = (IsAuthenticated,)

    @extend_schema(request=RotatePhotoRequest)
    def post(self, request: Request, format: str | None = None) -> Response:
        data = parse_body(request, RotatePhotoRequest)
        image_hash = data["image_hash"]
        flip_horizontal = data["flip_horizontal"]
        angle = data["angle"]
        photo = _get_rotatable_photo(image_hash, request_user(request))

        try:
            write_error = rotate_photo(
                photo, angle=angle, flip_horizontal=flip_horizontal
            )
        except Exception as error:
            logger.exception("Failed to rotate photo %s", image_hash)
            raise APIException("failed to rotate photo") from error

        # Refresh from DB to get updated last_modified
        photo.refresh_from_db(fields=["local_orientation", "last_modified"])

        return Response(
            {
                "status": True,
                "image_hash": photo.image_hash,
                "local_orientation": photo.local_orientation,
                "last_modified": photo.last_modified.isoformat(),
                # The rotation is saved; it did not reach the file (#2294).
                "write_error": write_error,
            }
        )
