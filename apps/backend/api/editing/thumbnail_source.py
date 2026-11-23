"""Which picture a photo's thumbnails are made from: its edit, or its original.

``api.thumbnails.render`` asks here every time it renders a still's
thumbnails, so a regeneration from any caller (a rotation, a regenerate job,
a new BIG_THUMBNAIL_HEIGHT, a rescan) shows the photo's edit. This module
imports no renderer: ``api.thumbnails.render`` imports it.
"""

from __future__ import annotations

import logging
import os

from api.editing.files import preview_path, rendition_path
from api.models import Photo, PhotoEdit

logger = logging.getLogger(__name__)

# The local orientation of a picture that is already upright: the edit's
# renders have the photo's own one applied.
UPRIGHT = 1


def shows_edit(photo: Photo) -> bool:
    """Whether ``photo``'s thumbnails show an edit rather than its original."""
    return (
        PhotoEdit.objects.filter(pk=photo.pk)
        .exclude(rendition=PhotoEdit.Rendition.NONE)
        .exists()
    )


def thumbnail_source(photo: Photo, original: str) -> tuple[str, int]:
    """The file ``photo``'s thumbnails render from and the local orientation to apply.

    ``original`` is the photo's main file. A photo whose edit changes nothing
    renders from it with its ``local_orientation``. An edited one renders
    from its rendition once that is ready, else from the save's render, both
    already upright. A render whose file is gone (a restored database, a
    cleared media folder) is made again here; if that fails too, the original.
    """
    orientation = photo.local_orientation or UPRIGHT
    edit = PhotoEdit.objects.filter(pk=photo.pk).first()
    if edit is None or not edit.shown:
        return original, orientation
    rendition = rendition_path(photo.image_hash)
    if edit.rendition == PhotoEdit.Rendition.READY and os.path.exists(rendition):
        return rendition, UPRIGHT
    preview = preview_path(photo.image_hash)
    if os.path.exists(preview):
        return preview, UPRIGHT
    # Imported here: it renders, through the thumbnails that import this module.
    from api.editing.renditions import restore_preview

    if restore_preview(photo, edit):
        return preview, UPRIGHT
    logger.warning(
        "photo %s: thumbnails from the original, its edit is gone", photo.image_hash
    )
    return original, orientation
