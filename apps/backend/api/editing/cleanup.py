"""Removing a photo's edit files when its edit row goes.

The row goes with the DELETE of the edit and, by cascade, with the photo
(trash emptied, a missing file cleaned up, an account deleted). Regenerating
the thumbnails never removes them (``api.photos.file_cleanup`` deletes only
thumbnails and share copies).
"""

from __future__ import annotations

from functools import partial

from django.db import transaction
from django.db.models.signals import post_delete

from api.editing.files import remove_edit_files
from api.models import Photo, PhotoEdit


def remove_files_of_deleted_edit(
    sender: type[PhotoEdit], instance: PhotoEdit, using: str, **kwargs: object
) -> None:
    """Remove the rendition and the preview of a deleted edit once the delete commits.

    The files are named after the photo's hash; another photo with the same
    hash and an edit of its own keeps them. In a cascade the photo's row is
    still there: Django deletes the edit before the photo.
    """
    image_hash = (
        Photo.objects.using(using)
        .filter(pk=instance.photo_id)
        .values_list("image_hash", flat=True)
        .first()
    )
    if image_hash is None:
        return
    others = (
        PhotoEdit.objects.using(using)
        .filter(photo__image_hash=image_hash)
        .exclude(pk=instance.photo_id)
    )
    if others.exists():
        return
    transaction.on_commit(partial(remove_edit_files, image_hash), using=using)


def register() -> None:
    post_delete.connect(
        remove_files_of_deleted_edit,
        sender=PhotoEdit,
        dispatch_uid="api.editing.cleanup.remove_files_of_deleted_edit",
    )
