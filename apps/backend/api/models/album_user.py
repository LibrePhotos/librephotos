from __future__ import annotations

from typing import TYPE_CHECKING

from django.db import models
from django.db.models import Exists, F, OuterRef, Q, QuerySet

from api.models.photo import Photo
from api.models.scopes import SharedOwnedQuerySet
from api.models.user import User, get_deleted_user

if TYPE_CHECKING:
    from typing import Self


class AlbumRole(models.TextChoices):
    """What a member of a shared album may do (#464).

    A viewer sees the album; a contributor also adds their own photos to it
    and takes them out again. Everything else stays with the album's owner.
    """

    VIEWER = "viewer", "Can view"
    CONTRIBUTOR = "contributor", "Can add photos"


class AlbumUserQuerySet(SharedOwnedQuerySet["AlbumUser"]):
    """Scoped to its owner through ``owner``."""


class AlbumUser(models.Model):
    title = models.CharField(max_length=512)
    created_on = models.DateTimeField(auto_now=True, db_index=True)
    photos = models.ManyToManyField(Photo, through="AlbumUserPhoto")
    favorited = models.BooleanField(default=False, db_index=True)
    locked = models.BooleanField(default=False)
    owner = models.ForeignKey(
        User, on_delete=models.SET(get_deleted_user), default=None
    )
    cover_photo = models.ForeignKey(
        Photo,
        related_name="album_user",
        on_delete=models.SET_NULL,
        blank=False,
        null=True,
    )

    shared_to = models.ManyToManyField(
        User, related_name="album_user_shared_to", through="AlbumUserMember"
    )
    # What the album's members see of its photos (#464), the owner's ceiling:
    # a field shows only where this and the photo's owner both allow it
    # (``api/albums/member_grants.py``). On by default, as before members
    # existed, so the owner's own photos look the same to them.
    members_share_location = models.BooleanField(default=True)
    members_share_faces = models.BooleanField(default=True)
    members_share_camera_info = models.BooleanField(default=True)
    members_share_captions = models.BooleanField(default=True)
    members_share_originals = models.BooleanField(default=True)
    # Whether members may comment on its photos (#262); the owner turns it off.
    comments_enabled = models.BooleanField(default=True)
    # Delta-sync ordering key (mobile v2, doc 04). Bumped on save and on
    # membership / sharing changes via m2m_changed receivers (api/sync_signals.py).
    last_modified = models.DateTimeField(auto_now=True, db_index=True)

    objects = AlbumUserQuerySet.as_manager()

    def __str__(self) -> str:
        return f"{self.title} ({self.owner.username})"

    class Meta:
        unique_together = ("title", "owner")


class AlbumUserMember(models.Model):
    """A user an album is shared with, and their role in it (#464).

    The through table of ``AlbumUser.shared_to``: the table the plain
    many-to-many had, with the role and the contributor's own switches added.
    The switches say what the other members may see of the photos this member
    adds; off until the contributor turns them on.
    """

    albumuser = models.ForeignKey(
        AlbumUser, on_delete=models.CASCADE, related_name="memberships"
    )
    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="album_memberships"
    )
    role = models.CharField(
        max_length=16, choices=AlbumRole.choices, default=AlbumRole.VIEWER
    )
    share_location = models.BooleanField(default=False)
    share_faces = models.BooleanField(default=False)
    share_camera_info = models.BooleanField(default=False)
    share_captions = models.BooleanField(default=False)
    share_originals = models.BooleanField(default=False)

    def __str__(self) -> str:
        return f"{self.user_id} in album {self.albumuser_id} ({self.role})"

    class Meta:
        db_table = "api_albumuser_shared_to"
        unique_together = (("albumuser", "user"),)


class AlbumUserPhotoQuerySet(QuerySet["AlbumUserPhoto"]):
    def vouched(self) -> Self:
        """Links through which the album's share may reach the photo.

        An album only vouches for its owner's photos (GHSA-phvg-g65q-rhq3),
        and, since #464, for photos a *current* contributor added from their
        own library. A link a member made stops vouching the moment they leave,
        are removed or become a viewer; a link to anyone else's photo (one
        made before #2008) never does. Hidden, trashed and removed photos are
        never shown through an album.
        """
        contributor = AlbumUserMember.objects.filter(
            albumuser_id=OuterRef("albumuser_id"),
            user_id=OuterRef("photo__owner_id"),
            role=AlbumRole.CONTRIBUTOR,
        )
        by_owner = Q(photo__owner_id=F("albumuser__owner_id"))
        by_contributor = Q(added_by_id=F("photo__owner_id")) & Exists(contributor)
        return self.filter(by_owner | by_contributor).filter(
            photo__hidden=False, photo__in_trashcan=False, photo__removed=False
        )

    def of_album_owner(self) -> Self:
        """Vouched links to the album owner's own photos.

        All a public link shows: contributors' photos never reach it.
        """
        return self.vouched().filter(photo__owner_id=F("albumuser__owner_id"))

    def listed(self) -> Self:
        """Links a synced client lists as the album's photos.

        The album owner's photos (hidden ones too: the owner's clients
        filter those) and the vouched photos of current contributors.
        """
        contributed = self.model.objects.contributed().values("pk")
        return self.filter(
            Q(photo__owner_id=F("albumuser__owner_id")) | Q(pk__in=contributed)
        )

    def contributed(self) -> Self:
        """Vouched links to photos that are not the album owner's own."""
        return self.vouched().exclude(photo__owner_id=F("albumuser__owner_id"))


class AlbumUserPhoto(models.Model):
    """A photo in a user album, and who put it there (#464).

    The through table of ``AlbumUser.photos``. Photos keep their owner: the
    album only links them. ``added_by`` is null on links made before members
    could add photos (the owner's, then).
    """

    albumuser = models.ForeignKey(
        AlbumUser, on_delete=models.CASCADE, related_name="photo_links"
    )
    photo = models.ForeignKey(
        Photo, on_delete=models.CASCADE, related_name="album_user_links"
    )
    added_by = models.ForeignKey(
        User, on_delete=models.CASCADE, null=True, blank=True, related_name="+"
    )

    objects = AlbumUserPhotoQuerySet.as_manager()

    def __str__(self) -> str:
        return f"Photo {self.photo_id} in album {self.albumuser_id}"

    class Meta:
        db_table = "api_albumuser_photos"
        unique_together = (("albumuser", "photo"),)
