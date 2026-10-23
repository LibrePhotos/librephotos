"""Comments and likes on the photos of a shared album (#262).

Every route resolves the thread through ``api.albums.comments.thread_of``:
the album must be the requester's or shared with them, and show the photo;
anything else is a 404, so the answer never says whether a thread exists.
"""

from typing import Any
from uuid import UUID

from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.throttling import BaseThrottle
from rest_framework.views import APIView

from api.accounts.throttling import AlbumCommentRateThrottle
from api.albums import comments
from api.drf.pagination import PAGE_PARAMETERS, PaginatedViewMixin
from api.drf.params import parse_body
from api.drf.request_user import request_user
from api.serializers.album_comments import (
    AlbumCommentPageSerializer,
    AlbumCommentRequest,
    AlbumCommentSerializer,
    AlbumLikesSerializer,
)
from api.serializers.simple import SimpleUserSerializer


class _WriteThrottledView(APIView):
    """Writing a comment is rate limited per user; reading is not."""

    permission_classes = (IsAuthenticated,)

    def get_throttles(self) -> list[BaseThrottle]:
        if self.request.method in ("POST", "PATCH", "PUT"):
            return [AlbumCommentRateThrottle()]
        return []


class AlbumPhotoCommentsView(PaginatedViewMixin, _WriteThrottledView):
    """The comments on a photo in an album you own or are a member of."""

    @extend_schema(
        operation_id="api_album_photo_comments_list",
        parameters=PAGE_PARAMETERS,
        responses=AlbumCommentPageSerializer,
    )
    def get(self, request: Request, album_id: int, photo_id: UUID) -> Response:
        album, photo = comments.thread_of(album_id, photo_id, request_user(request))
        page = self.paginate_queryset(comments.comments_on(album, photo))
        context = {"request": request, "album": album}
        data = AlbumCommentSerializer(page, many=True, context=context).data
        return self.get_paginated_response(data)

    @extend_schema(request=AlbumCommentRequest, responses={201: AlbumCommentSerializer})
    def post(self, request: Request, album_id: int, photo_id: UUID) -> Response:
        """Comment on the photo; refused while the owner has comments off."""
        user = request_user(request)
        album, photo = comments.thread_of(album_id, photo_id, user)
        text = parse_body(request, AlbumCommentRequest)["text"]
        comment = comments.add_comment(album, photo, user, text)
        context = {"request": request, "album": album}
        return Response(
            AlbumCommentSerializer(comment, context=context).data,
            status=status.HTTP_201_CREATED,
        )


class AlbumPhotoCommentView(_WriteThrottledView):
    """One comment: its author edits it; its author or the album's owner deletes it."""

    @extend_schema(request=AlbumCommentRequest, responses=AlbumCommentSerializer)
    def patch(
        self, request: Request, album_id: int, photo_id: UUID, comment_id: int
    ) -> Response:
        user = request_user(request)
        album, photo = comments.thread_of(album_id, photo_id, user)
        comment = comments.comment_in(album, photo, comment_id)
        text = parse_body(request, AlbumCommentRequest)["text"]
        comments.edit_comment(comment, user, text)
        context = {"request": request, "album": album}
        return Response(AlbumCommentSerializer(comment, context=context).data)

    @extend_schema(responses={204: None})
    def delete(
        self, request: Request, album_id: int, photo_id: UUID, comment_id: int
    ) -> Response:
        user = request_user(request)
        album, photo = comments.thread_of(album_id, photo_id, user)
        comment = comments.comment_in(album, photo, comment_id)
        comments.delete_comment(comment, album, user)
        return Response(status=status.HTTP_204_NO_CONTENT)


class AlbumPhotoLikesView(_WriteThrottledView):
    """The hearts on a photo in an album: read them, heart it (PUT), take it back (DELETE)."""

    def _answer(self, request: Request, album_id: int, photo_id: UUID) -> Response:
        user = request_user(request)
        album, photo = comments.thread_of(album_id, photo_id, user)
        users = comments.likers_of(album, photo)
        # The shape AlbumLikesSerializer documents.
        data: dict[str, Any] = {
            "count": len(users),
            "liked_by_me": any(liker.pk == user.pk for liker in users),
            "users": SimpleUserSerializer(users, many=True).data,
        }
        return Response(data)

    @extend_schema(
        operation_id="api_album_photo_likes_retrieve",
        responses=AlbumLikesSerializer,
    )
    def get(self, request: Request, album_id: int, photo_id: UUID) -> Response:
        return self._answer(request, album_id, photo_id)

    @extend_schema(request=None, responses=AlbumLikesSerializer)
    def put(self, request: Request, album_id: int, photo_id: UUID) -> Response:
        user = request_user(request)
        album, photo = comments.thread_of(album_id, photo_id, user)
        comments.set_liked(album, photo, user, True)
        return self._answer(request, album_id, photo_id)

    @extend_schema(request=None, responses=AlbumLikesSerializer)
    def delete(self, request: Request, album_id: int, photo_id: UUID) -> Response:
        user = request_user(request)
        album, photo = comments.thread_of(album_id, photo_id, user)
        comments.set_liked(album, photo, user, False)
        return self._answer(request, album_id, photo_id)
