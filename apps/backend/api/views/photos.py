from django.db.models import Count, Prefetch, Q
from drf_spectacular.utils import OpenApiParameter, OpenApiTypes, extend_schema
from rest_framework import filters, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response
from rest_framework.views import APIView

from api.models import AlbumUser, File, Photo, User
from api.models.photo_stack import PhotoStack
from api.models.person import Person
from api.models.photo_caption import PhotoCaption
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
            Photo.visible.filter(
                Q(owner=self.request.user)
                & Q(thumbnail__aspect_ratio__isnull=False)
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
                Photo.visible.filter(Q(owner=self.request.user))
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
            Photo.visible.filter(Q(exif_timestamp=None) & Q(owner=self.request.user))
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


class SetPhotosDeleted(APIView):
    def post(self, request, format=None):
        from api.views.photo_filters import build_photo_queryset

        data = dict(request.data)
        val_deleted = data["deleted"]

        # NEW: Support select_all mode for bulk operations
        if data.get("select_all"):
            query_params = data.get("query", {})
            excluded_hashes = data.get("excluded_hashes", [])

            photos_qs = build_photo_queryset(request.user, query_params)
            if excluded_hashes:
                photos_qs = photos_qs.exclude(image_hash__in=excluded_hashes)

            # If restoring from trash, reset stacks to pending for re-evaluation
            if not val_deleted:
                from api.models.stack_review import StackReview
                from api.models.photo_stack import PhotoStack

                # Get stack IDs from photos that have stacks (ManyToMany)
                stack_ids = set(
                    PhotoStack.objects.filter(photos__in=photos_qs).values_list(
                        "id", flat=True
                    )
                )
                if stack_ids:
                    StackReview.objects.filter(
                        stack_id__in=stack_ids, decision=StackReview.Decision.RESOLVED
                    ).update(decision=StackReview.Decision.PENDING)
                    logger.info(
                        f"Reset {len(stack_ids)} photo stacks to pending after restore"
                    )

            count = photos_qs.update(in_trashcan=val_deleted)

            if val_deleted:
                logger.info(
                    f"{count} photos were moved to trash via select_all for user {request.user.id}."
                )
            else:
                logger.info(
                    f"{count} photos were restored from trash via select_all for user {request.user.id}."
                )

            return Response({"status": True, "count": count})

        # Existing logic for individual hashes
        image_hashes = data["image_hashes"]

        # Get all photos with related data in one query to prevent N+1 queries from serializer
        photos = (
            Photo.objects.filter(image_hash__in=image_hashes, owner=request.user)
            .select_related("owner", "thumbnail", "main_file")
            .prefetch_related(
                "files", "faces__person", "shared_to", "main_file__embedded_media"
            )
        )

        # Also prefetch search and caption instances if they exist
        photos = photos.select_related("search_instance", "caption_instance")

        # Group photos by whether they need updating
        photos_to_update = []
        updated_data = []
        not_updated_data = []

        for photo in photos:
            if photo.in_trashcan != val_deleted:
                photos_to_update.append(photo.image_hash)
                photo.in_trashcan = val_deleted
                updated_data.append(PhotoSerializer(photo).data)
            else:
                not_updated_data.append(PhotoSerializer(photo).data)

        # Bulk update in one query
        if photos_to_update:
            Photo.objects.filter(
                image_hash__in=photos_to_update, owner=request.user
            ).update(in_trashcan=val_deleted)

            # If restoring from trash, reset stacks to pending for re-evaluation
            if not val_deleted:
                from api.models.stack_review import StackReview
                from api.models.photo_stack import PhotoStack

                # Get stack IDs from photos that have stacks (ManyToMany)
                stack_ids = set(
                    PhotoStack.objects.filter(
                        photos__image_hash__in=photos_to_update
                    ).values_list("id", flat=True)
                )
                if stack_ids:
                    StackReview.objects.filter(
                        stack_id__in=stack_ids, decision=StackReview.Decision.RESOLVED
                    ).update(decision=StackReview.Decision.PENDING)
                    logger.info(
                        f"Reset {len(stack_ids)} photo stacks to pending after restore"
                    )

        # Handle missing photos
        found_hashes = {photo.image_hash for photo in photos}
        missing_hashes = set(image_hashes) - found_hashes
        for missing_hash in missing_hashes:
            logger.warning(
                f"Could not set photo {missing_hash} to deleted. It does not exist or is not owned by user."
            )

        if val_deleted:
            logger.info(
                f"{len(updated_data)} photos were moved to trash. {len(not_updated_data)} photos were already in trash."
            )
        else:
            logger.info(
                f"{len(updated_data)} photos were restored from trash. {len(not_updated_data)} photos were already restored."
            )
        return Response(
            {
                "status": True,
                "results": updated_data,
                "updated": updated_data,
                "not_updated": not_updated_data,
            }
        )


class SetPhotosFavorite(APIView):
    def post(self, request, format=None):
        from api.views.photo_filters import build_photo_queryset

        data = dict(request.data)
        val_favorite = data["favorite"]
        user = request.user

        # NEW: Support select_all mode for bulk operations
        if data.get("select_all"):
            query_params = data.get("query", {})
            excluded_hashes = data.get("excluded_hashes", [])

            photos_qs = build_photo_queryset(request.user, query_params)
            if excluded_hashes:
                photos_qs = photos_qs.exclude(image_hash__in=excluded_hashes)

            if val_favorite:
                # Only update photos that aren't already favorites
                count = photos_qs.filter(rating__lt=user.favorite_min_rating).update(
                    rating=user.favorite_min_rating
                )
                logger.info(
                    f"{count} photos were added to favorites via select_all for user {user.id}."
                )
            else:
                # Only update photos that are currently favorites
                count = photos_qs.filter(rating__gte=user.favorite_min_rating).update(
                    rating=0
                )
                logger.info(
                    f"{count} photos were removed from favorites via select_all for user {user.id}."
                )

            return Response({"status": True, "count": count})

        # Existing logic for individual hashes
        image_hashes = data["image_hashes"]

        # Get all photos with related data in one query to prevent N+1 queries from serializer
        photos = (
            Photo.objects.filter(image_hash__in=image_hashes, owner=request.user)
            .select_related(
                "owner", "thumbnail", "main_file", "search_instance", "caption_instance"
            )
            .prefetch_related(
                "files", "faces__person", "shared_to", "main_file__embedded_media"
            )
        )

        # Group photos by whether they need updating
        photos_to_favorite = []
        photos_to_unfavorite = []
        updated_data = []
        not_updated_data = []

        for photo in photos:
            if val_favorite and photo.rating < user.favorite_min_rating:
                photos_to_favorite.append(photo.image_hash)
                photo.rating = user.favorite_min_rating
                updated_data.append(PhotoSerializer(photo).data)
            elif not val_favorite and photo.rating >= user.favorite_min_rating:
                photos_to_unfavorite.append(photo.image_hash)
                photo.rating = 0
                updated_data.append(PhotoSerializer(photo).data)
            else:
                not_updated_data.append(PhotoSerializer(photo).data)

        # Bulk update in separate queries for different rating values
        if photos_to_favorite:
            Photo.objects.filter(
                image_hash__in=photos_to_favorite, owner=request.user
            ).update(rating=user.favorite_min_rating)

        if photos_to_unfavorite:
            Photo.objects.filter(
                image_hash__in=photos_to_unfavorite, owner=request.user
            ).update(rating=0)

        # Handle missing photos
        found_hashes = {photo.image_hash for photo in photos}
        missing_hashes = set(image_hashes) - found_hashes
        for missing_hash in missing_hashes:
            logger.warning(
                f"Could not set photo {missing_hash} to favorite. It does not exist or is not owned by user."
            )

        if val_favorite:
            logger.info(
                f"{len(updated_data)} photos were added to favorites. {len(not_updated_data)} photos were already in favorites."
            )
        else:
            logger.info(
                f"{len(updated_data)} photos were removed from favorites. {len(not_updated_data)} photos were already not in favorites."
            )
        return Response(
            {
                "status": True,
                "results": updated_data,
                "updated": updated_data,
                "not_updated": not_updated_data,
            }
        )


class SetPhotosHidden(APIView):
    def post(self, request, format=None):
        from api.views.photo_filters import build_photo_queryset

        data = dict(request.data)
        val_hidden = data["hidden"]

        # NEW: Support select_all mode for bulk operations
        if data.get("select_all"):
            query_params = data.get("query", {})
            excluded_hashes = data.get("excluded_hashes", [])

            photos_qs = build_photo_queryset(request.user, query_params)
            if excluded_hashes:
                photos_qs = photos_qs.exclude(image_hash__in=excluded_hashes)

            count = photos_qs.update(hidden=val_hidden)

            if val_hidden:
                logger.info(
                    f"{count} photos were set hidden via select_all for user {request.user.id}."
                )
            else:
                logger.info(
                    f"{count} photos were set unhidden via select_all for user {request.user.id}."
                )

            return Response({"status": True, "count": count})

        # Existing logic for individual hashes
        image_hashes = data["image_hashes"]

        # Get all photos with related data in one query to prevent N+1 queries from serializer
        photos = (
            Photo.objects.filter(image_hash__in=image_hashes, owner=request.user)
            .select_related(
                "owner", "thumbnail", "main_file", "search_instance", "caption_instance"
            )
            .prefetch_related(
                "files", "faces__person", "shared_to", "main_file__embedded_media"
            )
        )

        # Group photos by whether they need updating
        photos_to_update = []
        updated_data = []
        not_updated_data = []

        for photo in photos:
            if photo.hidden != val_hidden:
                photos_to_update.append(photo.image_hash)
                photo.hidden = val_hidden
                updated_data.append(PhotoSerializer(photo).data)
            else:
                not_updated_data.append(PhotoSerializer(photo).data)

        # Bulk update in one query
        if photos_to_update:
            Photo.objects.filter(
                image_hash__in=photos_to_update, owner=request.user
            ).update(hidden=val_hidden)

        # Handle missing photos
        found_hashes = {photo.image_hash for photo in photos}
        missing_hashes = set(image_hashes) - found_hashes
        for missing_hash in missing_hashes:
            logger.warning(
                f"Could not set photo {missing_hash} to hidden. It does not exist or is not owned by user."
            )

        if val_hidden:
            logger.info(
                f"{len(updated_data)} photos were set hidden. {len(not_updated_data)} photos were already hidden."
            )
        else:
            logger.info(
                f"{len(updated_data)} photos were set unhidden. {len(not_updated_data)} photos were already unhidden."
            )
        return Response(
            {
                "status": True,
                "results": updated_data,
                "updated": updated_data,
                "not_updated": not_updated_data,
            }
        )


class PhotoViewSet(viewsets.ModelViewSet):
    serializer_class = PhotoSerializer
    pagination_class = HugeResultsSetPagination
    filter_backends = (filters.SearchFilter,)
    search_fields = [
        "search_instance__search_captions",
        "search_instance__search_location",
        "faces__person__name",
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
            # Determine if this is a UUID (36 chars with hyphens) or image_hash (32 hex chars)
            # Note: Python's uuid.UUID() accepts 32 hex chars without hyphens, but those
            # are MD5 hashes used for backward compatibility, not actual UUIDs
            is_uuid_format = len(lookup_value) == 36 and lookup_value.count("-") == 4

            if is_uuid_format:
                try:
                    import uuid

                    uuid.UUID(lookup_value)
                    filter_kwargs = {"pk": lookup_value}
                except (ValueError, AttributeError):
                    filter_kwargs = {"image_hash": lookup_value}
            else:
                # 32 hex chars = MD5 image_hash (backward compatibility)
                filter_kwargs = {"image_hash": lookup_value}

            obj = queryset.filter(**filter_kwargs).first()
            if obj is None:
                from rest_framework.exceptions import NotFound

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
        # Support both UUID and image_hash lookups
        # Note: 32 hex chars could parse as UUID but are actually MD5 hashes
        # Use Photo.objects instead of get_queryset() to include processing photos
        is_uuid_format = len(pk) == 36 and pk.count("-") == 4

        if is_uuid_format:
            try:
                import uuid

                uuid.UUID(pk)
                queryset = Photo.objects.filter(pk=pk)
            except (ValueError, AttributeError):
                queryset = Photo.objects.filter(image_hash=pk)
        else:
            queryset = Photo.objects.filter(image_hash=pk)

        if not queryset.exists():
            return Response(status=status.HTTP_404_NOT_FOUND)

        photo = queryset.first()
        # Check permissions - owner, shared, or public
        if not (
            photo.owner == request.user
            or photo.shared_to.filter(id=request.user.id).exists()
            or photo.public
        ):
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
        # Support both UUID and image_hash lookups
        try:
            import uuid

            uuid.UUID(pk)
            photo = Photo.objects.filter(pk=pk).first()
        except (ValueError, AttributeError):
            photo = Photo.objects.filter(image_hash=pk).first()

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
        if self.request.user.is_anonymous:
            return (
                Photo.visible.filter(Q(public=True))
                .prefetch_related("stacks")
                .order_by("-exif_timestamp")
            )
        else:
            # Include photos that are:
            # 1. Owned by the user
            # 2. Shared directly with the user
            # 3. Public (for retrieve access)
            # Note: Photos in shared albums are handled by the permission class
            return (
                Photo.visible.filter(
                    Q(owner=self.request.user)
                    | Q(shared_to=self.request.user)
                    | Q(public=True)
                )
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
        return Photo.visible.filter(Q(owner=self.request.user))

    def get_object(self):
        """
        Override get_object to support lookup by both UUID (pk) and image_hash.
        """
        queryset = self.get_queryset()
        lookup_url_kwarg = self.lookup_url_kwarg or self.lookup_field
        lookup_value = self.kwargs.get(lookup_url_kwarg)

        if lookup_value:
            # Check if proper UUID format (36 chars with hyphens) vs MD5 hash (32 hex chars)
            is_uuid_format = len(lookup_value) == 36 and lookup_value.count("-") == 4

            if is_uuid_format:
                try:
                    import uuid

                    uuid.UUID(lookup_value)
                    filter_kwargs = {"pk": lookup_value}
                except (ValueError, AttributeError):
                    filter_kwargs = {"image_hash": lookup_value}
            else:
                filter_kwargs = {"image_hash": lookup_value}

            obj = queryset.filter(**filter_kwargs).first()
            if obj is None:
                from rest_framework.exceptions import NotFound

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

        # Look up photo UUIDs from image_hashes (image_hash is no longer the primary key)
        photos = Photo.objects.filter(image_hash__in=image_hashes).only(
            "id", "image_hash"
        )
        photo_ids = [photo.id for photo in photos]

        if shared:
            already_existing = through_model.objects.filter(
                user_id=target_user_id, photo_id__in=photo_ids
            ).only("photo_id")
            already_existing_photo_ids = set(e.photo_id for e in already_existing)
            res = through_model.objects.bulk_create(
                [
                    through_model(user_id=target_user_id, photo_id=photo_id)
                    for photo_id in photo_ids
                    if photo_id not in already_existing_photo_ids
                ]
            )
            logger.info(
                f"Shared {request.user.id}'s {len(res)} images to user {target_user_id}"
            )
            res_count = len(res)
        else:
            res = through_model.objects.filter(
                user_id=target_user_id, photo_id__in=photo_ids
            ).delete()
            logger.info(
                f"Unshared {request.user.id}'s {len(res)} images to user {target_user_id}"
            )
            res_count = res[0]

        return Response({"status": True, "count": res_count})


class SetPhotosPublic(APIView):
    def post(self, request, format=None):
        from api.views.photo_filters import build_photo_queryset

        data = dict(request.data)
        val_public = data["val_public"]

        # NEW: Support select_all mode for bulk operations
        if data.get("select_all"):
            query_params = data.get("query", {})
            excluded_hashes = data.get("excluded_hashes", [])

            photos_qs = build_photo_queryset(request.user, query_params)
            if excluded_hashes:
                photos_qs = photos_qs.exclude(image_hash__in=excluded_hashes)

            count = photos_qs.update(public=val_public)

            if val_public:
                logger.info(
                    f"{count} photos were set public via select_all for user {request.user.id}."
                )
            else:
                logger.info(
                    f"{count} photos were set private via select_all for user {request.user.id}."
                )

            return Response({"status": True, "count": count})

        # Existing logic for individual hashes
        image_hashes = data["image_hashes"]

        # Get all photos with related data in one query to prevent N+1 queries from serializer
        photos = (
            Photo.objects.filter(image_hash__in=image_hashes, owner=request.user)
            .select_related(
                "owner", "thumbnail", "main_file", "search_instance", "caption_instance"
            )
            .prefetch_related(
                "files", "faces__person", "shared_to", "main_file__embedded_media"
            )
        )

        # Group photos by whether they need updating
        photos_to_update = []
        updated_data = []
        not_updated_data = []

        for photo in photos:
            if photo.public != val_public:
                photos_to_update.append(photo.image_hash)
                photo.public = val_public
                updated_data.append(PhotoSerializer(photo).data)
            else:
                not_updated_data.append(PhotoSerializer(photo).data)

        # Bulk update in one query
        if photos_to_update:
            Photo.objects.filter(
                image_hash__in=photos_to_update, owner=request.user
            ).update(public=val_public)

        # Handle missing photos
        found_hashes = {photo.image_hash for photo in photos}
        missing_hashes = set(image_hashes) - found_hashes
        for missing_hash in missing_hashes:
            logger.warning(
                f"Could not set photo {missing_hash} to public. It does not exist or is not owned by user."
            )

        if val_public:
            logger.info(
                f"{len(updated_data)} photos were set public. {len(not_updated_data)} photos were already public."
            )
        else:
            logger.info(
                f"{len(updated_data)} photos were set private. {len(not_updated_data)} photos were already public."
            )

        return Response(
            {
                "status": True,
                "results": updated_data,
                "updated": updated_data,
                "not_updated": not_updated_data,
            }
        )


class GeneratePhotoCaption(APIView):
    permission_classes = (IsOwnerOrReadOnly,)

    def post(self, request, format=None):
        data = dict(request.data)
        image_hash = data["image_hash"]

        photo = Photo.objects.filter(image_hash=image_hash, owner=request.user).first()
        if photo is None:
            return Response(
                {"status": False, "message": "photo not found"},
                status=404,
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

        photo = Photo.objects.filter(image_hash=image_hash, owner=request.user).first()
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
            for photo in photos_qs:
                if photo.owner == request.user:
                    photo.manual_delete()
                    deleted_count += 1

            logger.info(
                f"{deleted_count} photos were permanently deleted via select_all for user {request.user.id}."
            )

            return Response({"status": True, "count": deleted_count})

        # Existing logic for individual hashes
        # Use filter since image_hash may not be unique after UUID migration
        image_hashes = data["image_hashes"]
        photos = Photo.objects.filter(image_hash__in=image_hashes)
        photos_by_hash = {photo.image_hash: photo for photo in photos}

        deleted = []
        not_deleted = []
        for image_hash in image_hashes:
            photo = photos_by_hash.get(image_hash)
            if photo is None:
                continue  # Photo not found
            if photo.owner == request.user and photo.in_trashcan:
                deleted.append(photo.image_hash)
                photo.manual_delete()
            else:
                not_deleted.append(photo.image_hash)

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
        import magic
        import os
        from django.http import FileResponse, HttpResponse

        # Find the photo
        try:
            photo = Photo.objects.get(
                image_hash=image_hash,
                owner=request.user,
            )
        except Photo.DoesNotExist:
            return Response(
                {"error": "Photo not found"}, status=status.HTTP_404_NOT_FOUND
            )
        except Photo.MultipleObjectsReturned:
            # Multiple photos with same hash - get the one owned by user
            photo = Photo.objects.filter(
                image_hash=image_hash,
                owner=request.user,
            ).first()
            if not photo:
                return Response(
                    {"error": "Photo not found"}, status=status.HTTP_404_NOT_FOUND
                )

        # Find the requested file variant
        file_variant = photo.files.filter(hash=file_hash).first()
        if not file_variant:
            return Response(
                {"error": "File variant not found"}, status=status.HTTP_404_NOT_FOUND
            )

        # Check file exists
        if not os.path.exists(file_variant.path):
            return Response(
                {"error": "File not found on disk"}, status=status.HTTP_404_NOT_FOUND
            )

        # Serve the file
        try:
            response = FileResponse(
                open(file_variant.path, "rb"),
                as_attachment=True,
                filename=os.path.basename(file_variant.path),
            )

            # Set content type
            try:
                mime = magic.Magic(mime=True)
                response["Content-Type"] = mime.from_file(file_variant.path)
            except Exception:
                response["Content-Type"] = "application/octet-stream"

            return response

        except (FileNotFoundError, PermissionError) as e:
            logger.error(f"Error serving file {file_variant.path}: {e}")
            return Response(
                {"error": "Could not read file"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


class SetMainFileView(APIView):
    """
    Set the main (primary) file for a photo.

    Changes which file variant is used as the main display file for the photo.
    Useful when a photo has multiple variants (RAW, JPEG, etc.).
    """

    def post(self, request, image_hash):
        """Set the main file for a photo."""
        file_hash = request.data.get("file_hash")

        if not file_hash:
            return Response(
                {"error": "file_hash is required"}, status=status.HTTP_400_BAD_REQUEST
            )

        # Find the photo
        try:
            photo = Photo.objects.get(
                image_hash=image_hash,
                owner=request.user,
            )
        except Photo.DoesNotExist:
            return Response(
                {"error": "Photo not found"}, status=status.HTTP_404_NOT_FOUND
            )
        except Photo.MultipleObjectsReturned:
            photo = Photo.objects.filter(
                image_hash=image_hash,
                owner=request.user,
            ).first()
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

        photos = Photo.objects.filter(owner=request.user)

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
        angle = request.data.get("angle", 0)
        flip_horizontal = bool(request.data.get("flip_horizontal", False))

        if not image_hash:
            return Response(
                {"status": False, "message": "image_hash is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            angle = int(angle)
        except (TypeError, ValueError):
            return Response(
                {"status": False, "message": "angle must be an integer"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if angle % 90 != 0:
            return Response(
                {"status": False, "message": "angle must be a multiple of 90 degrees"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            photo = Photo.objects.select_related("thumbnail", "main_file", "owner").get(
                image_hash=image_hash, owner=request.user
            )
        except Photo.DoesNotExist:
            return Response(
                {"status": False, "message": "photo not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        if photo.video:
            return Response(
                {"status": False, "message": "rotation is not supported for videos"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            photo.rotate(angle=angle, flip_horizontal=flip_horizontal)
        except Exception as e:
            logger.exception(f"Failed to rotate photo {image_hash}")
            return Response(
                {"status": False, "message": str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
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
