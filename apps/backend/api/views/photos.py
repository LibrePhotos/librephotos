from django.db.models import Prefetch, Q
from drf_spectacular.utils import OpenApiParameter, OpenApiTypes, extend_schema
from rest_framework import filters, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response
from rest_framework.views import APIView

from api.models import AlbumUser, File, Photo, User
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
        queryset = (
            Photo.visible.filter(
                Q(owner=self.request.user)
                & Q(thumbnail__aspect_ratio__isnull=False)
                & Q(
                    added_on__year=latest_date.year,
                    added_on__month=latest_date.month,
                    added_on__day=latest_date.day,
                )
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

            # If restoring from trash, reset duplicate groups to pending
            if not val_deleted:
                from api.models.duplicate_group import DuplicateGroup
                group_ids = set(photos_qs.filter(duplicate_group__isnull=False).values_list('duplicate_group_id', flat=True))
                if group_ids:
                    DuplicateGroup.objects.filter(id__in=group_ids, status=DuplicateGroup.Status.REVIEWED).update(status=DuplicateGroup.Status.PENDING)
                    logger.info(f"Reset {len(group_ids)} duplicate groups to pending after restore")

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
            
            # If restoring from trash, reset duplicate groups to pending
            if not val_deleted:
                from api.models.duplicate_group import DuplicateGroup
                group_ids = set(
                    Photo.objects.filter(
                        image_hash__in=photos_to_update, 
                        duplicate_group__isnull=False
                    ).values_list('duplicate_group_id', flat=True)
                )
                if group_ids:
                    DuplicateGroup.objects.filter(
                        id__in=group_ids, 
                        status=DuplicateGroup.Status.REVIEWED
                    ).update(status=DuplicateGroup.Status.PENDING)
                    logger.info(f"Reset {len(group_ids)} duplicate groups to pending after restore")

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

    @action(
        detail=True,
        methods=["get"],
        name="summary",
        serializer_class=PhotoDetailsSummarySerializer,
    )
    def summary(self, request, pk):
        queryset = self.get_queryset().filter(image_hash=pk)
        if not queryset.exists():
            return Response(status=status.HTTP_404_NOT_FOUND)
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
            return Photo.visible.filter(Q(public=True)).order_by("-exif_timestamp")
        else:
            # Include photos that are:
            # 1. Owned by the user
            # 2. Shared directly with the user
            # 3. Public (for retrieve access)
            # Note: Photos in shared albums are handled by the permission class
            return Photo.visible.filter(
                Q(owner=self.request.user)
                | Q(shared_to=self.request.user)
                | Q(public=True)
            ).order_by("-exif_timestamp")

    def retrieve(self, *args, **kwargs):
        return super().retrieve(*args, **kwargs)

    def list(self, *args, **kwargs):  # pragma: no cover - unused
        return super().list(*args, **kwargs)


class PhotoEditViewSet(viewsets.ModelViewSet):
    serializer_class = PhotoEditSerializer
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        return Photo.visible.filter(Q(owner=self.request.user))

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

        if shared:
            already_existing = through_model.objects.filter(
                user_id=target_user_id, photo_id__in=image_hashes
            ).only("photo_id")
            already_existing_image_hashes = [e.photo_id for e in already_existing]
            # print(already_existing)
            res = through_model.objects.bulk_create(
                [
                    through_model(user_id=target_user_id, photo_id=image_hash)
                    for image_hash in image_hashes
                    if image_hash not in already_existing_image_hashes
                ]
            )
            logger.info(
                f"Shared {request.user.id}'s {len(res)} images to user {target_user_id}"
            )
            res_count = len(res)
        else:
            res = through_model.objects.filter(
                user_id=target_user_id, photo_id__in=image_hashes
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

        photo = Photo.objects.get(image_hash=image_hash)
        if photo.owner != request.user:
            return Response(
                {"status": False, "message": "you are not the owner of this photo"},
                status=400,
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

        photo = Photo.objects.get(image_hash=image_hash)
        if photo.owner != request.user:
            return Response(
                {"status": False, "message": "you are not the owner of this photo"},
                status=400,
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
        photos = Photo.objects.in_bulk(data["image_hashes"])

        deleted = []
        not_deleted = []
        for photo in photos.values():
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


class DeleteDuplicatePhotos(APIView):
    @extend_schema(
        parameters=[
            OpenApiParameter("image_hash", OpenApiTypes.STR),
            OpenApiParameter("path", OpenApiTypes.STR),
        ],
    )
    def delete(self, request):
        data = dict(request.data)
        logger.info(data)
        photo = Photo.objects.filter(image_hash=data["image_hash"]).first()
        duplicate_path = data["path"]

        if not photo:
            return Response(status=status.HTTP_404_NOT_FOUND)

        result = photo.delete_duplicate(duplicate_path)
        # To-Do: Give a better response, when it's a bad request
        if result:
            return Response(status=status.HTTP_200_OK)
        else:
            return Response(status=status.HTTP_400_BAD_REQUEST)
