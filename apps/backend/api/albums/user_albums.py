"""Filing photos into a user's own album (#612).

An upload can name the album it goes into. The album is resolved through the
owner scope when the upload completes (``upload_target_album``), and the photo
is added once it has been imported (``add_photo_to_user_album``, the last link
of the import chain that matters for the album, or directly for a file the
library already holds). Only the album's owner may file into it; contributors
come with #464.
"""

import logging

from api.models import Photo
from api.models.album_user import AlbumUser
from api.models.user import User

logger = logging.getLogger(__name__)


class AlbumRefusedError(Exception):
    """The album an upload names cannot take photos: ``code`` says why."""

    code = "album_refused"
    message = "This album cannot take photos."


class AlbumNotFoundError(AlbumRefusedError):
    """Not one of the uploader's albums (deleted, or someone else's)."""

    code = "album_not_found"
    message = "Album not found."


class AlbumLockedError(AlbumRefusedError):
    """A locked album's photo set is read-only (#867)."""

    code = "album_locked"
    message = "This album is locked. Unlock it to add photos."


def upload_target_album(user: User, album_id: int) -> AlbumUser:
    """The album of ``user`` an upload files into, or why it cannot.

    Raises ``AlbumNotFoundError`` for an id that is not one of the user's own
    albums (another user's album answers the same as a missing one) and
    ``AlbumLockedError`` for a locked album.
    """
    album = AlbumUser.objects.owned_by(user).filter(id=album_id).first()
    if album is None:
        raise AlbumNotFoundError()
    if album.locked:
        raise AlbumLockedError()
    return album


def add_photo_to_user_album(photo: Photo, album_id: int) -> bool:
    """Add ``photo`` to its owner's album ``album_id``; False when it cannot.

    Runs in the upload's import chain, so the album is resolved again: it may
    have been deleted or locked since the upload completed, and the photo may
    be gone. Neither is an error; the photo simply stays in the library.
    """
    if not Photo.objects.filter(pk=photo.pk).exists():
        logger.info("Upload %s is gone; not added to album %s", photo.pk, album_id)
        return False
    try:
        album = upload_target_album(photo.owner, album_id)
    except AlbumRefusedError as refused:
        logger.info(
            "Upload %s not added to album %s: %s", photo.pk, album_id, refused.code
        )
        return False
    album.photos.add(photo)
    logger.info("Upload %s added to user album %s", photo.pk, album.id)
    return True
