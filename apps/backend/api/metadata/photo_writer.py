"""Writing a photo's LibrePhotos edits back to its file or XMP sidecar.

Ratings, capture dates, face regions and rotations. Moved out of ``Photo``;
every function takes the photo as its first argument.
"""

import logging

from api.metadata.tags import Tags
from api.metadata.writer import write_metadata
from api.models.user import User

logger = logging.getLogger(__name__)


def write_photo_metadata(
    photo, modified_fields=None, use_sidecar=True, metadata_types=None
):
    """Write metadata tags to the photo's file or sidecar.

    Args:
        modified_fields: List of changed field names (from Photo.save() diff).
            When None, writes all applicable tags unconditionally.
        use_sidecar: Write to XMP sidecar file if True, media file if False.
        metadata_types: List of metadata categories to write, e.g.
            ["ratings", "face_tags"]. When None, uses default behavior
            (ratings/timestamps only, for backward compatibility).
    """
    tags_to_write = {}

    write_ratings = metadata_types is None or "ratings" in metadata_types
    write_face_tags = metadata_types is not None and "face_tags" in metadata_types

    if write_ratings:
        if modified_fields is None or "rating" in modified_fields:
            tags_to_write[Tags.RATING] = photo.rating
        if modified_fields is not None and "timestamp" in modified_fields:
            # XMP:DateCreated is used rather than an EXIF date tag because
            # EXIF tags cannot be written into an XMP sidecar (exiftool
            # silently leaves the sidecar unchanged), and because writing it
            # preserves the camera's original EXIF:DateTimeOriginal.
            # Serialized in exiftool's canonical form; ``photo.timestamp`` is
            # local time carrying a UTC tzinfo, so the offset is dropped
            # rather than written out as a misleading "+00:00".
            tags_to_write[Tags.DATE_CREATED] = (
                photo.timestamp.strftime("%Y:%m:%d %H:%M:%S") if photo.timestamp else ""
            )

    if write_face_tags:
        from api.metadata.face_regions import get_face_region_tags

        tags_to_write.update(get_face_region_tags(photo))

    if tags_to_write:
        write_metadata(photo.main_file.path, tags_to_write, use_sidecar=use_sidecar)


def write_orientation_to_disk(photo, angle: int, flip_horizontal: bool) -> None:
    """Write the combined orientation to the file / sidecar when the user
    has opted into persisting metadata to disk.

    A media-file write the renderer picks up is folded into the file (see
    ``_fold_rotation_into_file``). Anything else keeps the rotation in
    ``local_orientation`` and writes the tag for other viewers only.
    """
    user = photo.owner
    if user.save_metadata_to_disk == User.SaveMetadata.OFF:
        return

    use_sidecar = user.save_metadata_to_disk == User.SaveMetadata.SIDECAR_FILE
    if not use_sidecar and _fold_rotation_into_file(photo):
        return

    from api.util import compose_orientation

    try:
        exif_orientation = photo.metadata.orientation or 1
    except Exception:
        exif_orientation = 1

    # Compose the user's local rotation with the original EXIF orientation
    # so a standards-compliant viewer shows the image correctly without
    # relying on LibrePhotos-specific DB fields.
    combined = compose_orientation(
        exif_orientation,
        delta_angle_cw=angle,
        flip_h=flip_horizontal,
    )
    write_metadata(
        photo.main_file.path,
        {Tags.ORIENTATION: combined},
        use_sidecar=use_sidecar,
    )


def _fold_rotation_into_file(photo) -> bool:
    """Move the rotation into the file's own EXIF Orientation (#2050).

    Once the file carries the rotation, the renderer applies it by itself,
    so ``local_orientation`` has to go back to 1 or every later thumbnail
    rebuild applies it a second time. The value written is the one that
    makes the file render exactly like the thumbnails ``rotate`` has just
    rebuilt (``exif_orientation_showing``), so the stored perceptual hash
    still matches the file and the next scan sees the same picture.

    Only when

    * the format's decode path honours an EXIF Orientation written into
      it (``renders_exif_orientation``: not HEIC, AVIF, RAW, ...), and
    * the value is really on disk afterwards. exiftool reports a failed
      write (read-only library, locked file, unwritable format) on stdout
      and PyExifTool does not raise, so the file is read back.

    The file's own tag is the starting point, not ``PhotoMetadata.orientation``,
    which the scan never fills in: a photo shot in portrait (EXIF 6) would
    otherwise be written back as if it were upright.

    Returns False, having written nothing, when the file cannot be folded
    into, so the caller keeps the rotation in ``local_orientation`` as
    before. Returns True once the write was attempted; a write that did not
    land is logged and leaves ``local_orientation`` alone.
    """
    from api.metadata.writer import read_orientation
    from api.thumbnails import exif_orientation_showing, renders_exif_orientation

    path = photo.main_file.path
    if not renders_exif_orientation(path):
        return False
    on_disk = read_orientation(path)
    if on_disk is None:
        return False

    combined = exif_orientation_showing(on_disk, photo.local_orientation)
    write_metadata(path, {Tags.ORIENTATION: combined}, use_sidecar=False)

    written = read_orientation(path)
    if written != combined:
        logger.warning(
            f"orientation {combined} was not written to {path} "
            f"(the file says {written}); keeping the rotation in the database"
        )
        return True

    _adopt_written_orientation(photo, combined)
    return True


def _adopt_written_orientation(photo, combined: int) -> None:
    """Fold a confirmed media-file orientation write back into the DB.

    The file's own EXIF now carries the whole rotation: ``local_orientation``
    goes back to 1 so the renderer does not apply it twice, and
    ``PhotoMetadata.orientation`` records what the file says.
    """
    if photo.local_orientation != 1:
        photo.local_orientation = 1
        photo.save(save_metadata=False, update_fields=["local_orientation"])

    metadata = getattr(photo, "metadata", None)
    if metadata is not None and metadata.orientation != combined:
        metadata.orientation = combined
        metadata.save(update_fields=["orientation"])
