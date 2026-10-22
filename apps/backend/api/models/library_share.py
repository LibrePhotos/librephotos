"""A user's whole library shared read-only with another user (#2731).

The owner picks, per recipient, what of their photos' metadata the recipient
sees. Every switch starts off; the photos themselves and their dates are
always shared. The recipient's one switch is ``show_in_timeline``. Nothing
about ownership changes: the owner's faces, albums, edits and files stay
theirs, and every write path stays owner-only.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from django.contrib.auth.models import AnonymousUser
from django.db import models
from django.db.models import F, Q

from api.models.scopes import OwnedQuerySet, _account
from api.models.user import User

if TYPE_CHECKING:
    from typing import Self

# The owner's switches, in the order the share dialog lists them.
GRANT_FIELDS = (
    "share_location",
    "share_faces",
    "share_camera_info",
    "share_captions",
    "share_originals",
)


class LibraryShareQuerySet(OwnedQuerySet["LibraryShare"]):
    """``owned_by`` is the owner's side; ``received_by`` the recipient's."""

    def received_by(self, user: User | AnonymousUser | None) -> Self:
        """The shares of other users' libraries with ``user``."""
        account = _account(user)
        if account is None:
            return self.none()
        return self.filter(recipient=account)

    def involving(self, user: User | AnonymousUser | None) -> Self:
        """The shares ``user`` gave or received: what either side may end."""
        account = _account(user)
        if account is None:
            return self.none()
        return self.filter(self.owner_q(account) | Q(recipient=account))


class LibraryShare(models.Model):
    owner = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="library_shares_given"
    )
    recipient = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="library_shares_received"
    )
    # The recipient's switch: the owner's photos also in their timeline,
    # search and map. Off until the recipient turns it on.
    show_in_timeline = models.BooleanField(default=False)
    # The owner's switches. Off by default: a new share shows photos and
    # dates only.
    share_location = models.BooleanField(default=False)
    share_faces = models.BooleanField(default=False)
    share_camera_info = models.BooleanField(default=False)
    share_captions = models.BooleanField(default=False)
    share_originals = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    objects = LibraryShareQuerySet.as_manager()

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["owner", "recipient"], name="library_share_once_per_pair"
            ),
            models.CheckConstraint(
                condition=~Q(owner=F("recipient")),  # owner-scope: two columns of a row
                name="library_share_not_to_self",
            ),
        ]
        ordering = ("created_at", "id")

    def __str__(self) -> str:
        return f"LibraryShare {self.owner_id} -> {self.recipient_id}"
