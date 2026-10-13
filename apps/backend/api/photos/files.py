"""The files behind a photo: detaching the missing ones and removing a photo
together with the files only it uses.

Moved out of ``Photo``; every function takes the photo as its first argument.
"""

from __future__ import annotations

import logging
import os
from typing import TYPE_CHECKING

from api.video import transcode_cache

if TYPE_CHECKING:
    from api.models.file import File
    from api.models.photo import Photo

logger = logging.getLogger(__name__)


def missing_files(photo: Photo) -> list[File]:
    """The photo's files that are gone from disk.

    A file whose own path is gone but which has an exact copy on disk (a
    ``FileCopy``, #2417) is not missing: the copy takes the file over here,
    as the next scan would, so the photo is not flagged missing meanwhile.
    """
    return [file for file in photo.files.all() if not _on_disk(file)]


def _on_disk(file: File) -> bool:
    """Whether ``file`` is on disk, at its own path or at a copy that takes it over."""
    if file.path and os.path.exists(file.path):
        return True
    for copy in file.copies.values_list("path", flat=True):
        if os.path.exists(copy):
            logger.info("a copy takes over the missing file %s", file.hash)
            file.take_over_copy(copy)
            return True
    return False


def detach_missing_files(photo: Photo, missing: list[File] | None = None) -> None:
    """Unlink files that are gone from disk and flag them missing.

    ``missing`` is the result of ``missing_files(photo)`` when the caller has
    already looked (the scan checks the whole library before it changes
    anything); without it the files are checked here.

    The scan runs this over every photo in the library, from rows it loaded
    in pages of thousands. Saving each one whole wrote those old values back
    over anything that changed in the meantime -- a rating given while the
    scan ran, a field another job had just filled in -- and bumped every
    ``last_modified``, so a removed photo never got old enough for
    ``cleanup_deleted_photos``. Only a photo that actually lost a file is
    touched, and only its ``last_modified``: the relation itself is already
    written by ``remove()``, and the bump is what tells the sync feed.
    """
    if missing is None:
        missing = missing_files(photo)
    for file in missing:
        photo.files.remove(file)
        file.missing = True
        file.save()
    if missing:
        photo.save(update_fields=["last_modified"])


def remove_photo(photo: Photo) -> None:
    """Delete the photo's unshared files from disk and mark it removed.

    Files another photo still uses are only unlinked. Stacks and duplicate
    groups left with one photo or none are dissolved.
    """
    # Store stack references before cleanup (ManyToMany)
    photo_stacks = list(photo.stacks.all())

    # Store duplicate group references before cleanup (ManyToMany)
    photo_duplicates = list(photo.duplicates.all())

    # Handle file cleanup - only delete files not shared with other Photos
    for file in photo.files.all():
        # Check if this file is used by other Photos (via files M2M or as main_file)
        other_photos_using_file = (
            file.photo_set.exclude(pk=photo.pk).exists()
            or file.main_photo.exclude(pk=photo.pk).exists()
        )

        if other_photos_using_file:
            # File is shared - just unlink from this photo, don't delete
            logger.info(
                "File %s is shared with other photos, unlinking only", file.path
            )
            photo.files.remove(file)
        else:
            # File is only used by this photo - safe to delete
            if os.path.isfile(file.path):
                logger.info("Removing photo %s", file.path)
                os.remove(file.path)
            file.delete()

    photo.files.set([])
    photo.main_file = None
    photo.removed = True

    # A cached transcode outlives the photo otherwise: it is named after the
    # image hash, which no longer belongs to anything, so nothing would ever
    # serve it and nothing would ever reclaim it until the cache filled up.
    transcode_cache.discard(photo.image_hash)

    # Clear all stack references from this photo (ManyToMany)
    photo.stacks.clear()

    # Clear all duplicate group references from this photo (ManyToMany)
    photo.duplicates.clear()

    photo.save()

    # Clean up stacks if they're now empty or have only one photo left
    for photo_stack in photo_stacks:
        remaining_photos = photo_stack.photos.filter(removed=False).count()
        if remaining_photos <= 1:
            # If 0 or 1 photos left, delete the stack (no longer a valid grouping)
            logger.info(
                "Deleting photo stack %s - only %s photos remaining",
                photo_stack.id,
                remaining_photos,
            )
            # Unlink remaining photos from stack first
            for remaining_photo in photo_stack.photos.all():
                remaining_photo.stacks.remove(photo_stack)
            photo_stack.delete()

    # Clean up duplicate groups if they're now empty or have only one photo left
    for duplicate in photo_duplicates:
        remaining_photos = duplicate.photos.filter(removed=False).count()
        if remaining_photos <= 1:
            # If 0 or 1 photos left, delete the duplicate group (no longer valid)
            logger.info(
                "Deleting duplicate group %s - only %s photos remaining",
                duplicate.id,
                remaining_photos,
            )
            # Unlink remaining photos from duplicate first
            for remaining_photo in duplicate.photos.all():
                remaining_photo.duplicates.remove(duplicate)
            duplicate.delete()
