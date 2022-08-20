from django.db.models import Count, Prefetch, Q
from rest_framework import viewsets

from api.models import AlbumAuto, AlbumUser, Photo, User
from api.serializers.album_auto import AlbumAutoListSerializer
from api.serializers.album_user import AlbumUserListSerializer
from api.serializers.photos import (
    PigPhotoSerilizer,
    SharedFromMePhotoThroughSerializer,
    SharedPhotoSuperSimpleSerializer,
)
from api.views.pagination import HugeResultsSetPagination


class SharedToMeAlbumUserListViewSet(viewsets.ModelViewSet):

    serializer_class = AlbumUserListSerializer
    pagination_class = HugeResultsSetPagination

    def get_queryset(self):
        return AlbumUser.objects.filter(shared_to__id__exact=self.request.user.id)


class SharedToMePhotoSuperSimpleListViewSet(viewsets.ModelViewSet):

    serializer_class = PigPhotoSerilizer
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


class SharedFromMePhotoSuperSimpleListViewSet(viewsets.ModelViewSet):

    serializer_class = SharedPhotoSuperSimpleSerializer
    pagination_class = HugeResultsSetPagination

    def get_queryset(self):
        qs = (
            Photo.objects.filter(hidden=False)
            .prefetch_related("owner")
            .prefetch_related(
                Prefetch(
                    "shared_to",
                    queryset=User.objects.only(
                        "id", "username", "first_name", "last_name"
                    ),
                )
            )
            .annotate(shared_to_count=Count("shared_to"))
            .filter(shared_to_count__gt=0)
            .filter(owner=self.request.user.id)
            .only(
                "image_hash",
                "rating",
                "hidden",
                "exif_timestamp",
                "public",
                "shared_to",
                "owner",
            )
            .distinct()
            .order_by("exif_timestamp")
        )
        return qs


class SharedFromMePhotoSuperSimpleListViewSet2(viewsets.ModelViewSet):

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


class SharedToMeAlbumAutoListViewSet(viewsets.ModelViewSet):

    serializer_class = AlbumAutoListSerializer
    pagination_class = HugeResultsSetPagination

    def get_queryset(self):
        return (
            AlbumAuto.objects.annotate(
                photo_count=Count(
                    "photos", filter=Q(photos__hidden=False), distinct=True
                )
            )
            .filter(Q(photo_count__gt=0) & Q(shared_to__id__exact=self.request.user.id))
            .filter(owner=self.request.user)
            .prefetch_related("photos")
            .order_by("-timestamp")
        )


class SharedFromMeAlbumAutoListViewSet(viewsets.ModelViewSet):

    serializer_class = AlbumAutoListSerializer
    pagination_class = HugeResultsSetPagination

    def get_queryset(self):
        return (
            AlbumAuto.objects.annotate(
                photo_count=Count(
                    "photos", filter=Q(photos__hidden=False), distinct=True
                )
            )
            .filter(Q(photo_count__gt=0) & Q(owner=self.request.user))
            .prefetch_related("photos")
            .order_by("-timestamp")
            .annotate(shared_to_count=Count("shared_to"))
            .filter(shared_to_count__gt=0)
            .filter(owner=self.request.user.id)
        )


class SharedFromMeAlbumUserListViewSet(viewsets.ModelViewSet):

    serializer_class = AlbumUserListSerializer
    pagination_class = HugeResultsSetPagination

    def get_queryset(self):
        return (
            AlbumUser.objects.annotate(shared_to_count=Count("shared_to"))
            .filter(shared_to_count__gt=0)
            .filter(owner=self.request.user.id)
        )


class SharedFromMeAlbumUserListViewSet2(viewsets.ModelViewSet):

    serializer_class = AlbumUserListSerializer
    pagination_class = HugeResultsSetPagination

    def get_queryset(self):
        return (
            AlbumUser.objects.annotate(shared_to_count=Count("shared_to"))
            .filter(shared_to_count__gt=0)
            .filter(owner=self.request.user.id)
        )
