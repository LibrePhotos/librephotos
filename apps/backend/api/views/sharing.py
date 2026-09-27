from django.db.models import Count, Prefetch, Q
from rest_framework.response import Response
from rest_framework.views import APIView

from api.models import AlbumUser, Photo, User
from api.serializers.album_user import AlbumUserListSerializer
from api.serializers.photos import (
    PhotoSummarySerializer,
    SharedFromMePhotoThroughSerializer,
)
from api.util import logger
from api.views.albums import with_album_user_list_relations
from api.views.custom_api_view import ListViewSet
from api.views.pagination import HugeResultsSetPagination


class SharedToMePhotoSuperSimpleListViewSet(ListViewSet):
    serializer_class = PhotoSummarySerializer
    pagination_class = HugeResultsSetPagination

    def get_queryset(self):
        return (
            Photo.visible.filter(Q(shared_to__id__exact=self.request.user.id))
            .only(
                "image_hash",
                "public",
                "rating",
                "owner",
                "hidden",
                "exif_timestamp",
            )
            .prefetch_related("owner")
            .order_by("exif_timestamp")
        )


class SharedFromMePhotoSuperSimpleListViewSet(ListViewSet):
    serializer_class = SharedFromMePhotoThroughSerializer
    pagination_class = HugeResultsSetPagination

    def get_queryset(self):
        ThroughModel = Photo.shared_to.through

        user_photos = Photo.visible.owned_by(self.request.user).only("image_hash")
        qs = (
            ThroughModel.objects.filter(photo_id__in=user_photos)
            .prefetch_related(
                Prefetch(
                    "user",
                    queryset=User.objects.only(
                        "id", "username", "first_name", "last_name"
                    ),
                )
            )
            .prefetch_related(
                Prefetch(
                    "photo",
                    queryset=Photo.objects.filter(hidden=False).only(
                        "image_hash", "rating", "hidden", "exif_timestamp", "public"
                    ),
                )
            )
            .order_by("photo__exif_timestamp")
        )
        return qs


class SharedToMeAlbumUserListViewSet(ListViewSet):
    serializer_class = AlbumUserListSerializer
    pagination_class = HugeResultsSetPagination

    def get_queryset(self):
        return with_album_user_list_relations(
            AlbumUser.objects.filter(
                shared_to__id__exact=self.request.user.id
            ).order_by("id")
        )


class SharedFromMeAlbumUserListViewSet(ListViewSet):
    serializer_class = AlbumUserListSerializer
    pagination_class = HugeResultsSetPagination

    def get_queryset(self):
        return with_album_user_list_relations(
            AlbumUser.objects.annotate(shared_to_count=Count("shared_to"))
            .filter(shared_to_count__gt=0)
            .filter(owner=self.request.user.id)
            .order_by("id")
        )


class SetUserAlbumShared(APIView):
    def post(self, request, format=None):
        data = dict(request.data)
        shared = data["shared"]  # bool
        target_user_id = data["target_user_id"]  # user pk, int
        user_album_id = data["album_id"]

        try:
            target_user = User.objects.get(id=target_user_id)
        except User.DoesNotExist:
            logger.warning(
                f"Cannot share album to user: target user_id {target_user_id} does not exist"
            )
            return Response({"status": False, "message": "No such user"}, status=400)

        try:
            user_album_to_share = AlbumUser.objects.get(id=user_album_id)
        except AlbumUser.DoesNotExist:
            logger.warning(
                f"Cannot share album to user: source user_album_id {user_album_id} does not exist"
            )
            return Response({"status": False, "message": "No such album"}, status=400)

        if user_album_to_share.owner != request.user:
            logger.warning(
                f"Cannot share album to user: source user_album_id {user_album_id} does not belong to user_id {request.user.id}"
            )
            return Response(
                {"status": False, "message": "You cannot share an album you don't own"},
                status=400,
            )

        if shared:
            user_album_to_share.shared_to.add(target_user)
            logger.info(
                f"Shared user {request.user.id}'s album {user_album_id} to user {target_user_id}"
            )
        else:
            user_album_to_share.shared_to.remove(target_user)
            logger.info(
                f"Unshared user {request.user.id}'s album {user_album_id} to user {target_user_id}"
            )

        user_album_to_share.save()
        return Response(AlbumUserListSerializer(user_album_to_share).data)
