from django.db.models import Count, Prefetch, Q

from api.models import AlbumUser, Photo, User
from api.serializers.album_user import AlbumUserListSerializer
from api.serializers.photos import (
    PhotoSummarySerializer,
    SharedFromMePhotoThroughSerializer,
)
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

        user_photos = Photo.visible.filter(Q(owner=self.request.user.id)).only(
            "image_hash"
        )
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
        return AlbumUser.objects.filter(shared_to__id__exact=self.request.user.id)


class SharedFromMeAlbumUserListViewSet(ListViewSet):
    serializer_class = AlbumUserListSerializer
    pagination_class = HugeResultsSetPagination

    def get_queryset(self):
        return (
            AlbumUser.objects.annotate(shared_to_count=Count("shared_to"))
            .filter(shared_to_count__gt=0)
            .filter(owner=self.request.user.id)
        )
