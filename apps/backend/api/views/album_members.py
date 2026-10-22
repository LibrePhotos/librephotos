"""Collaborative albums (#464): members add and remove their own photos.

The owner shares an album with a role per user (``api/useralbum/share/``).
A contributor adds photos from their own library here and takes their own
photos out again; the owner takes out any photo. Every member sets what the
others see of the photos they add. Renaming, the cover, the lock, deleting,
inviting and the public link stay with the owner (``AlbumUserViewSet``,
``AlbumUserEditViewSet``, ``SetUserAlbumShared``, ``SetUserAlbumPublic``).
"""

from typing import Any

from django.db.models import QuerySet
from drf_spectacular.utils import extend_schema
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from api.albums import members
from api.drf.params import parse_body
from api.drf.request_user import request_user
from api.models import Photo, User
from api.photos.selection import build_photo_queryset
from api.serializers.album_user import (
    AlbumMembershipRequest,
    AlbumMemberSwitchesSerializer,
    AlbumPhotosAddRequest,
    AlbumPhotosChangedSerializer,
    AlbumPhotosRemoveRequest,
)


def _photos_to_add(user: User, data: dict[str, Any]) -> QuerySet[Photo]:
    """The requester's photos a request names: a list, or a select-all query."""
    if data["select_all"]:
        photos = build_photo_queryset(user, data["query"])
        if data["excluded_hashes"]:
            photos = photos.exclude(image_hash__in=data["excluded_hashes"])
        return photos
    wanted = set(data["photos"])
    photos = Photo.objects.owned_by(user).filter(pk__in=wanted)
    if photos.count() != len(wanted):
        # Fail closed, as OwnedPhotoField does: another user's id is
        # refused like an unknown one, and nothing is added.
        raise ValidationError({"photos": "Only your own photos can be added"})
    return photos


class AlbumPhotosAddView(APIView):
    """Add photos of your own to an album you own or contribute to.

    The photos stay yours: the album only links them, and its members see
    them with the fields both you and the album's owner allow. Refused for a
    viewer and while the album is locked; an album you are not in is a 404.
    """

    permission_classes = (IsAuthenticated,)

    @extend_schema(
        request=AlbumPhotosAddRequest, responses=AlbumPhotosChangedSerializer
    )
    def post(self, request: Request, album_id: int) -> Response:
        user = request_user(request)
        album = members.album_for_member(album_id, user)
        data = parse_body(request, AlbumPhotosAddRequest)
        count = members.add_photos(album, user, _photos_to_add(user, data))
        return Response({"count": count})


class AlbumPhotosRemoveView(APIView):
    """Take photos out of an album; they stay in their owner's library.

    The owner takes out any photo, a contributor only the photos they added.
    """

    permission_classes = (IsAuthenticated,)

    @extend_schema(
        request=AlbumPhotosRemoveRequest, responses=AlbumPhotosChangedSerializer
    )
    def post(self, request: Request, album_id: int) -> Response:
        user = request_user(request)
        album = members.album_for_member(album_id, user)
        data = parse_body(request, AlbumPhotosRemoveRequest)
        count = members.remove_photos(album, user, data["photos"])
        return Response({"count": count})


class AlbumMembershipView(APIView):
    """Your own switches in an album shared with you.

    What the other members may see of the photos you add: each field shows
    only where the album's owner allows it too. A 404 for an album that is
    not shared with you, your own included.
    """

    permission_classes = (IsAuthenticated,)

    @extend_schema(
        request=AlbumMembershipRequest, responses=AlbumMemberSwitchesSerializer
    )
    def patch(self, request: Request, album_id: int) -> Response:
        user = request_user(request)
        album = members.album_for_member(album_id, user)
        member = members.membership_of(album, user)
        members.update_switches(member, parse_body(request, AlbumMembershipRequest))
        return Response(AlbumMemberSwitchesSerializer(member).data)
