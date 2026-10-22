import logging
from typing import Any

from django.db.models import Count, Model, Prefetch, Q, QuerySet
from drf_spectacular.utils import extend_schema, extend_schema_view
from rest_framework import status
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import GenericViewSet

from api.albums.shared_with_me import (
    PLACES,
    THINGS,
    AlbumKind,
    GroupRow,
    group_covers,
    group_photos,
    group_rows,
    place_links,
    thing_links,
)
from api.drf.pagination import DefaultPagination
from api.drf.params import parse_body, parse_query
from api.drf.request_user import request_user
from api.faces.recipients import (
    SharedPersonRow,
    shared_people,
    shared_person_entries,
    shared_person_photos,
)
from api.models import AlbumUser, Photo, User
from api.search.semantic import TAG_THING_TYPE
from api.serializers.album_user import (
    AlbumUserListSerializer,
    LeaveSharedAlbumRequest,
    SetUserAlbumSharedRequest,
    album_user_card,
    with_album_user_list_relations,
)
from api.serializers.photos import (
    PhotoSummarySerializer,
    SharedFromMePhotoThroughSerializer,
    with_photo_summary_relations,
)
from api.serializers.shared_with_me import (
    SharedGroupPhotosQuery,
    SharedGroupSerializer,
    SharedPersonPhotosQuery,
    SharedPersonSerializer,
)
from api.views.custom_api_view import ListViewSet

logger = logging.getLogger(__name__)


class SharedToMePhotoSuperSimpleListViewSet(ListViewSet):
    permission_classes = (IsAuthenticated,)
    serializer_class = PhotoSummarySerializer
    pagination_class = DefaultPagination

    def get_queryset(self) -> QuerySet[Photo]:
        # drf-spectacular asks with an anonymous request; request_user rejects it.
        if getattr(self, "swagger_fake_view", False):
            return Photo.objects.none()
        # PhotoSummarySerializer reads far more than the old "super simple"
        # columns: each deferred field and relation was a query per photo.
        return with_photo_summary_relations(
            Photo.visible.filter(Q(shared_to__id__exact=request_user(self.request).id))
        ).order_by("exif_timestamp")


def _requester(view: GenericViewSet) -> User | None:
    """The signed-in requester; None for drf-spectacular's anonymous request.

    The shared-with-me scopes answer nothing for None.
    """
    if getattr(view, "swagger_fake_view", False):
        return None
    return request_user(view.request)


class _SharedGroupListViewSet(ListViewSet):
    """Places or things of the photos shared with the requester (#2721)."""

    permission_classes = (IsAuthenticated,)
    serializer_class = SharedGroupSerializer
    pagination_class = DefaultPagination
    kind: AlbumKind = PLACES

    def links(self, user: User | None) -> QuerySet[Model]:
        return place_links(user)

    def get_queryset(self) -> QuerySet[Any, GroupRow]:
        return group_rows(self.links(_requester(self)), self.kind)

    def list(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        rows = self.paginate_queryset(self.get_queryset()) or []
        titles = [row["title"] for row in rows]
        covers = group_covers(self.links(_requester(self)), self.kind, titles)
        entries = [
            {**row, "cover_photos": covers.get(row["title"], [])} for row in rows
        ]
        return self.get_paginated_response(self.get_serializer(entries, many=True).data)


class SharedToMePlaceListViewSet(_SharedGroupListViewSet):
    """The places of the photos shared with you, one entry per place name."""


class SharedToMeThingListViewSet(_SharedGroupListViewSet):
    """The things of the photos shared with you, one entry per thing."""

    kind = THINGS

    def links(self, user: User | None) -> QuerySet[Model]:
        return thing_links(user, [TAG_THING_TYPE])


@extend_schema_view(list=extend_schema(parameters=[SharedGroupPhotosQuery]))
class _SharedGroupPhotoListViewSet(ListViewSet):
    """The photos shared with you under one place or thing title.

    A title none of them has is a 404, as after the last one was unshared.
    """

    permission_classes = (IsAuthenticated,)
    serializer_class = PhotoSummarySerializer
    pagination_class = DefaultPagination
    kind: AlbumKind = PLACES

    def links(self, user: User | None) -> QuerySet[Model]:
        return place_links(user)

    def get_queryset(self) -> QuerySet[Photo]:
        if getattr(self, "swagger_fake_view", False):
            return Photo.objects.none()
        title = parse_query(self.request, SharedGroupPhotosQuery)["title"]
        photos = group_photos(self.links(request_user(self.request)), self.kind, title)
        if not photos.exists():
            raise NotFound("Nothing shared with you has this title")
        return with_photo_summary_relations(photos)


class SharedToMePlacePhotoListViewSet(_SharedGroupPhotoListViewSet):
    """The photos shared with you from one place; a 404 when there are none."""


class SharedToMeThingPhotoListViewSet(_SharedGroupPhotoListViewSet):
    """The photos shared with you that show one thing; a 404 when there are none."""

    kind = THINGS

    def links(self, user: User | None) -> QuerySet[Model]:
        return thing_links(user, [TAG_THING_TYPE])


class SharedToMePersonListViewSet(ListViewSet):
    """The named people on the photos shared with you (#2722).

    One entry per owner and person, only for owners who share people's
    names; counts and crops from the shared photos only.
    """

    permission_classes = (IsAuthenticated,)
    serializer_class = SharedPersonSerializer
    pagination_class = DefaultPagination

    def get_queryset(self) -> QuerySet[Any, SharedPersonRow]:
        return shared_people(_requester(self))

    def list(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        rows = self.paginate_queryset(self.get_queryset()) or []
        entries = shared_person_entries(rows)
        return self.get_paginated_response(self.get_serializer(entries, many=True).data)


@extend_schema_view(list=extend_schema(parameters=[SharedPersonPhotosQuery]))
class SharedToMePersonPhotoListViewSet(ListViewSet):
    """The photos shared with you that show one of the shared people.

    A person on none of them (or not shared, or not named) is a 404.
    """

    permission_classes = (IsAuthenticated,)
    serializer_class = PhotoSummarySerializer
    pagination_class = DefaultPagination

    def get_queryset(self) -> QuerySet[Photo]:
        if getattr(self, "swagger_fake_view", False):
            return Photo.objects.none()
        person = parse_query(self.request, SharedPersonPhotosQuery)["person"]
        photos = shared_person_photos(request_user(self.request), person)
        if not photos.exists():
            raise NotFound("No such person on the photos shared with you")
        return with_photo_summary_relations(photos)


class SharedFromMePhotoSuperSimpleListViewSet(ListViewSet):
    permission_classes = (IsAuthenticated,)
    serializer_class = SharedFromMePhotoThroughSerializer
    pagination_class = DefaultPagination

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
    pagination_class = DefaultPagination

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
    pagination_class = DefaultPagination

    def get_queryset(self) -> QuerySet[AlbumUser]:
        # drf-spectacular asks with an anonymous request; request_user rejects it.
        if getattr(self, "swagger_fake_view", False):
            return AlbumUser.objects.none()
        return with_album_user_list_relations(
            AlbumUser.objects.owned_by(request_user(self.request))
            .annotate(shared_to_count=Count("shared_to"))
            .filter(shared_to_count__gt=0)
            .order_by("id")
        )


class SetUserAlbumShared(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(request=SetUserAlbumSharedRequest, responses=AlbumUserListSerializer)
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
                "Cannot share album to user: target user_id %s does not exist",
                target_user_id,
            )
            raise ValidationError("No such user")

        try:
            user_album_to_share = AlbumUser.objects.get(id=user_album_id)
        except AlbumUser.DoesNotExist:
            logger.warning(
                "Cannot share album to user: source user_album_id %s does not exist",
                user_album_id,
            )
            raise ValidationError("No such album")

        if user_album_to_share.owner != user:
            logger.warning(
                "Cannot share album to user: source user_album_id %s does not belong to user_id %s",
                user_album_id,
                user.id,
            )
            raise ValidationError("You cannot share an album you don't own")

        if shared:
            user_album_to_share.shared_to.add(target_user)
            logger.info(
                "Shared user %s's album %s to user %s",
                user.id,
                user_album_id,
                target_user_id,
            )
        else:
            user_album_to_share.shared_to.remove(target_user)
            logger.info(
                "Unshared user %s's album %s to user %s",
                user.id,
                user_album_id,
                target_user_id,
            )

        user_album_to_share.save()
        return Response(album_user_card(user_album_to_share, request))


class LeaveSharedAlbum(APIView):
    """A recipient takes an album someone shared with them off their list (#2210).

    Only the caller leaves: the owner and the other recipients keep the album.
    An album that is not shared with the caller, their own included, is a 404,
    so the answer does not tell whether the id exists.
    """

    permission_classes = (IsAuthenticated,)

    @extend_schema(request=LeaveSharedAlbumRequest, responses={204: None})
    def post(self, request: Request, format: str | None = None) -> Response:
        user = request_user(request)
        album_id = parse_body(request, LeaveSharedAlbumRequest)["album_id"]
        try:
            album = AlbumUser.objects.shared_with(user).get(id=album_id)
        except AlbumUser.DoesNotExist:
            raise NotFound("No such album shared with you")
        # Through the related manager, so the m2m_changed receiver in
        # api/sync_signals.py bumps the album and writes the tombstone that
        # takes it off the caller's phone, as an unshare by the owner does.
        album.shared_to.remove(user)
        logger.info("User %s left album %s", user.id, album.id)
        return Response(status=status.HTTP_204_NO_CONTENT)
