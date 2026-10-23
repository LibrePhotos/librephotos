"""Who is in a shared album and what they may do there (#464).

A user album is shared with members. A viewer sees it; a contributor also
adds photos from their own library and takes their own photos out again.
Photos keep their owner: the album only links them (``AlbumUserPhoto``), so
nothing here ever copies, moves or deletes a photo.

When a contributor leaves, is removed or becomes a viewer, the photos they
added leave the album (they stay in their library). The read rule
(``AlbumUserPhotoQuerySet.vouched``) already stops vouching for them at that
moment; taking the links out keeps the album from filling up again should
they come back.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable
from typing import Any
from uuid import UUID

from django.db import transaction
from django.db.models import QuerySet
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError

from api.models import (
    AlbumComment,
    AlbumLike,
    AlbumRole,
    AlbumUser,
    AlbumUserMember,
    AlbumUserPhoto,
    Photo,
)
from api.models.user import User

logger = logging.getLogger(__name__)

OWNER = "owner"

# What a contributor may switch on for the photos they add; the album's
# ceiling for each is ``AlbumUser.members_<name>``.
MEMBER_SWITCHES = (
    "share_location",
    "share_faces",
    "share_camera_info",
    "share_captions",
    "share_originals",
)


def _membership(
    album: AlbumUser, user: User, lock: bool = False
) -> AlbumUserMember | None:
    """``user``'s membership row; with ``lock``, held until the transaction
    ends, so a role change and an add cannot interleave."""
    members = AlbumUserMember.objects.filter(albumuser=album, user=user)
    if lock:
        members = members.select_for_update()
    return members.first()


def role_of(album: AlbumUser, user: User, lock: bool = False) -> str | None:
    """``"owner"``, a member's role, or None for someone outside the album."""
    if album.owner_id == user.pk:
        return OWNER
    member = _membership(album, user, lock)
    return member.role if member is not None else None


def _touch(album: AlbumUser) -> None:
    """Bump the album for delta sync; a through-row update sends no signal."""
    AlbumUser.objects.filter(pk=album.pk).update(last_modified=timezone.now())


def take_out_contributions(album: AlbumUser, user: User) -> int:
    """Take the photos ``user`` added out of ``album``; returns how many.

    Their own photos only, never the album owner's. Through the related
    manager, so the delta-sync receivers see the change.
    """
    if album.owner_id == user.pk:
        return 0
    # django-stubs types the many-to-many add()/remove() as taking
    # ``Photo | int``; the ids are UUIDs, so the lists are ``Any``.
    photo_ids: list[Any] = list(
        AlbumUserPhoto.objects.filter(albumuser=album)
        .filter(Photo.objects.owner_q(user, through="photo__"))
        .values_list("photo_id", flat=True)
    )
    if photo_ids:
        album.photos.remove(*photo_ids)
        drop_threads(album, photo_ids)
        logger.info(
            "Took %s photos of user %s out of album %s",
            len(photo_ids),
            user.pk,
            album.pk,
        )
    return len(photo_ids)


@transaction.atomic
def set_member_role(album: AlbumUser, user: User, role: str | None) -> int:
    """Share ``album`` with ``user`` as ``role``, or remove them (None).

    Returns how many photos left the album: those ``user`` added, when they
    stop being a contributor. Becoming one starts from none: a link left
    behind by an add that lost the race with an earlier change of role
    never comes back. The owner cannot be made a member.
    """
    if user.pk == album.owner_id:
        raise ValidationError("You cannot share an album with yourself")
    member = _membership(album, user, lock=True)
    was_contributor = member is not None and member.role == AlbumRole.CONTRIBUTOR
    taken_out = 0
    if member is not None and was_contributor != (role == AlbumRole.CONTRIBUTOR):
        taken_out = take_out_contributions(album, user)
    if role is None:
        # Through the related manager: the m2m_changed receiver writes the
        # tombstone that takes the album off the user's phone.
        album.shared_to.remove(user)
    elif member is None:
        album.shared_to.add(user, through_defaults={"role": role})
    elif member.role != role:
        member.role = role
        member.save(update_fields=["role"])
        _touch(album)
    return taken_out


def leave(album: AlbumUser, user: User) -> int:
    """``user`` leaves an album shared with them; their photos go with them."""
    return set_member_role(album, user, None)


def membership_of(album: AlbumUser, user: User) -> AlbumUserMember:
    """``user``'s membership of ``album``; a 404 for anyone else."""
    member = AlbumUserMember.objects.filter(albumuser=album, user=user).first()
    if member is None:
        raise NotFound("No such album shared with you")
    return member


def update_switches(member: AlbumUserMember, values: dict[str, Any]) -> None:
    """Set the member's own switches that ``values`` names."""
    changed = [name for name in MEMBER_SWITCHES if name in values]
    for name in changed:
        setattr(member, name, bool(values[name]))
    if changed:
        member.save(update_fields=changed)
        _touch(member.albumuser)


def album_for_member(album_id: int, user: User) -> AlbumUser:
    """The album ``user`` owns or is a member of; a 404 otherwise."""
    album = AlbumUser.objects.owned_or_shared_to(user).filter(pk=album_id).first()
    if album is None:
        raise NotFound("No such album")
    return album


@transaction.atomic
def add_photos(album: AlbumUser, user: User, photos: QuerySet[Photo]) -> int:
    """Add ``user``'s own ``photos`` to ``album``; returns how many were new.

    The owner and contributors only, and not while the album is locked.
    ``photos`` must already be scoped to ``user`` (``OwnedPhotoField``,
    ``build_photo_queryset``); hidden ones are refused, since a hidden photo
    is never shown through an album. The membership row stays locked until
    the links are written, so a change of role waits for the add.
    """
    role = role_of(album, user, lock=True)
    if role not in (OWNER, AlbumRole.CONTRIBUTOR):
        raise PermissionDenied("You cannot add photos to this album")
    if album.locked:
        raise ValidationError(
            {"locked": "This album is locked. Ask its owner to unlock it."}
        )
    own = photos.filter(pk__in=Photo.objects.owned_by(user).values("pk"))
    if own.filter(hidden=True).exists():
        raise ValidationError({"photos": "Hidden photos cannot be added to an album"})
    present = AlbumUserPhoto.objects.filter(albumuser=album).values("photo_id")
    new_ids: list[Any] = list(own.exclude(pk__in=present).values_list("pk", flat=True))
    if new_ids:
        album.photos.add(*new_ids, through_defaults={"added_by": user})
    logger.info("User %s added %s photos to album %s", user.pk, len(new_ids), album.pk)
    return len(new_ids)


def remove_photos(album: AlbumUser, user: User, photo_ids: Iterable[object]) -> int:
    """Take photos out of ``album``; returns how many left.

    The owner takes out any photo, a contributor only their own: any other
    id is skipped, like one the album does not hold, so the answer tells a
    contributor nothing about photos that are not theirs. Not while the
    album is locked.
    """
    role = role_of(album, user)
    if role not in (OWNER, AlbumRole.CONTRIBUTOR):
        raise PermissionDenied("You cannot remove photos from this album")
    if album.locked:
        raise ValidationError(
            {"locked": "This album is locked. Ask its owner to unlock it."}
        )
    links = AlbumUserPhoto.objects.filter(albumuser=album, photo_id__in=list(photo_ids))
    if role != OWNER:
        links = links.filter(Photo.objects.owner_q(user, through="photo__"))
    ids: list[Any] = list(links.values_list("photo_id", flat=True))
    if ids:
        album.photos.remove(*ids)
        drop_threads(album, ids)
    return len(ids)


def drop_threads(album: AlbumUser, photo_ids: Iterable[UUID]) -> None:
    """Delete the comments and likes (#262) on photos that left ``album``.

    A thread belongs to the photo in this album only; it goes with the photo.
    """
    ids = list(photo_ids)
    if not ids:
        return
    AlbumComment.objects.filter(album=album, photo_id__in=ids).delete()
    AlbumLike.objects.filter(album=album, photo_id__in=ids).delete()
