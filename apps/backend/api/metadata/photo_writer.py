"""Writing a photo's LibrePhotos edits back to its file or XMP sidecar.

Ratings, capture dates, captions, locations, face regions and rotations.
Moved out of ``Photo``; every function takes the photo as its first argument. ``Photo.save()`` only
saves: a caller that applies a user's edit calls the writer itself, for the
fields it changed (#2336).
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import TYPE_CHECKING

from django.db import transaction

from api.metadata.orientation import compose_orientation
from api.metadata.reader import (
    MetadataReadError,
    existing_sidecars,
    get_metadata,
    sidecar_files_for_photo,
)
from api.metadata.tags import Tags
from api.metadata.writer import (
    MetadataWriteError,
    TagValue,
    WriteOption,
    write_metadata,
)
from api.models.photo_caption import PhotoCaption
from api.models.photo_metadata import (
    DESCRIPTION_SOURCES,
    IMPORTED_DESCRIPTION_KEY,
    description_of,
)
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


# ---------------------------------------------------------- caption, location


def caption_tags(caption: str, use_sidecar: bool) -> dict[str, TagValue]:
    """The tags that make ``caption`` the description; an empty one removes it."""
    tag = Tags.DESCRIPTION_XMP if use_sidecar else Tags.DESCRIPTION_MWG
    return {tag: caption}


def write_caption(photo: Photo, use_sidecar: bool) -> None:
    """Write the photo's caption as its description (#2289).

    The lightbox caption (``captions_json["user_caption"]``) as it is when the
    write runs; a generated caption is never written. An empty caption removes
    the description. Into the sidecar as ``XMP-dc:Description``; into the
    media file through ExifTool's MWG composite, which also sets
    ``EXIF:ImageDescription`` and an ``IPTC:Caption-Abstract`` the file
    already has (a file without IPTC gains none). Line breaks are kept.

    Raises ``MetadataWriteError`` when ExifTool did not write it.
    """
    captions = (
        PhotoCaption.objects.filter(photo=photo)
        .values_list("captions_json", flat=True)
        .first()
    )
    caption = captions.get("user_caption") if isinstance(captions, dict) else None
    if _write_edit(
        photo,
        caption_tags(caption if isinstance(caption, str) else "", use_sidecar),
        use_sidecar,
        options=(WriteOption.MWG, WriteOption.MULTILINE),
    ):
        _remember_file_description(photo)


def _remember_file_description(photo: Photo) -> None:
    """Record the description the file gives now as the one last imported.

    A rescan imports a file description only when it differs from the one it
    imported last (``PhotoMetadata._import_description_to_caption``). After
    a caption is cleared in sidecar mode the file again says what the
    original says; without this, the next rescan would bring that back as
    the caption.
    """
    from api.metadata.photo_reader import EXIF_FIELDS

    assert photo.main_file is not None
    names = (*DESCRIPTION_SOURCES, "camera")
    tag_of = dict(EXIF_FIELDS)
    try:
        values = get_metadata(
            photo.main_file.path,
            tags=[tag_of[name] for name in names],
            sidecar_files=sidecar_files_for_photo(photo),
        )
    except MetadataReadError as error:
        logger.warning(
            "The description of photo %s could not be read back: %s",
            photo.image_hash,
            error,
        )
        return
    description = description_of(dict(zip(names, values)))
    with transaction.atomic():
        caption = PhotoCaption.objects.select_for_update().filter(photo=photo).first()
        if caption is None:
            return
        captions = dict(caption.captions_json or {})
        captions.pop(IMPORTED_DESCRIPTION_KEY, None)
        if description:
            captions[IMPORTED_DESCRIPTION_KEY] = description
        caption.captions_json = captions
        caption.save(update_fields=["captions_json"])


def _degrees(value: float) -> str:
    """Decimal degrees to a tenth of a millimetre of arc, without trailing zeros."""
    return f"{value:.7f}".rstrip("0").rstrip(".")


def location_tags(
    latitude: float | None, longitude: float | None, use_sidecar: bool, video: bool
) -> dict[str, TagValue]:
    """The tags that put the photo at ``latitude``, ``longitude`` (#2290).

    Either one None removes the location. Each target gets the tags ExifTool
    builds ``Composite:GPSLatitude``/``GPSLongitude`` from there (or, for a
    sidecar, the ones ``SIDECAR_EQUIVALENTS`` reads):

    * sidecar: ``XMP-exif:GPSLatitude``/``GPSLongitude`` in signed degrees;
    * video file: ``Keys:GPSCoordinates`` as "<lat> <lon>", the older
      ``UserData`` and ``ItemList`` copies removed;
    * image file: ``GPS:GPSLatitude``/``GPSLongitude`` unsigned, with the
      hemisphere letters in the ``Ref`` tags (``_image_location_tags``).
    """
    if latitude is None or longitude is None:
        position = None
    else:
        position = (latitude, longitude)
    if use_sidecar:
        return _sidecar_location_tags(position)
    if video:
        return _video_location_tags(position)
    return _image_location_tags(position)


def _sidecar_location_tags(position: tuple[float, float] | None) -> dict[str, TagValue]:
    latitude, longitude = (
        (_degrees(value) for value in position) if position else ("", "")
    )
    return {Tags.GPS_LATITUDE_XMP: latitude, Tags.GPS_LONGITUDE_XMP: longitude}


def _video_location_tags(position: tuple[float, float] | None) -> dict[str, TagValue]:
    coordinates = " ".join(_degrees(value) for value in position) if position else ""
    return {
        Tags.GPS_COORDINATES_KEYS: coordinates,
        Tags.GPS_COORDINATES_USER_DATA: "",
        Tags.GPS_COORDINATES_ITEM_LIST: "",
    }


def _image_location_tags(position: tuple[float, float] | None) -> dict[str, TagValue]:
    """The EXIF GPS tags of ``position``, or their removal.

    The hemisphere is a letter computed here: the writer's ``-n`` makes
    ExifTool ignore the sign of a number written to a ``Ref`` tag (#2290).
    The altitude goes, since it belonged to the old position, and so does an
    embedded XMP position, which would otherwise disagree with the new one.
    """
    tags: dict[str, TagValue] = {
        Tags.GPS_LATITUDE: "",
        Tags.GPS_LATITUDE_REF: "",
        Tags.GPS_LONGITUDE: "",
        Tags.GPS_LONGITUDE_REF: "",
        Tags.GPS_ALTITUDE_EXIF: "",
        Tags.GPS_ALTITUDE_REF: "",
        Tags.GPS_LATITUDE_XMP: "",
        Tags.GPS_LONGITUDE_XMP: "",
    }
    if position is not None:
        latitude, longitude = position
        tags[Tags.GPS_LATITUDE] = _degrees(abs(latitude))
        tags[Tags.GPS_LATITUDE_REF] = "S" if latitude < 0 else "N"
        tags[Tags.GPS_LONGITUDE] = _degrees(abs(longitude))
        tags[Tags.GPS_LONGITUDE_REF] = "W" if longitude < 0 else "E"
    return tags


def write_location(photo: Photo, use_sidecar: bool) -> None:
    """Write the photo's position (``exif_gps_lat``/``lon``) as it is now (#2290).

    No position removes the location tags. Removing them from a sidecar
    leaves the position embedded in the original, which a fresh import reads
    again; inside LibrePhotos the removal stays (``location_source``).

    Raises ``MetadataWriteError`` when ExifTool did not write it.
    """
    _write_edit(
        photo,
        location_tags(photo.exif_gps_lat, photo.exif_gps_lon, use_sidecar, photo.video),
        use_sidecar,
    )


def _write_edit(
    photo: Photo,
    tags: dict[str, TagValue],
    use_sidecar: bool,
    options: tuple[WriteOption, ...] = (),
) -> bool:
    """Write one edited field's ``tags`` into the photo's file or sidecar.

    Returns whether ExifTool wrote; a removal from a sidecar that does not
    exist has nothing to do.
    """
    if not _keeps_edits(photo):
        return False
    assert photo.main_file is not None
    path = photo.main_file.path
    removes_only = all(value == "" for value in tags.values())
    if use_sidecar and removes_only and not existing_sidecars(path):
        return False
    write_metadata(path, tags, use_sidecar=use_sidecar, options=options)
    return True


def _write_rating(photo: Photo, use_sidecar: bool) -> None:
    write_photo_metadata(photo, modified_fields=["rating"], use_sidecar=use_sidecar)


#: The writer of each field ``api.metadata.jobs`` writes in the background.
FIELD_WRITERS: dict[str, Callable[[Photo, bool], None]] = {
    "rating": _write_rating,
    "caption": write_caption,
    "location": write_location,
}


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
        angle: Counter-clockwise rotation in degrees, as the photo is
            shown. Must be a multiple of 90. Use negative values for a
            clockwise turn (e.g. -90 for 90° CW, what the web app's
            clockwise button sends). Pinned by
            ``api/tests/photos/test_rotate_direction.py`` (#2595).
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

    # ``compose_orientation`` counts clockwise in EXIF terms, but the
    # renderer draws local orientation 6 as a turn counter-clockwise
    # (``_apply_local_orientation``), so ``angle`` comes out counter-clockwise.
    photo.local_orientation = compose_orientation(
        photo.local_orientation,
        delta_angle_cw=angle,
        flip_h=flip_horizontal,
    )
    photo.save()
    if angle % 180 == 90:
        _swap_shown_size(photo)

    # Regenerate thumbnails so the UI sees the updated orientation.
    render.regenerate_thumbnails(photo.thumbnail)

    return write_orientation_to_disk(photo)


def _swap_shown_size(photo: Photo) -> None:
    """A quarter turn swaps the size the photo is shown at (#2568)."""
    metadata = getattr(photo, "metadata", None)
    if metadata is None:
        return
    metadata.width, metadata.height = metadata.height, metadata.width
    metadata.save(update_fields=["width", "height"])


def write_orientation_to_disk(photo: Photo) -> str | None:
    """Write the photo's rotation to its file or sidecar when the owner has
    opted into persisting metadata to disk.

    Into the sidecar as ``XMP-tiff:Orientation`` (``_write_sidecar_orientation``).
    Into the media file only where the renderer picks the tag up: there the
    rotation is folded into the file (``_fold_rotation_into_file``). A HEIC,
    AVIF or RAW original is left alone and the rotation stays in
    ``local_orientation`` (#2297).

    Returns why the write failed, or None; the rotation itself is saved
    either way.
    """
    use_sidecar = write_target(photo.owner)
    if use_sidecar is None or not _keeps_edits(photo):
        return None
    try:
        if use_sidecar:
            _write_sidecar_orientation(photo)
        else:
            _fold_rotation_into_file(photo)
    except MetadataWriteError as error:
        logger.warning(
            "The rotation of photo %s was not written to disk: %s",
            photo.image_hash,
            error,
        )
        return str(error)
    return None


def _orientation_on_disk(path: str) -> int:
    """The EXIF Orientation in the original ``path``; raises when unreadable."""
    from api.metadata.writer import read_orientation

    on_disk = read_orientation(path)
    if on_disk is None:
        raise MetadataWriteError(path, "ExifTool could not read its orientation")
    return on_disk


def _write_sidecar_orientation(photo: Photo) -> None:
    """Record the rotation as ``XMP-tiff:Orientation`` in the sidecar (#2297).

    ``EXIF:Orientation`` cannot be stored in an ``.xmp``. An app that reads
    the sidecar takes its orientation instead of the original's own tag, so
    the value is the one that shows the original the way LibrePhotos renders
    it now (``exif_orientation_showing``): the original's tag, which sidecar
    mode never changes, with the whole of ``local_orientation`` on top. Every
    rotate rewrites it from that same base, so rotations do not pile up.
    LibrePhotos does not read it back (``SIDECAR_EQUIVALENTS``).
    """
    from api.thumbnails.render import exif_orientation_showing

    assert photo.main_file is not None
    path = photo.main_file.path
    shown = exif_orientation_showing(
        _orientation_on_disk(path), photo.local_orientation
    )
    write_metadata(path, {Tags.ORIENTATION_XMP: shown}, use_sidecar=True)


def _fold_rotation_into_file(photo: Photo) -> None:
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

    Any other format is not written at all and keeps the rotation in
    ``local_orientation`` (#2297): its renderer ignores the tag, and libheif
    applies the HEIF ``irot`` box instead, so a written tag would only
    replace the camera's own value. A file whose orientation cannot be read
    raises ``MetadataWriteError``; a write that did not land is logged and
    leaves ``local_orientation`` alone.
    """
    from api.metadata.writer import read_orientation
    from api.thumbnails.render import exif_orientation_showing, renders_exif_orientation

    assert photo.main_file is not None
    path = photo.main_file.path
    if not renders_exif_orientation(path):
        logger.info(
            "%s is not rewritten: its format does not show an EXIF orientation, "
            "so the rotation stays in LibrePhotos",
            path,
        )
        return

    combined = exif_orientation_showing(
        _orientation_on_disk(path), photo.local_orientation
    )
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
        return

    _adopt_written_orientation(photo, combined)


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
