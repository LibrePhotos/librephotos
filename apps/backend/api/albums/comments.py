"""Comments and likes on the photos of a shared album (#262).

A thread belongs to one photo in one album: only the album's owner and its
members read it, and only while the album shows the photo (a vouched link,
``AlbumUserPhotoQuerySet.vouched``). When a photo leaves the album its thread
goes (``members.drop_threads``). Authors edit and delete their own comments; the
album's owner deletes any comment and can turn comments off. Comments are
plain text, at most ``MAX_COMMENT_LENGTH`` characters; clients render them as
text, never as markup.
"""

from __future__ import annotations

import logging
import unicodedata
from uuid import UUID

from django.db.models import QuerySet
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError

from api.albums.members import album_for_member
from api.models import AlbumComment, AlbumLike, AlbumUser, AlbumUserPhoto, Photo
from api.models.user import User

logger = logging.getLogger(__name__)

MAX_COMMENT_LENGTH = 1000

# Line breaks stay; every other control character (and the bidirectional
# overrides that make text read backwards) goes.
_KEPT_CONTROLS = {"\n"}
_BIDI_OVERRIDES = {
    chr(code) for code in (*range(0x202A, 0x202F), *range(0x2066, 0x206A))
}


def clean_text(text: str) -> str:
    """``text`` as a comment stores it: plain, trimmed, with no control characters.

    Refuses an empty comment and one longer than ``MAX_COMMENT_LENGTH``.
    """
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    kept = "".join(
        char
        for char in text
        if char in _KEPT_CONTROLS
        or (unicodedata.category(char) != "Cc" and char not in _BIDI_OVERRIDES)
    ).strip()
    if not kept:
        raise ValidationError({"text": "A comment needs some text"}, code="blank")
    if len(kept) > MAX_COMMENT_LENGTH:
        raise ValidationError(
            {"text": f"A comment has at most {MAX_COMMENT_LENGTH} characters"},
            code="max_length",
        )
    return kept


def thread_of(
    album_id: int, photo_id: UUID | str, user: User
) -> tuple[AlbumUser, Photo]:
    """The album and photo of a thread ``user`` may read; a 404 otherwise.

    The album must be ``user``'s or shared with them, and show the photo.
    """
    album = album_for_member(album_id, user)
    link = (
        AlbumUserPhoto.objects.vouched()
        .filter(albumuser=album, photo_id=photo_id)
        .select_related("photo")
        .first()
    )
    if link is None:
        raise NotFound("No such photo in this album")
    return album, link.photo


def comments_on(album: AlbumUser, photo: Photo) -> QuerySet[AlbumComment]:
    """The thread, oldest first, with its authors."""
    return (
        AlbumComment.objects.filter(album=album, photo=photo)
        .select_related("author")
        .order_by("created_at", "pk")
    )


def _refuse_when_off(album: AlbumUser) -> None:
    if not album.comments_enabled:
        raise PermissionDenied(
            "The album's owner turned comments off", code="comments_off"
        )


def add_comment(album: AlbumUser, photo: Photo, user: User, text: str) -> AlbumComment:
    _refuse_when_off(album)
    comment = AlbumComment.objects.create(
        album=album, photo=photo, author=user, text=clean_text(text)
    )
    logger.info("User %s commented on a photo in album %s", user.pk, album.pk)
    return comment


def comment_in(album: AlbumUser, photo: Photo, comment_id: int) -> AlbumComment:
    comment = comments_on(album, photo).filter(pk=comment_id).first()
    if comment is None:
        raise NotFound("No such comment")
    return comment


def edit_comment(comment: AlbumComment, user: User, text: str) -> AlbumComment:
    """The author rewrites their comment; nobody else, the owner neither."""
    if comment.author_id != user.pk:
        raise PermissionDenied("You can only edit your own comments")
    comment.text = clean_text(text)
    comment.edited_at = timezone.now()
    comment.save(update_fields=["text", "edited_at"])
    return comment


def can_delete(comment: AlbumComment, album: AlbumUser, user: User) -> bool:
    """Its author, or the album's owner (moderation)."""
    return user.pk in (comment.author_id, album.owner_id)


def delete_comment(comment: AlbumComment, album: AlbumUser, user: User) -> None:
    if not can_delete(comment, album, user):
        raise PermissionDenied("You can only delete your own comments")
    comment.delete()
    logger.info("User %s deleted comment %s in album %s", user.pk, comment.pk, album.pk)


def set_liked(album: AlbumUser, photo: Photo, user: User, liked: bool) -> None:
    """Heart or un-heart the photo in this album; idempotent.

    With comments off, no new heart; taking one back still works.
    """
    likes = AlbumLike.objects.filter(album=album, photo=photo, user=user)
    if liked:
        _refuse_when_off(album)
        if not likes.exists():
            AlbumLike.objects.create(album=album, photo=photo, user=user)
    else:
        likes.delete()


def likers_of(album: AlbumUser, photo: Photo) -> list[User]:
    """Who hearted the photo in this album, first heart first."""
    return [
        like.user
        for like in AlbumLike.objects.filter(album=album, photo=photo)
        .select_related("user")
        .order_by("created_at", "pk")
    ]
