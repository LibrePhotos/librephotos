"""Writing a photo's LibrePhotos edits back to its file or XMP sidecar.

Ratings, capture dates, captions, locations, tags (as keywords), face regions
and rotations.
Moved out of ``Photo``; every function takes the photo as its first argument. ``Photo.save()`` only
saves: a caller that applies a user's edit calls the writer itself, for the
fields it changed (#2336).
"""

from __future__ import annotations

import logging
import os
from collections.abc import Callable, Collection, Sequence
from typing import TYPE_CHECKING

from django.db import transaction
from django.utils import timezone

from api.metadata.orientation import compose_orientation
from api.metadata.reader import (
    MetadataReadError,
    existing_sidecars,
    get_metadata,
    sidecar_files_for_photo,
    sidecar_for_write,
)
from api.metadata.tags import Tags
from api.metadata.takeout import takeout_metadata_of
from api.metadata.writer import (
    MetadataWriteError,
    TagValue,
    WriteOption,
    add_to,
    remove_from,
    write_metadata,
)
from api.models.file import File
from api.models.photo_caption import PhotoCaption
from api.models.photo_metadata import (
    FILE_DESCRIPTION_SOURCES,
    IMPORTED_DESCRIPTION_KEY,
    PhotoMetadata,
    description_of,
    merged_keywords_of,
)
from api.models.tag import Tag
from api.models.user import User
from api.photos import indexed_mtimes
from api.photos.paths import is_nextcloud_copy

if TYPE_CHECKING:
    from api.models.photo import Photo

logger = logging.getLogger(__name__)


def write_target(user: User) -> bool | None:
    """Where ``user``'s edits are written back: None when they are not.

    None for "Write edits to files: Off" (the default, which keeps
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


def keeps_edits(photo: Photo) -> bool:
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

    Follows the owner's "Write edits to files" (``write_target``).
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

    if tags_to_write and keeps_edits(photo):
        assert photo.main_file is not None
        indexed = _indexed_files(photo)
        write_metadata(photo.main_file.path, tags_to_write, use_sidecar=use_sidecar)
        indexed_mtimes.record_own_write(indexed)


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
    names = (*FILE_DESCRIPTION_SOURCES, "camera")
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
    takeout = takeout_metadata_of(photo)
    description = description_of(
        {
            **dict(zip(names, values)),
            "takeout_description": takeout.description if takeout else None,
        }
    )
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


def _indexed_files(photo: Photo) -> list[str]:
    """The photo's media files that are as the scan last read them (#2296).

    Asked right before a write: a write that lands is recorded for these
    (``indexed_mtimes.record_own_write``), so the next scan does not read the
    photo again for it, while a change another app made before it is still
    picked up. Every media file of the photo, not only the main one: a RAW
    and its JPEG may share one sidecar (``IMG.xmp``).
    """
    assert photo.main_file is not None
    paths = {
        photo.main_file.path,
        *photo.files.exclude(type=File.METADATA_FILE).values_list("path", flat=True),
    }
    return indexed_mtimes.as_indexed(paths)


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
    if not keeps_edits(photo):
        return False
    assert photo.main_file is not None
    path = photo.main_file.path
    removes_only = all(value == "" for value in tags.values())
    if use_sidecar and removes_only and not existing_sidecars(path):
        return False
    indexed = _indexed_files(photo)
    write_metadata(path, tags, use_sidecar=use_sidecar, options=options)
    indexed_mtimes.record_own_write(indexed)
    return True


# --------------------------------------------------------------------- keywords

#: The keyword sources the scan merges (``merged_keywords_of``), by value name.
FILE_KEYWORD_SOURCES = (
    "xmp_subject",
    "iptc_keywords",
    "person_in_image",
    "hierarchical_subject",
)


def write_keywords(photo: Photo, use_sidecar: bool, names: Collection[str]) -> None:
    """Make the file's keywords agree with the photo's tags ``names`` (#2289).

    Only ``names``, the tags one edit touched, are written: a name the photo
    has as a tag when the job runs is added (once), any other is removed, so
    jobs that run out of order still leave the latest state. The file's
    other keywords stay, and so do its ``PersonInImage`` and
    ``HierarchicalSubject`` entries. A person's name in one of the file's
    face regions is not removed: the face write-back put it there.

    Into the sidecar as ``XMP-dc:Subject``; into the media file through
    ``MWG:Keywords``, which keeps an ``IPTC:Keywords`` the file already has
    in step (a file without IPTC gains none). After the write the file's
    keywords are read back and stored (``_remember_file_keywords``), so a
    rescan does not import a removed keyword the file still gives as new.

    Raises ``MetadataWriteError`` when ExifTool did not write them.
    """
    if not names or not keeps_edits(photo):
        return
    wanted, unwanted = _split_by_tags(photo, names)
    if unwanted:
        faces = set(_face_names_in_file(photo))
        unwanted = [name for name in unwanted if name not in faces]
    tags = _keyword_tags(photo, use_sidecar, wanted, unwanted)
    options = () if use_sidecar else (WriteOption.MWG,)
    if tags and _write_edit(photo, tags, use_sidecar, options=options):
        _remember_file_keywords(photo)


def _split_by_tags(photo: Photo, names: Collection[str]) -> tuple[list[str], list[str]]:
    """``names`` the photo has as tags now, and the ones it has not."""
    on_photo = set(
        Tag.objects.owned_by(photo.owner)
        .filter(photos=photo, name__in=names)
        .values_list("name", flat=True)
    )
    ordered = sorted(set(names))
    return (
        [name for name in ordered if name in on_photo],
        [name for name in ordered if name not in on_photo],
    )


def _face_names_in_file(photo: Photo) -> list[str]:
    """The names of the face regions the file gives (``XMP:RegionInfo``)."""
    from api.metadata.face_regions import region_names

    assert photo.main_file is not None
    (region_info,) = get_metadata(
        photo.main_file.path,
        tags=[Tags.REGION_INFO],
        struct=True,
        sidecar_files=sidecar_files_for_photo(photo),
    )
    return region_names(region_info)


def _keyword_list(value: object) -> list[str]:
    """A keyword tag as ExifTool returns it (one text, a list, a number) as texts."""
    return merged_keywords_of({"xmp_subject": value})


def keyword_changes(
    tag: str,
    own: list[str],
    own_iptc: list[str] | None,
    wanted: Sequence[str],
    unwanted: Sequence[str],
) -> dict[str, TagValue]:
    """The item changes of ``tag`` that add ``wanted`` and remove ``unwanted``.

    ``own`` is the target's ``XMP:Subject``, ``own_iptc`` its
    ``IPTC:Keywords`` (None: it has none). A name already where it belongs
    is left alone, so an edit that changes nothing writes nothing. A name is
    removed before it is added, ExifTool's way to add it once.
    """
    lists = [own] if own_iptc is None else [own, own_iptc]
    remove = [name for name in unwanted if any(name in found for found in lists)]
    add = [name for name in wanted if any(name not in found for found in lists)]
    tags: dict[str, TagValue] = {}
    if remove or add:
        tags[remove_from(tag)] = [*remove, *add]
    if add:
        tags[add_to(tag)] = add
    return tags


def seeded_keywords(
    seed: list[str], wanted: Sequence[str], unwanted: Sequence[str]
) -> list[str] | None:
    """A new sidecar keyword list: ``seed`` with ``wanted`` and without ``unwanted``.

    None when that is ``seed`` itself: the sidecar would say what the
    photo's own keywords already say.
    """
    kept = [keyword for keyword in seed if keyword not in unwanted]
    merged = kept + [name for name in wanted if name not in kept]
    return None if merged == seed else merged


def _keyword_tags(
    photo: Photo, use_sidecar: bool, wanted: list[str], unwanted: list[str]
) -> dict[str, TagValue]:
    """The tags that bring the target's keyword list in line; empty for none.

    A sidecar without a keyword list of its own would hide the photo's
    keywords from the scan, so its first list starts from them
    (``XMP:Subject`` and ``IPTC:Keywords``, as for the face names, #2291). A
    list that would end up empty is not written: ExifTool cannot store an
    empty one, and leaving it out shows the original's keywords again.
    """
    assert photo.main_file is not None
    main_path = photo.main_file.path
    if not use_sidecar:
        subject, iptc = get_metadata(
            main_path, tags=[Tags.SUBJECT, Tags.IPTC_KEYWORDS], try_sidecar=False
        )
        own_iptc = None if iptc is None else _keyword_list(iptc)
        return keyword_changes(
            Tags.KEYWORDS_MWG, _keyword_list(subject), own_iptc, wanted, unwanted
        )
    target = sidecar_for_write(main_path)
    own = None
    if os.path.exists(target):
        (own,) = get_metadata(target, tags=[Tags.SUBJECT], try_sidecar=False)
    if own is not None:
        return keyword_changes(Tags.SUBJECT, _keyword_list(own), None, wanted, unwanted)
    subject, iptc = get_metadata(
        main_path,
        tags=[Tags.SUBJECT, Tags.IPTC_KEYWORDS],
        sidecar_files=sidecar_files_for_photo(photo),
    )
    seed = merged_keywords_of({"xmp_subject": subject, "iptc_keywords": iptc})
    merged = seeded_keywords(seed, wanted, unwanted)
    return {Tags.SUBJECT: merged} if merged else {}


def _remember_file_keywords(photo: Photo) -> None:
    """Store the keywords the file gives now as the photo's file keywords.

    ``PhotoMetadata.keywords`` is what the file says. With write-back on, a
    rescan only turns keywords into tags that the file did not give before
    (``apply_file_values``), so a removed keyword the file still gives (an
    ``IPTC:Keywords`` behind a sidecar, a ``HierarchicalSubject`` leaf) does
    not come back as a tag.
    """
    from api.metadata.photo_reader import EXIF_FIELDS

    assert photo.main_file is not None
    tag_of = dict(EXIF_FIELDS)
    try:
        values = get_metadata(
            photo.main_file.path,
            tags=[tag_of[name] for name in FILE_KEYWORD_SOURCES],
            sidecar_files=sidecar_files_for_photo(photo),
        )
    except MetadataReadError as error:
        logger.warning(
            "The keywords of photo %s could not be read back: %s",
            photo.image_hash,
            error,
        )
        return
    keywords = merged_keywords_of(dict(zip(FILE_KEYWORD_SOURCES, values)))
    PhotoMetadata.objects.filter(photo=photo).update(
        keywords=keywords or None, updated_at=timezone.now()
    )


def _write_rating(photo: Photo, use_sidecar: bool) -> None:
    write_photo_metadata(photo, modified_fields=["rating"], use_sidecar=use_sidecar)


def _write_capture_time(photo: Photo, use_sidecar: bool) -> None:
    write_photo_metadata(photo, modified_fields=["timestamp"], use_sidecar=use_sidecar)


#: The writer of each field ``api.metadata.jobs`` writes in the background.
FIELD_WRITERS: dict[str, Callable[[Photo, bool], None]] = {
    "rating": _write_rating,
    "date_taken": _write_capture_time,
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
    if use_sidecar is None:
        return None
    try:
        write_rotation(photo, use_sidecar)
    except MetadataWriteError as error:
        logger.warning(
            "The rotation of photo %s was not written to disk: %s",
            photo.image_hash,
            error,
        )
        return str(error)
    return None


def write_rotation(photo: Photo, use_sidecar: bool) -> None:
    """Write the photo's rotation as it is now to its sidecar or media file.

    Raises ``MetadataWriteError`` when ExifTool did not write it; see
    ``write_orientation_to_disk`` for what each target gets.
    """
    if not keeps_edits(photo):
        return
    if use_sidecar:
        _write_sidecar_orientation(photo)
    else:
        _fold_rotation_into_file(photo)


def _orientation_on_disk(path: str) -> int:
    """The orientation the original ``path`` is shown under; raises when unreadable.

    Its EXIF Orientation, or a HEIF image's irot/imir (``read_shown_orientation``).
    """
    from api.metadata.writer import read_shown_orientation

    on_disk = read_shown_orientation(path)
    if on_disk is None:
        raise MetadataWriteError(path, "ExifTool could not read its orientation")
    return on_disk


def _write_sidecar_orientation(photo: Photo) -> None:
    """Record the rotation as ``XMP-tiff:Orientation`` in the sidecar (#2297).

    ``EXIF:Orientation`` cannot be stored in an ``.xmp``. An app that reads
    the sidecar takes its orientation instead of the original's own tag, so
    the value is the one that shows the original the way LibrePhotos renders
    it now (``exif_orientation_showing``): the orientation the original is
    shown under, which sidecar mode never changes, with the whole of
    ``local_orientation`` on top. Every rotate rewrites it from that same
    base, so rotations do not pile up. LibrePhotos does not read it back
    (``SIDECAR_EQUIVALENTS``), so a rescan renders the photo as before.

    For a HEIC or AVIF that base is its irot/imir, not its EXIF Orientation,
    which libheif ignores and which can disagree with them (#2620). Like the
    face regions in the same sidecar, the value is relative to the stored
    pixels: digiKam decodes HEIF without irot/imir and orients the pixels by
    the sidecar's ``tiff:Orientation``, and Apple's EXIF tag means the same.
    """
    from api.thumbnails.render import exif_orientation_showing

    assert photo.main_file is not None
    path = photo.main_file.path
    shown = exif_orientation_showing(
        _orientation_on_disk(path), photo.local_orientation
    )
    indexed = _indexed_files(photo)
    write_metadata(path, {Tags.ORIENTATION_XMP: shown}, use_sidecar=True)
    indexed_mtimes.record_own_write(indexed)


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
    indexed = _indexed_files(photo)
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

    indexed_mtimes.record_own_write(indexed)
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
