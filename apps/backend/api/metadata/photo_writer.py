"""Writing a photo's LibrePhotos edits back to its file or XMP sidecar.

Ratings, capture dates, face regions and rotations. Moved out of ``Photo``;
every function takes the photo as its first argument. ``Photo.save()`` only
saves: a caller that applies a user's edit calls the writer itself, for the
fields it changed (#2336).
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from django.db import transaction

from api.metadata.orientation import compose_orientation
from api.metadata.tags import Tags
from api.metadata.writer import MetadataWriteError, TagValue, write_metadata
from api.models.user import User
from api.photos.paths import is_nextcloud_copy

if TYPE_CHECKING:
    from api.models.photo import Photo

logger = logging.getLogger(__name__)


def write_target(user: User) -> bool | None:
    """Where ``user``'s edits are written back: None when they are not.

    None for "Synchronize metadata to disk: Off" (the default, which keeps
    LibrePhotos away from the user's files), else ``use_sidecar``: True for
    the XMP sidecar, False for the media file. Every write path asks this
    instead of reading ``save_metadata_to_disk`` itself (#2293).
    """
    mode = user.save_metadata_to_disk
    if mode == User.SaveMetadata.SIDECAR_FILE:
        return True
    if mode == User.SaveMetadata.MEDIA_FILE:
        return False
    return None


def _keeps_edits(photo: Photo) -> bool:
    """Whether an edit written into ``photo``'s file would stay there.

    Not for a local copy of a Nextcloud file (#2258): the next scan that finds
    the file changed on the server downloads it over the copy, and nothing is
    uploaded back, so the edit would be invisible in Nextcloud and then lost.
    The edit stays in LibrePhotos either way.
    """
    main_file = photo.main_file
    return main_file is not None and not is_nextcloud_copy(main_file.path)


def write_photo_metadata_on_commit(
    photo: Photo, modified_fields: list[str], using: str | None = None
) -> None:
    """Write ``modified_fields`` of a user's edit once the edit commits.

    Follows the owner's "Synchronize metadata to disk" (``write_target``).
    The write waits for the commit (#2298): a failed or rolled-back save
    never touches the file, and a failed write is logged without undoing
    the saved edit.
    """
    use_sidecar = write_target(photo.owner)
    if use_sidecar is None:
        return

    def write() -> None:
        try:
            write_photo_metadata(photo, modified_fields, use_sidecar)
        except MetadataWriteError as error:
            logger.warning(
                "The edit of photo %s was not written to disk: %s",
                photo.image_hash,
                error,
            )

    transaction.on_commit(write, using=using, robust=True)


def write_photo_metadata(
    photo: Photo,
    modified_fields: list[str] | None = None,
    use_sidecar: bool = True,
    metadata_types: list[str] | None = None,
) -> None:
    """Write metadata tags to the photo's file or sidecar.

    Raises ``MetadataWriteError`` when ExifTool did not write the tags.

    Args:
        modified_fields: The fields the caller changed ("rating",
            "timestamp"). When None, writes all applicable tags unconditionally.
        use_sidecar: Write to XMP sidecar file if True, media file if False.
        metadata_types: List of metadata categories to write, e.g.
            ["ratings", "face_tags"]. When None, uses default behavior
            (ratings/timestamps only, for backward compatibility).
    """
    tags_to_write: dict[str, TagValue] = {}

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

        tags_to_write.update(get_face_region_tags(photo, use_sidecar))

    if tags_to_write and _keeps_edits(photo):
        assert photo.main_file is not None
        write_metadata(photo.main_file.path, tags_to_write, use_sidecar=use_sidecar)


def rotate_photo(
    photo: Photo, angle: int = 0, flip_horizontal: bool = False
) -> str | None:
    """Rotate the photo non-destructively.

    Updates ``local_orientation`` and regenerates thumbnails. The change is
    stored in the DB and reflected in the regenerated thumbnails; the
    orientation reaches the file (or sidecar) only when the owner has
    ``save_metadata_to_disk`` on (``write_orientation_to_disk``).

    Args:
        photo: The photo to rotate.
        angle: Clockwise rotation in degrees. Must be a multiple of 90.
            Use negative values for counter-clockwise rotation (e.g. -90
            for 90° CCW).
        flip_horizontal: If True, apply a horizontal flip on top of the
            rotation.

    Returns:
        Why the orientation could not be written to disk, or None.

    Raises:
        ValueError: If ``angle`` is not a multiple of 90.
    """
    angle = int(angle) % 360  # normalise first so -90 → 270, 360 → 0

    if angle % 90 != 0:
        raise ValueError("angle must be a multiple of 90 degrees")

    if angle == 0 and not flip_horizontal:
        return None

    from api.thumbnails import render

    photo.local_orientation = compose_orientation(
        photo.local_orientation,
        delta_angle_cw=angle,
        flip_h=flip_horizontal,
    )
    photo.save()

    # Regenerate thumbnails so the UI sees the updated orientation.
    render.regenerate_thumbnails(photo.thumbnail)

    return write_orientation_to_disk(photo, angle, flip_horizontal)


def write_orientation_to_disk(
    photo: Photo, angle: int, flip_horizontal: bool
) -> str | None:
    """Write the combined orientation to the file / sidecar when the user
    has opted into persisting metadata to disk.

    A media-file write the renderer picks up is folded into the file (see
    ``_fold_rotation_into_file``). Anything else keeps the rotation in
    ``local_orientation`` and writes the tag for other viewers only.

    Returns why the write failed, or None; the rotation itself is saved
    either way.
    """
    use_sidecar = write_target(photo.owner)
    if use_sidecar is None or not _keeps_edits(photo):
        return None
    try:
        _write_orientation(photo, angle, flip_horizontal, use_sidecar)
    except MetadataWriteError as error:
        logger.warning(
            "The rotation of photo %s was not written to disk: %s",
            photo.image_hash,
            error,
        )
        return str(error)
    return None


def _write_orientation(
    photo: Photo, angle: int, flip_horizontal: bool, use_sidecar: bool
) -> None:
    if not use_sidecar and _fold_rotation_into_file(photo):
        return

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
    assert photo.main_file is not None
    write_metadata(
        photo.main_file.path,
        {Tags.ORIENTATION: combined},
        use_sidecar=use_sidecar,
    )


def _fold_rotation_into_file(photo: Photo) -> bool:
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
    * the value is really on disk afterwards: the file is read back.
      A write ExifTool refused raises ``MetadataWriteError`` before that.

    The file's own tag is the starting point, not ``PhotoMetadata.orientation``,
    which the scan never fills in: a photo shot in portrait (EXIF 6) would
    otherwise be written back as if it were upright.

    Returns False, having written nothing, when the file cannot be folded
    into, so the caller keeps the rotation in ``local_orientation`` as
    before. Returns True once the write was attempted; a write that did not
    land is logged and leaves ``local_orientation`` alone.
    """
    from api.metadata.writer import read_orientation
    from api.thumbnails.render import exif_orientation_showing, renders_exif_orientation

    assert photo.main_file is not None
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
            "orientation %s was not written to %s "
            "(the file says %s); keeping the rotation in the database",
            combined,
            path,
            written,
        )
        return True

    _adopt_written_orientation(photo, combined)
    return True


def _adopt_written_orientation(photo: Photo, combined: int) -> None:
    """Fold a confirmed media-file orientation write back into the DB.

    The file's own EXIF now carries the whole rotation: ``local_orientation``
    goes back to 1 so the renderer does not apply it twice, and
    ``PhotoMetadata.orientation`` records what the file says.
    """
    if photo.local_orientation != 1:
        photo.local_orientation = 1
        photo.save(update_fields=["local_orientation"])

    metadata = getattr(photo, "metadata", None)
    if metadata is not None and metadata.orientation != combined:
        metadata.orientation = combined
        metadata.save(update_fields=["orientation"])
