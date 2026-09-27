"""The files behind a photo: detaching the missing ones and removing a photo
together with the files only it uses.

Moved out of ``Photo``; every function takes the photo as its first argument.
"""

import logging
import os

from api import transcode_cache

logger = logging.getLogger(__name__)


def detach_missing_files(photo):
    """Unlink files that are gone from disk and flag them missing."""
    for file in photo.files.all():
        if not file.path or not os.path.exists(file.path):
            photo.files.remove(file)
            file.missing = True
            file.save()
    photo.save()


def remove_photo(photo):
    """Delete the photo's unshared files from disk and mark it removed.

    Files another photo still uses are only unlinked. Stacks and duplicate
    groups left with one photo or none are dissolved. Returns what
    ``photo.save()`` returned.
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
            logger.info(f"File {file.path} is shared with other photos, unlinking only")
            photo.files.remove(file)
        else:
            # File is only used by this photo - safe to delete
            if os.path.isfile(file.path):
                logger.info(f"Removing photo {file.path}")
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

    result = photo.save()

    # Clean up stacks if they're now empty or have only one photo left
    for photo_stack in photo_stacks:
        remaining_photos = photo_stack.photos.filter(removed=False).count()
        if remaining_photos <= 1:
            # If 0 or 1 photos left, delete the stack (no longer a valid grouping)
            logger.info(
                f"Deleting photo stack {photo_stack.id} - only {remaining_photos} photos remaining"
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
                f"Deleting duplicate group {duplicate.id} - only {remaining_photos} photos remaining"
            )
            # Unlink remaining photos from duplicate first
            for remaining_photo in duplicate.photos.all():
                remaining_photo.duplicates.remove(duplicate)
            duplicate.delete()

    return result
