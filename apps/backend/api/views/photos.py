import uuid
from collections import defaultdict

from django.conf import settings
from django.db.models import Count, Prefetch, Q
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, OpenApiTypes, extend_schema
from rest_framework import filters, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response
from rest_framework.views import APIView

from api.mime import mime_type
from api.metadata.jobs import queue_rating_write
from api.ml_models import captioning_model_exists, start_model_download
from api.models import AlbumUser, File, Photo, User
from api.models.photo_stack import PhotoStack
from api.models.person import Person
from api.models.photo_caption import PhotoCaption
from api.models.tag import refresh_tag_photo_counts, tag_ids_for_photos
from api.permissions import IsOwnerOrReadOnly, IsPhotoOrAlbumSharedTo
from api.serializers.album_user import AlbumUserListSerializer
from api.serializers.photos import (
    PhotoDetailsSummarySerializer,
    PhotoEditSerializer,
    PhotoSerializer,
    PhotoSummarySerializer,
)
from api.util import logger
from api.views.custom_api_view import ListViewSet
from api.views.pagination import (
    HugeResultsSetPagination,
    RegularResultsSetPagination,
    StandardResultsSetPagination,
)


def _get_photo_filter_kwargs(lookup_value):
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


def _get_owned_photo(image_hash, user):
    """Return the user's photo for ``image_hash``, or None if there is none."""
    try:
        return Photo.objects.owned_by(user).get(image_hash=image_hash)
    except Photo.DoesNotExist:
        return None
    except Photo.MultipleObjectsReturned:
        return Photo.objects.owned_by(user).filter(image_hash=image_hash).first()


def _detect_content_type(path):
    """Return the MIME type of a file, falling back to a generic binary type."""
    try:
        return mime_type(path)
    except Exception:
        return "application/octet-stream"


class RecentlyAddedPhotoListViewSet(ListViewSet):
    serializer_class = PhotoSummarySerializer
    pagination_class = HugeResultsSetPagination

    def get_queryset(self):
        latest_photo = self._get_latest_photo()
        if latest_photo is None:
            return Photo.objects.none()
        latest_date = latest_photo.added_on

        # Prefetch stacks with type filter and annotated photo count
        # to avoid N+1 queries in PhotoSummarySerializer.get_stacks()
        valid_stack_types = PhotoStack.VALID_STACK_TYPES + [
            PhotoStack.StackType.RAW_JPEG_PAIR,
            PhotoStack.StackType.LIVE_PHOTO,
        ]
        stacks_prefetch = Prefetch(
            "stacks",
            queryset=PhotoStack.objects.filter(
                stack_type__in=valid_stack_types
            ).annotate(photo_count_annotation=Count("photos")),
        )

        queryset = (
            Photo.visible.owned_by(self.request.user)
            .filter(
                Q(thumbnail__aspect_ratio__isnull=False)
                & Q(added_on__date=latest_date.date())
            )
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
                stacks_prefetch,
                "files",  # For get_has_raw_variant()
            )
            .only(
                "image_hash",
                "thumbnail__aspect_ratio",
                "thumbnail__dominant_color",
                "video",
                "main_file",
                "search_instance__search_location",
                "rating",
                "owner",
                "exif_gps_lat",
                "exif_gps_lon",
                "removed",
                "in_trashcan",
                "exif_timestamp",
                "video_length",
            )
            .order_by("-added_on")
        )
        return queryset

    def list(self, *args, **kwargs):
        queryset = self.get_queryset()
        latest_photo = self._get_latest_photo()
        latest_date = latest_photo.added_on if latest_photo else None
        serializer = PhotoSummarySerializer(queryset, many=True)
        return Response({"date": latest_date, "results": serializer.data})

    def _get_latest_photo(self):
        if not hasattr(self, "_latest_photo"):
            self._latest_photo = (
                Photo.visible.owned_by(self.request.user)
                .only("added_on")
                .order_by("-added_on")
                .first()
            )
        return self._latest_photo


class NoTimestampPhotoViewSet(ListViewSet):
    serializer_class = PhotoSummarySerializer
    pagination_class = RegularResultsSetPagination
    filter_backends = (filters.SearchFilter,)
    search_fields = [
        "search_instance__search_captions",
        "search_instance__search_location",
        "faces__person__name",
    ]

    def get_queryset(self):
        return (
            Photo.visible.owned_by(self.request.user)
            .filter(exif_timestamp=None)
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
                "rating",
                "owner",
                "exif_gps_lat",
                "exif_gps_lon",
                "removed",
                "in_trashcan",
                "exif_timestamp",
                "video_length",
            )
            .order_by("added_on")
        )

    def list(self, *args, **kwargs):
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

    #: Request key carrying the new value.
    value_field = None
    #: The flag's name in the missing-photo warning ("set photo X to ...").
    flag_name = None
    #: What happened to a photo, by new value, for log lines.
    past_tense = {True: "changed", False: "changed"}
    #: Hiding or trashing a photo takes it out of its tags' counts, and a
    #: queryset UPDATE fires no signal to say so.
    refreshes_tag_counts = False
    #: In ``select_all`` mode, touch (and count) only photos whose state
    #: differs rather than every photo the query matches.
    select_all_only_changed = False

    def differs(self, user, value):
        """A ``Q`` matching the photos that ``value`` would change."""
        raise NotImplementedError

    def new_values(self, user, value):
        """The columns to UPDATE, besides ``last_modified``."""
        raise NotImplementedError

    def before_update(self, user, photos, value):
        """Hook run on the photos about to change, before the UPDATE."""

    def apply(self, user, photos, value):
        """UPDATE ``photos`` to ``value``; return the number of rows changed."""
        affected_tag_ids = (
            tag_ids_for_photos(photos) if self.refreshes_tag_counts else None
        )
        self.before_update(user, photos, value)
        count = photos.update(
            **self.new_values(user, value), last_modified=timezone.now()
        )
        if affected_tag_ids is not None:
            refresh_tag_photo_counts(affected_tag_ids)
        return count

    def post(self, request, format=None):
        data = dict(request.data)
        value = data[self.value_field]
        if data.get("select_all"):
            return self._post_select_all(request.user, data, value)
        return self._post_hashes(request.user, data["image_hashes"], value)

    def _post_select_all(self, user, data, value):
        from api.views.photo_filters import build_photo_queryset

        photos = build_photo_queryset(user, data.get("query", {}))
        excluded_hashes = data.get("excluded_hashes", [])
        if excluded_hashes:
            photos = photos.exclude(image_hash__in=excluded_hashes)
        if self.select_all_only_changed:
            photos = photos.filter(self.differs(user, value))

        count = self.apply(user, photos, value)
        logger.info(
            f"{count} photos were {self.past_tense[bool(value)]} via select_all "
            f"for user {user.id}."
        )
        return Response({"status": True, "count": count})

    def _post_hashes(self, user, image_hashes, value):
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
                f"Could not set photo {missing_hash} to {self.flag_name}. "
                "It does not exist or is not owned by user."
            )
        logger.info(
            f"{len(updated_hashes)} photos were {self.past_tense[bool(value)]}. "
            f"{len(not_updated_hashes)} photos already were."
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
    value_field = "deleted"
    flag_name = "deleted"
    past_tense = {True: "moved to trash", False: "restored from trash"}
    refreshes_tag_counts = True

    def differs(self, user, value):
        return ~Q(in_trashcan=value)

    def new_values(self, user, value):
        return {"in_trashcan": value}

    def before_update(self, user, photos, value):
        if value:
            return
        # A restored photo re-enters its stacks: reset those to pending so
        # they are reviewed again. Taken before the UPDATE, while ``photos``
        # (which may filter on in_trashcan) still matches them.
        from api.models.stack_review import StackReview

        stack_ids = set(
            PhotoStack.objects.filter(photos__in=photos).values_list("id", flat=True)
        )
        if stack_ids:
            StackReview.objects.filter(
                stack_id__in=stack_ids, decision=StackReview.Decision.RESOLVED
            ).update(decision=StackReview.Decision.PENDING)
            logger.info(f"Reset {len(stack_ids)} photo stacks to pending after restore")


class SetPhotosFavorite(BulkPhotoMutationView):
    value_field = "favorite"
    flag_name = "favorite"
    past_tense = {True: "added to favorites", False: "removed from favorites"}
    select_all_only_changed = True

    def differs(self, user, value):
        if value:
            return Q(rating__lt=user.favorite_min_rating)
        return Q(rating__gte=user.favorite_min_rating)

    def new_values(self, user, value):
        return {"rating": user.favorite_min_rating if value else 0}

    def apply(self, user, photos, value):
        # Photo.save() writes a changed rating to the file or sidecar; this
        # UPDATE skips save(), so the same write is queued as a job. The ids
        # are taken first: afterwards the rating filter no longer matches.
        photo_ids = []
        if user.save_metadata_to_disk != User.SaveMetadata.OFF:
            photo_ids = list(photos.values_list("id", flat=True))
        count = super().apply(user, photos, value)
        queue_rating_write(user, photo_ids)
        return count


class SetPhotosHidden(BulkPhotoMutationView):
    value_field = "hidden"
    flag_name = "hidden"
    past_tense = {True: "set hidden", False: "set unhidden"}
    refreshes_tag_counts = True

    def differs(self, user, value):
        return ~Q(hidden=value)

    def new_values(self, user, value):
        return {"hidden": value}


class SetPhotosPublic(BulkPhotoMutationView):
    value_field = "val_public"
    flag_name = "public"
    past_tense = {True: "set public", False: "set private"}

    def differs(self, user, value):
        return ~Q(public=value)

    def new_values(self, user, value):
        return {"public": value}


class PhotoViewSet(viewsets.ModelViewSet):
    serializer_class = PhotoSerializer
    pagination_class = HugeResultsSetPagination
    filter_backends = (filters.SearchFilter,)
    search_fields = [
        "search_instance__search_captions",
        "search_instance__search_location",
        "faces__person__name",
        "tags__name",
        "exif_timestamp",
        "main_file__path",
    ]

    def get_object(self):
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
            return obj

        return super().get_object()

    @action(
        detail=True,
        methods=["get"],
        name="summary",
        serializer_class=PhotoDetailsSummarySerializer,
    )
    def summary(self, request, pk):
        # Use Photo.objects instead of get_queryset() to include processing photos
        filter_kwargs = _get_photo_filter_kwargs(pk)
        # Owner, shared to the requester, or public; anything else is a 404.
        queryset = (
            Photo.objects.visible_to(request.user).filter(**filter_kwargs).distinct()
        )

        if not queryset.exists():
            return Response(status=status.HTTP_404_NOT_FOUND)

        # Serializer expects a queryset (calls .get() internally)
        serializer = PhotoDetailsSummarySerializer(queryset, many=False)
        return Response(serializer.data)

    @action(
        detail=True,
        methods=["get"],
        name="albums",
        serializer_class=AlbumUserListSerializer,
    )
    def albums(self, request, pk):
        """Return user albums that contain this photo."""
        filter_kwargs = _get_photo_filter_kwargs(pk)
        photo = Photo.objects.filter(**filter_kwargs).first()

        if not photo:
            return Response(status=status.HTTP_404_NOT_FOUND)
        albums = AlbumUser.objects.filter(
            Q(photos=photo) & (Q(owner=request.user) | Q(shared_to=request.user))
        ).distinct()
        serializer = AlbumUserListSerializer(albums, many=True)
        return Response({"results": serializer.data})

    def get_permissions(self):
        if self.action in ("list", "retrieve", "summary", "albums"):
            permission_classes = [IsPhotoOrAlbumSharedTo]
        else:  # pragma: no cover - unused
            if getattr(self.request, "user", None) and self.request.user.is_staff:
                permission_classes = [IsAdminUser]
            else:
                permission_classes = [IsOwnerOrReadOnly]
        return [permission() for permission in permission_classes]

    def get_queryset(self):
        # Photos in shared albums are handled by the permission class.
        return (
            Photo.visible.visible_to(self.request.user)
            .prefetch_related("stacks")
            .order_by("-exif_timestamp")
        )

    def retrieve(self, *args, **kwargs):
        return super().retrieve(*args, **kwargs)

    def list(self, *args, **kwargs):  # pragma: no cover - unused
        return super().list(*args, **kwargs)


class PhotoEditViewSet(viewsets.ModelViewSet):
    serializer_class = PhotoEditSerializer
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        return Photo.visible.owned_by(self.request.user)

    def get_object(self):
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

    def retrieve(
        self, *args, **kwargs
    ):  # pragma: no cover TODO(sickelap): remove unused code
        return super().retrieve(*args, **kwargs)

    def list(
        self, *args, **kwargs
    ):  # pragma: no cover TODO(sickelap): remove unused code
        return super().list(*args, **kwargs)


class SetPhotosShared(APIView):
    def post(self, request, format=None):
        from api.views.photo_filters import build_photo_queryset

        data = dict(request.data)
        shared = data["val_shared"]  # bool
        target_user_id = data["target_user_id"]  # user pk, int

        through_model = Photo.shared_to.through

        # NEW: Support select_all mode for bulk operations
        if data.get("select_all"):
            query_params = data.get("query", {})
            excluded_hashes = data.get("excluded_hashes", [])

            photos_qs = build_photo_queryset(request.user, query_params)
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
            Photo.objects.owned_by(request.user)
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
                    owner_id=target_user_id,
                ).delete()
            logger.info(
                f"Shared {request.user.id}'s {len(res)} images to user {target_user_id}"
            )
            res_count = len(res)
        else:
            res = through_model.objects.filter(
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
                f"Unshared {request.user.id}'s {len(res)} images to user {target_user_id}"
            )
            res_count = res[0]

        return Response({"status": True, "count": res_count})


class GeneratePhotoCaption(APIView):
    permission_classes = (IsOwnerOrReadOnly,)

    def post(self, request, format=None):
        if not settings.FEATURE_IMAGE_CAPTIONING:
            return Response(
                {"status": False, "message": "Image captioning is disabled"},
                status=403,
            )

        data = dict(request.data)
        image_hash = data["image_hash"]

        photo = (
            Photo.objects.owned_by(request.user).filter(image_hash=image_hash).first()
        )
        if photo is None:
            return Response(
                {"status": False, "message": "photo not found"},
                status=404,
            )

        if not captioning_model_exists():
            # The captioner is fetched with the other models, but a fresh
            # install (or a model switch) can be asked for a caption before
            # the download ran. Start it and tell the user to try again;
            # a 200 so the client can read the reason.
            start_model_download(request.user)
            return Response(
                {
                    "status": False,
                    "reason": "model_downloading",
                    "message": "The captioning model is being downloaded. Try again in a few minutes.",
                }
            )

        caption_instance, created = PhotoCaption.objects.get_or_create(photo=photo)
        res = caption_instance.generate_captions_im2txt()

        if res:
            return Response({"status": True})
        else:
            return Response(
                {
                    "status": False,
                    "message": "Failed to generate caption. Check service logs for details.",
                },
                status=500,
            )


class SavePhotoCaption(APIView):
    permission_classes = (IsOwnerOrReadOnly,)

    def post(self, request, format=None):
        data = dict(request.data)
        image_hash = data["image_hash"]
        caption = data["caption"]

        photo = (
            Photo.objects.owned_by(request.user).filter(image_hash=image_hash).first()
        )
        if photo is None:
            return Response(
                {"status": False, "message": "photo not found"},
                status=404,
            )

        caption_instance, created = PhotoCaption.objects.get_or_create(photo=photo)
        res = caption_instance.save_user_caption(caption)
        return Response({"status": res})


class DeletePhotos(APIView):
    def delete(self, request):
        from api.views.photo_filters import build_photo_queryset

        data = dict(request.data)

        # NEW: Support select_all mode for bulk operations
        if data.get("select_all"):
            query_params = data.get("query", {})
            excluded_hashes = data.get("excluded_hashes", [])

            # For delete, we need to ensure photos are in trashcan
            # Override query to filter for trashcan photos only
            query_params["in_trashcan"] = True

            photos_qs = build_photo_queryset(request.user, query_params)
            if excluded_hashes:
                photos_qs = photos_qs.exclude(image_hash__in=excluded_hashes)

            # Need to call manual_delete on each photo for proper cleanup
            deleted_count = 0
            failed_count = 0
            # build_photo_queryset is already bound to the requester's photos.
            for photo in photos_qs:
                try:
                    photo.manual_delete()
                except Exception:
                    logger.exception(
                        f"Could not delete photo {photo.image_hash}, skipping it."
                    )
                    failed_count += 1
                else:
                    deleted_count += 1

            logger.info(
                f"{deleted_count} photos were permanently deleted via select_all for user {request.user.id}."
            )

            return Response(
                {"status": True, "count": deleted_count, "failed_count": failed_count}
            )

        # Individual hashes. Only the requester's trashed photos are eligible;
        # a hash that is someone else's, not in the trash, or unknown is
        # reported as not deleted, all alike. image_hash is not unique, so
        # every matching row of the requester's is deleted.
        image_hashes = list(dict.fromkeys(data["image_hashes"]))
        photos_by_hash = defaultdict(list)
        for photo in Photo.objects.owned_by(request.user).filter(
            image_hash__in=image_hashes, in_trashcan=True
        ):
            photos_by_hash[photo.image_hash].append(photo)

        deleted = []
        not_deleted = []
        for image_hash in image_hashes:
            photos = photos_by_hash.get(image_hash)
            if not photos:
                not_deleted.append(image_hash)
                continue
            failed = False
            for photo in photos:
                try:
                    photo.manual_delete()
                except Exception:
                    logger.exception(
                        f"Could not delete photo {image_hash}, skipping it."
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

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "file_hash",
                OpenApiTypes.STR,
                description="Hash of the specific file variant to download",
            ),
        ],
    )
    def get(self, request, image_hash, file_hash):
        """Download a specific file variant by hash."""
        import os
        from django.http import FileResponse

        photo = _get_owned_photo(image_hash, request.user)
        if not photo:
            return Response(
                {"error": "Photo not found"}, status=status.HTTP_404_NOT_FOUND
            )

        file_variant = photo.files.filter(hash=file_hash).first()
        if not file_variant:
            return Response(
                {"error": "File variant not found"}, status=status.HTTP_404_NOT_FOUND
            )

        if not os.path.exists(file_variant.path):
            return Response(
                {"error": "File not found on disk"}, status=status.HTTP_404_NOT_FOUND
            )

        try:
            response = FileResponse(
                open(file_variant.path, "rb"),
                as_attachment=True,
                filename=os.path.basename(file_variant.path),
            )
        except (FileNotFoundError, PermissionError) as e:
            logger.error(f"Error serving file {file_variant.path}: {e}")
            return Response(
                {"error": "Could not read file"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        response["Content-Type"] = _detect_content_type(file_variant.path)
        return response


class SetMainFileView(APIView):
    """
    Set the main (primary) file for a photo.

    Changes which file variant is used as the main display file for the photo.
    Useful when a photo has multiple variants (RAW, JPEG, etc.).
    """

    @staticmethod
    def _get_owned_photo(image_hash, user):
        try:
            return Photo.objects.owned_by(user).get(image_hash=image_hash)
        except Photo.DoesNotExist:
            return None
        except Photo.MultipleObjectsReturned:
            return Photo.objects.owned_by(user).filter(image_hash=image_hash).first()

    def post(self, request, image_hash):
        """Set the main file for a photo."""
        file_hash = request.data.get("file_hash")

        if not file_hash:
            return Response(
                {"error": "file_hash is required"}, status=status.HTTP_400_BAD_REQUEST
            )

        photo = self._get_owned_photo(image_hash, request.user)
        if not photo:
            return Response(
                {"error": "Photo not found"}, status=status.HTTP_404_NOT_FOUND
            )

        # Find the requested file variant
        file_variant = photo.files.filter(hash=file_hash).first()
        if not file_variant:
            return Response(
                {"error": "File variant not found in this photo"},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Update main file
        photo.main_file = file_variant
        photo.save(update_fields=["main_file", "last_modified"])

        logger.info(f"Set main file for photo {image_hash} to {file_hash}")

        return Response(
            {
                "status": "updated",
                "main_file_hash": file_hash,
            }
        )


class SaveMetadataView(APIView):
    def post(self, request, format=None):
        """Bulk-write metadata to image files for the authenticated user's photos.

        Accepts {"types": ["ratings", "face_tags"]} to control what gets written.
        Defaults to ["ratings"] if not specified.
        """
        metadata_types = request.data.get("types", ["ratings"])
        use_sidecar = (
            request.user.save_metadata_to_disk == User.SaveMetadata.SIDECAR_FILE
        )

        photos = Photo.objects.owned_by(request.user)

        # When writing face tags, only include photos that have labeled faces
        if "face_tags" in metadata_types and metadata_types == ["face_tags"]:
            photos = photos.filter(
                faces__person__kind=Person.KIND_USER,
                faces__deleted=False,
            ).distinct()

        written = 0
        errors = 0
        for photo in photos.iterator():
            try:
                photo._save_metadata(
                    use_sidecar=use_sidecar, metadata_types=metadata_types
                )
                written += 1
            except Exception:
                errors += 1
                logger.exception(
                    f"Failed to save metadata for photo {photo.image_hash}"
                )

        return Response({"status": True, "written": written, "errors": errors})


def _rotation_error(message, status_code=status.HTTP_400_BAD_REQUEST):
    return Response({"status": False, "message": message}, status=status_code)


def _parse_rotation_angle(raw_angle):
    """Return ``(angle, error_message)`` for a requested rotation angle."""
    try:
        angle = int(raw_angle)
    except (TypeError, ValueError):
        return None, "angle must be an integer"

    if angle % 90 != 0:
        return None, "angle must be a multiple of 90 degrees"

    return angle, None


def _get_rotatable_photo(image_hash, user):
    """Return ``(photo, error_response)`` for a photo that may be rotated."""
    try:
        photo = (
            Photo.objects.owned_by(user)
            .select_related("thumbnail", "main_file", "owner")
            .get(image_hash=image_hash)
        )
    except Photo.DoesNotExist:
        return None, _rotation_error("photo not found", status.HTTP_404_NOT_FOUND)

    if photo.video:
        return None, _rotation_error("rotation is not supported for videos")

    return photo, None


class RotatePhotoView(APIView):
    """Non-destructive photo rotation.

    Applies a clockwise rotation (and optional horizontal flip) to a photo by
    updating the ``local_orientation`` field and regenerating thumbnails.
    The original file is never modified unless the user has opted into
    ``save_metadata_to_disk``, in which case the combined EXIF Orientation tag
    is also written to the file / sidecar.

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
            "last_modified": "2024-01-01T00:00:00Z"  // for client cache-busting
        }
    """

    def post(self, request, format=None):
        image_hash = request.data.get("image_hash")
        flip_horizontal = bool(request.data.get("flip_horizontal", False))

        if not image_hash:
            return _rotation_error("image_hash is required")

        angle, angle_error = _parse_rotation_angle(request.data.get("angle", 0))
        if angle_error:
            return _rotation_error(angle_error)

        photo, photo_error = _get_rotatable_photo(image_hash, request.user)
        if photo_error:
            return photo_error

        try:
            photo.rotate(angle=angle, flip_horizontal=flip_horizontal)
        except Exception:
            logger.exception(f"Failed to rotate photo {image_hash}")
            return _rotation_error(
                "failed to rotate photo", status.HTTP_500_INTERNAL_SERVER_ERROR
            )

        # Refresh from DB to get updated last_modified
        photo.refresh_from_db(fields=["local_orientation", "last_modified"])

        return Response(
            {
                "status": True,
                "image_hash": photo.image_hash,
                "local_orientation": photo.local_orientation,
                "last_modified": photo.last_modified.isoformat(),
            }
        )
