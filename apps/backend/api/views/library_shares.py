"""``/api/library-shares/``: share a whole library read-only (#2731).

The owner starts a share, changes what the recipient sees and stops it; the
recipient turns "Show in my timeline" on or off and can leave. Either side
sees the share in the list; anyone else gets a 404 for its id.
"""

import logging
from typing import Any

from django.db.models import QuerySet
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, status, viewsets
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response

from api.drf.exceptions import Conflict
from api.drf.pagination import DefaultPagination
from api.drf.params import parse_body
from api.drf.request_user import request_user
from api.models import LibraryShare, User
from api.models.user import get_deleted_user
from api.serializers.library_share import (
    OWNER_FIELDS,
    RECIPIENT_FIELDS,
    CreateLibraryShareRequest,
    LibraryShareSerializer,
    UpdateLibraryShareRequest,
    with_library_share_relations,
)

logger = logging.getLogger(__name__)


def _recipient(user: User, recipient_id: int) -> User:
    """The active account ``recipient_id``; 400 for oneself or no such user."""
    if recipient_id == user.pk:
        raise ValidationError(
            {"recipient_id": "You cannot share your library with yourself"}
        )
    recipient = (
        User.objects.filter(pk=recipient_id, is_active=True)
        .exclude(pk=get_deleted_user().pk)
        .first()
    )
    if recipient is None:
        raise ValidationError({"recipient_id": "No such user"})
    return recipient


def _changes_for(user: User, share: LibraryShare, data: dict[str, Any]) -> list[str]:
    """The fields of ``data`` the requester's side may change; 400 for others."""
    mine = OWNER_FIELDS if share.owner_id == user.pk else RECIPIENT_FIELDS
    theirs = sorted(set(data) - set(mine))
    if theirs:
        side = "recipient" if share.owner_id == user.pk else "owner"
        raise ValidationError(
            {name: f"Only the {side} changes this" for name in theirs}
        )
    return list(data)


class LibraryShareViewSet(
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """The library shares the requester gave or received."""

    permission_classes = (IsAuthenticated,)
    serializer_class = LibraryShareSerializer
    pagination_class = DefaultPagination

    def get_queryset(self) -> QuerySet[LibraryShare]:
        if getattr(self, "swagger_fake_view", False):
            return LibraryShare.objects.none()
        return with_library_share_relations(
            LibraryShare.objects.involving(request_user(self.request))
        ).order_by("created_at", "id")

    def _share(self, pk: str | int | None) -> LibraryShare:
        if pk is None:
            raise NotFound("No such library share")
        try:
            return self.get_queryset().get(pk=pk)
        except LibraryShare.DoesNotExist, ValueError, TypeError:
            raise NotFound("No such library share")

    @extend_schema(
        request=CreateLibraryShareRequest, responses={201: LibraryShareSerializer}
    )
    def create(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        user = request_user(request)
        data = parse_body(request, CreateLibraryShareRequest)
        recipient = _recipient(user, data.pop("recipient_id"))
        if LibraryShare.objects.owned_by(user).filter(recipient=recipient).exists():
            raise Conflict(
                "Your library is already shared with this user",
                code="library_already_shared",
            )
        share = LibraryShare.objects.create(owner=user, recipient=recipient, **data)
        logger.info("User %s shared their library with user %s", user.pk, recipient.pk)
        return Response(
            self.get_serializer(self._share(share.pk)).data,
            status=status.HTTP_201_CREATED,
        )

    @extend_schema(request=UpdateLibraryShareRequest, responses=LibraryShareSerializer)
    def partial_update(self, request: Request, pk: str | None = None) -> Response:
        user = request_user(request)
        share = self._share(pk)
        data = parse_body(request, UpdateLibraryShareRequest)
        changed = _changes_for(user, share, data)
        for name in changed:
            setattr(share, name, data[name])
        if changed:
            share.save(update_fields=changed)
        return Response(self.get_serializer(self._share(share.pk)).data)

    @extend_schema(responses={204: None})
    def destroy(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        """The owner stops sharing, or the recipient leaves: access ends at once."""
        user = request_user(request)
        share = self._share(kwargs.get("pk"))
        share_id = share.pk
        # The owner's last share takes their copies along
        # (api.sharing.copies.forget_copies_after_last_share).
        share.delete()
        logger.info("User %s ended library share %s", user.pk, share_id)
        return Response(status=status.HTTP_204_NO_CONTENT)
