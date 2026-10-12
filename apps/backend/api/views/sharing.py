import logging

from django.db.models import Count, Model, Prefetch, Q, QuerySet
from drf_spectacular.utils import extend_schema
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from api.models import AlbumUser, Photo, User
from api.request_user import request_user
from api.serializers.album_user import (
    AlbumUserListSerializer,
    SetUserAlbumSharedRequest,
    album_user_card,
    with_album_user_list_relations,
)
from api.serializers.photos import (
    PhotoSummarySerializer,
    SharedFromMePhotoThroughSerializer,
    with_photo_summary_relations,
)
from api.views.custom_api_view import ListViewSet
from api.views.pagination import HugeResultsSetPagination
from api.views.params import parse_body

logger = logging.getLogger(__name__)


class SharedToMePhotoSuperSimpleListViewSet(ListViewSet):
    permission_classes = (IsAuthenticated,)
    serializer_class = PhotoSummarySerializer
    pagination_class = HugeResultsSetPagination

    def get_queryset(self) -> QuerySet[Photo]:
        # drf-spectacular asks with an anonymous request; request_user rejects it.
        if getattr(self, "swagger_fake_view", False):
            return Photo.objects.none()
        # PhotoSummarySerializer reads far more than the old "super simple"
        # columns: each deferred field and relation was a query per photo.
        return with_photo_summary_relations(
            Photo.visible.filter(Q(shared_to__id__exact=request_user(self.request).id))
        ).order_by("exif_timestamp")


class SharedFromMePhotoSuperSimpleListViewSet(ListViewSet):
    permission_classes = (IsAuthenticated,)
    serializer_class = SharedFromMePhotoThroughSerializer
    pagination_class = HugeResultsSetPagination

    def get_queryset(self) -> QuerySet[Model]:
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
                    queryset=with_photo_summary_relations(
                        Photo.objects.filter(hidden=False)
                    ),
                )
            )
            .order_by("photo__exif_timestamp")
        )
        return qs


class SharedToMeAlbumUserListViewSet(ListViewSet):
    permission_classes = (IsAuthenticated,)
    serializer_class = AlbumUserListSerializer
    pagination_class = HugeResultsSetPagination

    def get_queryset(self) -> QuerySet[AlbumUser]:
        # drf-spectacular asks with an anonymous request; request_user rejects it.
        if getattr(self, "swagger_fake_view", False):
            return AlbumUser.objects.none()
        return with_album_user_list_relations(
            AlbumUser.objects.filter(
                shared_to__id__exact=request_user(self.request).id
            ).order_by("id")
        )


class SharedFromMeAlbumUserListViewSet(ListViewSet):
    permission_classes = (IsAuthenticated,)
    serializer_class = AlbumUserListSerializer
    pagination_class = HugeResultsSetPagination

    def get_queryset(self) -> QuerySet[AlbumUser]:
        # drf-spectacular asks with an anonymous request; request_user rejects it.
        if getattr(self, "swagger_fake_view", False):
            return AlbumUser.objects.none()
        return with_album_user_list_relations(
            AlbumUser.objects.annotate(shared_to_count=Count("shared_to"))
            .filter(shared_to_count__gt=0)
            .filter(owner=request_user(self.request).id)
            .order_by("id")
        )


class SetUserAlbumShared(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(request=SetUserAlbumSharedRequest)
    def post(self, request: Request, format: str | None = None) -> Response:
        user = request_user(request)
        data = parse_body(request, SetUserAlbumSharedRequest)
        shared = data["shared"]
        target_user_id = data["target_user_id"]
        user_album_id = data["album_id"]

        try:
            target_user = User.objects.get(id=target_user_id)
        except User.DoesNotExist:
            logger.warning(
                f"Cannot share album to user: target user_id {target_user_id} does not exist"
            )
            raise ValidationError("No such user")

        try:
            user_album_to_share = AlbumUser.objects.get(id=user_album_id)
        except AlbumUser.DoesNotExist:
            logger.warning(
                f"Cannot share album to user: source user_album_id {user_album_id} does not exist"
            )
            raise ValidationError("No such album")

        if user_album_to_share.owner != user:
            logger.warning(
                f"Cannot share album to user: source user_album_id {user_album_id} does not belong to user_id {user.id}"
            )
            raise ValidationError("You cannot share an album you don't own")

        if shared:
            user_album_to_share.shared_to.add(target_user)
            logger.info(
                f"Shared user {user.id}'s album {user_album_id} to user {target_user_id}"
            )
        else:
            user_album_to_share.shared_to.remove(target_user)
            logger.info(
                f"Unshared user {user.id}'s album {user_album_id} to user {target_user_id}"
            )

        user_album_to_share.save()
        return Response(album_user_card(user_album_to_share))
