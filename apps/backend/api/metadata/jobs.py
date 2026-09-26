"""Background metadata writes for changes made without ``Photo.save()``.

``Photo.save()`` writes a changed rating to the photo's XMP sidecar or media
file when its owner has ``save_metadata_to_disk`` on. Bulk edits change the
rating with a single queryset ``update()``, which skips ``save()``; they queue
``write_photo_ratings`` instead so the file ends up the same either way.
"""

from django_q.tasks import AsyncTask

from api.util import logger


def queue_rating_write(user, photo_ids):
    """Queue the rating write ``Photo.save()`` would have done for these photos.

    Follows the owner's ``save_metadata_to_disk`` setting as ``save()`` does:
    nothing when it is off, the XMP sidecar or the media file otherwise. A
    failure to queue is logged and swallowed; the database change it follows
    has already been made and is what the request reports.
    """
    from api.models import User

    mode = user.save_metadata_to_disk
    if not photo_ids or mode == User.SaveMetadata.OFF:
        return
    use_sidecar = mode == User.SaveMetadata.SIDECAR_FILE
    try:
        AsyncTask(write_photo_ratings, list(photo_ids), use_sidecar).run()
    except Exception:
        logger.exception(
            f"Could not queue the rating write for {len(photo_ids)} photos "
            f"of user {user.id}"
        )


def write_photo_ratings(photo_ids, use_sidecar):
    """Write each photo's current rating to disk, as ``Photo.save()`` does."""
    from api.models import Photo

    photos = Photo.objects.filter(id__in=photo_ids).select_related("main_file")
    for photo in photos.iterator():
        try:
            photo._save_metadata(modified_fields=["rating"], use_sidecar=use_sidecar)
        except Exception:
            logger.exception(f"Failed to write the rating of photo {photo.image_hash}")
