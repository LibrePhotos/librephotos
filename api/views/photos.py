from django.db.models import Prefetch, Q
from drf_spectacular.utils import OpenApiParameter, OpenApiTypes, extend_schema
from rest_framework import filters, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response
from rest_framework.views import APIView

from api.models import File, Photo, User
from api.permissions import IsOwnerOrReadOnly, IsPhotoOrAlbumSharedTo
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

PHOTO_OWNER_ERROR_MESSAGE = "you are not the owner of this photo"


class RecentlyAddedPhotoListViewSet(ListViewSet):
    serializer_class = PhotoSummarySerializer
    pagination_class = HugeResultsSetPagination

    def get_queryset(self):
        latestDate = (
            Photo.visible.filter(Q(owner=self.request.user))
            .only("added_on")
            .order_by("-added_on")
            .first()
            .added_on
        )
        queryset = (
            Photo.visible.filter(
                Q(owner=self.request.user)
                & Q(aspect_ratio__isnull=False)
                & Q(
                    added_on__year=latestDate.year,
                    added_on__month=latestDate.month,
                    added_on__day=latestDate.day,
                )
            )
            .prefetch_related(
                "owner",
                Prefetch(
                    "main_file__embedded_media",
                    queryset=File.objects.only("hash"),
                ),
            )
            .order_by("-added_on")
        )
        return queryset

    def list(self, *args, **kwargs):
        queryset = self.get_queryset()
        latestDate = (
            Photo.visible.filter(Q(owner=self.request.user))
            .only("added_on")
            .order_by("-added_on")
            .first()
            .added_on
        )
        serializer = PhotoSummarySerializer(queryset, many=True)
        return Response({"date": latestDate, "results": serializer.data})


class NoTimestampPhotoViewSet(ListViewSet):
    serializer_class = PhotoSummarySerializer
    pagination_class = RegularResultsSetPagination
    filter_backends = (filters.SearchFilter,)
    search_fields = ["search_captions", "search_location", "faces__person__name"]

    def get_queryset(self):
        return (
            Photo.visible.filter(Q(exif_timestamp=None) & Q(owner=self.request.user))
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
            .order_by("added_on")
        )

    def list(self, *args, **kwargs):
        return super(NoTimestampPhotoViewSet, self).list(*args, **kwargs)


class SetPhotosDeleted(APIView):
    def post(self, request, format=None):
        data = dict(request.data)
        val_hidden = data["deleted"]
        image_hashes = data["image_hashes"]

        updated = []
        not_updated = []
        for image_hash in image_hashes:
            try:
                photo = Photo.objects.get(image_hash=image_hash)
            except Photo.DoesNotExist:
                logger.warning(
                    "Could not set photo {} to hidden. It does not exist.".format(
                        image_hash
                    )
                )
                continue
            if photo.owner == request.user and photo.deleted != val_hidden:
                photo.deleted = val_hidden
                photo.save()
                updated.append(PhotoSerializer(photo).data)
            else:
                not_updated.append(PhotoSerializer(photo).data)

        if val_hidden:
            logger.info(
                "{} photos were set hidden. {} photos were already deleted.".format(
                    len(updated), len(not_updated)
                )
            )
        else:
            logger.info(
                "{} photos were set unhidden. {} photos were already recovered.".format(
                    len(updated), len(not_updated)
                )
            )
        return Response(
            {
                "status": True,
                "results": updated,
                "updated": updated,
                "not_updated": not_updated,
            }
        )


class SetPhotosFavorite(APIView):
    def post(self, request, format=None):
        data = dict(request.data)
        val_favorite = data["favorite"]
        image_hashes = data["image_hashes"]

        updated = []
        not_updated = []
        user = User.objects.get(username=request.user)
        for image_hash in image_hashes:
            try:
                photo = Photo.objects.get(image_hash=image_hash)
            except Photo.DoesNotExist:
                logger.warning(
                    "Could not set photo {} to favorite. It does not exist.".format(
                        image_hash
                    )
                )
                continue
            if photo.owner == request.user:
                if val_favorite and photo.rating < user.favorite_min_rating:
                    photo.rating = user.favorite_min_rating
                    photo.save()
                    updated.append(PhotoSerializer(photo).data)
                elif not val_favorite and photo.rating >= user.favorite_min_rating:
                    photo.rating = 0
                    photo.save()
                    updated.append(PhotoSerializer(photo).data)
                else:
                    not_updated.append(PhotoSerializer(photo).data)
            else:
                not_updated.append(PhotoSerializer(photo).data)

        if val_favorite:
            logger.info(
                "{} photos were added to favorites. {} photos were already in favorites.".format(
                    len(updated), len(not_updated)
                )
            )
        else:
            logger.info(
                "{} photos were removed from favorites. {} photos were already not in favorites.".format(
                    len(updated), len(not_updated)
                )
            )
        return Response(
            {
                "status": True,
                "results": updated,
                "updated": updated,
                "not_updated": not_updated,
            }
        )


class SetPhotosHidden(APIView):
    def post(self, request, format=None):
        data = dict(request.data)
        val_hidden = data["hidden"]
        image_hashes = data["image_hashes"]

        updated = []
        not_updated = []
        for image_hash in image_hashes:
            try:
                photo = Photo.objects.get(image_hash=image_hash)
            except Photo.DoesNotExist:
                logger.warning(
                    "Could not set photo {} to hidden. It does not exist.".format(
                        image_hash
                    )
                )
                continue
            if photo.owner == request.user and photo.hidden != val_hidden:
                photo.hidden = val_hidden
                photo.save()
                updated.append(PhotoSerializer(photo).data)
            else:
                not_updated.append(PhotoSerializer(photo).data)

        if val_hidden:
            logger.info(
                "{} photos were set hidden. {} photos were already hidden.".format(
                    len(updated), len(not_updated)
                )
            )
        else:
            logger.info(
                "{} photos were set unhidden. {} photos were already unhidden.".format(
                    len(updated), len(not_updated)
                )
            )
        return Response(
            {
                "status": True,
                "results": updated,
                "updated": updated,
                "not_updated": not_updated,
            }
        )


class PhotoViewSet(viewsets.ModelViewSet):
    serializer_class = PhotoSerializer
    pagination_class = HugeResultsSetPagination
    filter_backends = (filters.SearchFilter,)
    search_fields = [
        "search_captions",
        "search_location",
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

    def get_permissions(self):
        if self.action == "list" or self.action == "retrieve":
            permission_classes = [IsPhotoOrAlbumSharedTo]
        else:  # pragma: no cover - unused
            permission_classes = [IsAdminUser or IsOwnerOrReadOnly]
        return [permission() for permission in permission_classes]

    def get_queryset(self):
        if self.request.user.is_anonymous:
            return Photo.visible.filter(Q(public=True)).order_by("-exif_timestamp")
        else:
            return Photo.objects.order_by("-exif_timestamp")

    def retrieve(self, *args, **kwargs):
        return super(PhotoViewSet, self).retrieve(*args, **kwargs)

    def list(self, *args, **kwargs):  # pragma: no cover - unused
        return super(PhotoViewSet, self).list(*args, **kwargs)


class PhotoEditViewSet(viewsets.ModelViewSet):
    serializer_class = PhotoEditSerializer
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        return Photo.visible.filter(Q(owner=self.request.user))

    def retrieve(
        self, *args, **kwargs
    ):  # pragma: no cover TODO(sickelap): remove unused code
        return super(PhotoEditViewSet, self).retrieve(*args, **kwargs)

    def list(
        self, *args, **kwargs
    ):  # pragma: no cover TODO(sickelap): remove unused code
        return super(PhotoEditViewSet, self).list(*args, **kwargs)


class SetPhotosShared(APIView):
    def post(self, request, format=None):
        data = dict(request.data)
        shared = data["shared"]  # bool
        target_user_id = data["target_user_id"]  # user pk, int
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

        ThroughModel = Photo.shared_to.through

        if shared:
            already_existing = ThroughModel.objects.filter(
                user_id=target_user_id, photo_id__in=image_hashes
            ).only("photo_id")
            already_existing_image_hashes = [e.photo_id for e in already_existing]
            # print(already_existing)
            res = ThroughModel.objects.bulk_create(
                [
                    ThroughModel(user_id=target_user_id, photo_id=image_hash)
                    for image_hash in image_hashes
                    if image_hash not in already_existing_image_hashes
                ]
            )
            logger.info(
                "Shared {}'s {} images to user {}".format(
                    request.user.id, len(res), target_user_id
                )
            )
            res_count = len(res)
        else:
            res = ThroughModel.objects.filter(
                user_id=target_user_id, photo_id__in=image_hashes
            ).delete()
            logger.info(
                "Unshared {}'s {} images to user {}".format(
                    request.user.id, len(res), target_user_id
                )
            )
            res_count = res[0]

        return Response({"status": True, "count": res_count})


class SetPhotosPublic(APIView):
    def post(self, request, format=None):
        data = dict(request.data)
        val_public = data["val_public"]
        image_hashes = data["image_hashes"]

        updated = []
        not_updated = []
        for image_hash in image_hashes:
            try:
                photo = Photo.objects.get(image_hash=image_hash)
            except Photo.DoesNotExist:
                logger.warning(
                    "Could not set photo {} to public. It does not exist.".format(
                        image_hash
                    )
                )
                continue
            if photo.owner == request.user and photo.public != val_public:
                photo.public = val_public
                photo.save()
                updated.append(PhotoSerializer(photo).data)
            else:
                not_updated.append(PhotoSerializer(photo).data)

        if val_public:
            logger.info(
                "{} photos were set public. {} photos were already public.".format(
                    len(updated), len(not_updated)
                )
            )
        else:
            logger.info(
                "{} photos were set private. {} photos were already public.".format(
                    len(updated), len(not_updated)
                )
            )

        return Response(
            {
                "status": True,
                "results": updated,
                "updated": updated,
                "not_updated": not_updated,
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
                {"status": False, "message": PHOTO_OWNER_ERROR_MESSAGE},
                status=400,
            )

        res = photo._generate_captions_im2txt()
        return Response({"status": res})


class SavePhotoCaption(APIView):
    permission_classes = (IsOwnerOrReadOnly,)

    def post(self, request, format=None):
        data = dict(request.data)
        image_hash = data["image_hash"]
        caption = data["caption"]

        photo = Photo.objects.get(image_hash=image_hash)
        if photo.owner != request.user:
            return Response(
                {"status": False, "message": PHOTO_OWNER_ERROR_MESSAGE},
                status=400,
            )

        res = photo._save_captions(caption=caption)
        return Response({"status": res})


class DeletePhotos(APIView):
    def delete(self, request):
        data = dict(request.data)
        photos = Photo.objects.in_bulk(data["image_hashes"])

        deleted = []
        not_deleted = []
        for photo in photos.values():
            if photo.owner == request.user and photo.deleted:
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

class RotatePhoto(APIView):
    permission_classes = (IsOwnerOrReadOnly,)

    def post(self, request, format=None):
        data = dict(request.data)
        image_hash = data["image_hash"]

        angle = data["angle"]
        flip = data.get("flip", False)

        photo = Photo.objects.get(image_hash=image_hash)
        if photo.owner != request.user:
            return Response(
                {"status": False, "message": PHOTO_OWNER_ERROR_MESSAGE},
                status=400,
            )

        photo._rotate_image(angle, flip)
        return Response({"status": True})