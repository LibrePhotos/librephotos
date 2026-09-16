"""
File and Photo creation handlers.

This module contains functions for creating File records and grouping
them into Photo objects.
"""

import datetime
import os
from functools import partial

import pytz
from django.conf import settings
from django.db import transaction
from django.db.models import Q

from api import transcode_cache, util
from api.models import File, Photo, Thumbnail
from api.models.file import (
    calculate_hash,
    content_hash,
    detect_file_type,
    hash_owner_part,
    is_metadata,
    is_raw,
    is_valid_media,
    is_video,
)
from api.models.thumbnail import delete_thumbnail_files
from api.models.photo_search import PhotoSearch
from api.perceptual_hash import calculate_hash_from_thumbnail
from api.stacks.live_photo import (
    has_embedded_motion_video,
    extract_embedded_motion_video,
)

from api.directory_watcher.file_grouping import (
    FILE_TYPE_PRIORITY,
    find_matching_jpeg_photo,
    find_matching_image_for_video,
    select_main_file,
)
from api.directory_watcher.utils import update_scan_counter


def _is_replacement(stored_hash: str, disk_hash: str) -> bool:
    """Do these two hashes mean "same path, different picture"?

    Only the content part may be compared: a File has no owner, so the same
    bytes hash differently per user and a second user scanning a path the
    first one already indexed would otherwise look like an endless
    replacement, each scan churning the other user's rows back.

    For the same reason a row calculated for a different user is never
    treated as replaced here; that user's own scan is what re-indexes it.
    """
    if content_hash(stored_hash) == content_hash(disk_hash):
        return False
    return hash_owner_part(stored_hash) == hash_owner_part(disk_hash)


def _remove_file(path: str) -> None:
    if path and os.path.exists(path):
        try:
            os.remove(path)
        except OSError:
            util.logger.warning(f"could not remove stale file {path}")


def _discard_embedded_media(file: File) -> None:
    """Drop the motion videos extracted from a file that is about to change.

    ``_attach_embedded_motion_video`` only runs when a Photo is created, so a
    replaced Live Photo would otherwise keep serving the motion video of the
    picture that is gone and never extract the new one.
    """
    for embedded in list(file.embedded_media.all()):
        file.embedded_media.remove(embedded)
        for photo in Photo.objects.filter(files=embedded):
            photo.files.remove(embedded)
        embedded_path = embedded.path
        embedded.delete()
        transaction.on_commit(partial(_remove_file, embedded_path))


def _discard_derived_content(photo: Photo, old_hash: str) -> None:
    """Throw away everything that still describes the picture that was replaced.

    Thumbnails, the cached transcode and the face crops are all named after
    the old image hash, and the dominant colour was sampled from it. The face
    rows go with their crops: they are served by parsing the hash out of the
    file name, so a moved hash would leave the people grid pointing at 404s.
    """
    photo.faces.all().delete()

    transcode_cache.discard(old_hash)

    thumbnail = getattr(photo, "thumbnail", None)
    if thumbnail:
        thumbnail.dominant_color = None
        thumbnail.save(update_fields=["dominant_color"])

    transaction.on_commit(partial(delete_thumbnail_files, old_hash))


def reindex_replaced_file(user, path, hash_value) -> Photo | None:
    """Re-point the rows of ``path`` at its new content after an in-place replace.

    ``File.create`` matches on path alone, so a file swapped out for a
    different picture under the same name keeps its old hash forever. Every
    derived artefact is keyed on that hash - thumbnails are only generated
    when no file named after it exists yet - so the library would keep showing
    the picture that is no longer there.

    The Photo row survives with its id, albums and shares; only what was
    derived from the old picture is discarded. ``added_on`` moves to now so
    the tag, geolocation and face jobs, which select on it, pick the photo up
    again.

    Returns the Photo the replaced file is the main file of, if any.
    """
    existing = File.objects.filter(path=path).first()
    if existing is None or not _is_replacement(existing.hash, hash_value):
        return None

    if File.objects.filter(hash=hash_value).exists():
        util.logger.warning(
            f"replaced file {path} matches an already indexed file, not re-indexing"
        )
        return None

    old_hash = existing.hash
    util.logger.info(f"file {path} was replaced, re-indexing as {hash_value}")

    owned = Photo.objects.owned_by(user)
    photo_ids = set(
        owned.filter(Q(files=existing) | Q(main_file=existing)).values_list(
            "pk", flat=True
        )
    )
    main_photo_ids = set(owned.filter(main_file=existing).values_list("pk", flat=True))

    main_photo = None
    with transaction.atomic():
        _discard_embedded_media(existing)
        new_file = existing.rekey(hash_value)
        new_file.type = detect_file_type(new_file.path)
        new_file.save(update_fields=["type"])

        # Re-read the rows: ``rekey`` has moved their main_file across, so the
        # instances fetched before it still carry the deleted hash.
        for photo in Photo.objects.filter(pk__in=photo_ids):
            if photo.pk in main_photo_ids:
                main_photo = photo
            if photo.image_hash == old_hash:
                _discard_derived_content(photo, old_hash)
                photo.image_hash = hash_value
                photo.added_on = datetime.datetime.now().replace(tzinfo=pytz.utc)
            photo.save(save_metadata=False)

    if main_photo:
        _attach_embedded_motion_video(user, main_photo, new_file)

    return main_photo


def create_file_record(user, path) -> File | None:
    """
    Phase 1: Create a File record for a path without creating/grouping Photos.

    This is the first phase of the two-phase scan architecture:
    - Phase 1: Create File records for all discovered files (this function)
    - Phase 2: Group files into Photos by (directory, basename)

    This separation eliminates race conditions where concurrent processing
    of RAW and JPEG files could create separate Photos instead of grouping them.

    Args:
        user: The owner of the file
        path: The file path

    Returns:
        File object if created/found, None if invalid media
    """
    if not is_valid_media(path=path, user=user):
        return None

    hash_value = calculate_hash(user, path)

    # Skip if this is embedded media (already attached to another file)
    if File.embedded_media.through.objects.filter(Q(to_file_id=hash_value)).exists():
        util.logger.warning(f"embedded content file found {path}")
        return None

    reindex_replaced_file(user, path, hash_value)

    # Create the File record (File.create handles race conditions via unique path constraint)
    file = File.create(path, user)
    return file


def _attach_embedded_motion_video(user, photo: Photo, file: File) -> File | None:
    """Extract a Google/Samsung Live Photo motion video and attach it as a variant."""
    if not (
        has_embedded_motion_video(file.path)
        and settings.FEATURE_PROCESS_EMBEDDED_MEDIA
        and settings.FEATURE_VIDEO
    ):
        return None

    em_path = extract_embedded_motion_video(file.path, file.hash)
    if not em_path:
        return None

    em_file = File.create(em_path, user)
    file.embedded_media.add(em_file)
    photo.files.add(em_file)
    return em_file


def _adopt_files_into_photo(photo: Photo, files: list[File], main_file: File, job_id):
    """Attach missing files to an existing Photo and upgrade its main_file."""
    for f in files:
        if not photo.files.filter(hash=f.hash).exists():
            photo.files.add(f)
            util.logger.info(
                f"job {job_id}: Attached file {f.path} to existing Photo {photo.image_hash}"
            )

    if not photo.main_file:
        return

    current_priority = FILE_TYPE_PRIORITY.get(photo.main_file.type, 999)
    if FILE_TYPE_PRIORITY.get(main_file.type, 999) < current_priority:
        photo.main_file = main_file
        photo.save(update_fields=["main_file"])


def group_files_into_photo(user, files: list[File], job_id) -> Photo | None:
    """
    Phase 2: Group a list of related files into a single Photo.

    Creates a new Photo with the given files as variants, selecting the
    best file as main_file based on type priority (IMAGE > VIDEO > RAW > METADATA).

    This function should be called with all files that share the same
    (directory, basename) - e.g., IMG_001.jpg, IMG_001.CR2, IMG_001.xmp.

    Args:
        user: The owner of the photo
        files: List of File objects to group (must not be empty)
        job_id: Job ID for logging

    Returns:
        The created Photo, or None if no valid files
    """
    if not files:
        return None

    # Filter out metadata files for main photo creation - they're sidecars
    non_metadata_files = [f for f in files if f.type != File.METADATA_FILE]

    if not non_metadata_files:
        # Only metadata files - no photo to create
        util.logger.warning(f"job {job_id}: Only metadata files in group, skipping")
        return None

    # Select main file based on priority
    main_file = select_main_file(non_metadata_files)
    if not main_file:
        return None

    # Check if a Photo already exists with any of these files. Matching on
    # main_file as well as the files m2m re-adopts photos whose file went
    # missing and reappeared: _check_files detaches a missing file from the
    # m2m but keeps main_file pointing at it, so without that match a
    # reappearing file would spawn a duplicate Photo with the same image_hash.
    existing_photo = Photo.objects.filter(
        Q(owner=user) & (Q(files__in=files) | Q(main_file__in=files))
    ).first()

    if existing_photo:
        _adopt_files_into_photo(existing_photo, files, main_file, job_id)
        return existing_photo

    # Create new Photo
    photo = Photo()
    photo.image_hash = main_file.hash
    photo.owner = user
    photo.added_on = datetime.datetime.now().replace(tzinfo=pytz.utc)
    photo.geolocation_json = {}
    photo.video = main_file.type == File.VIDEO
    photo.save()

    # Add all files to the photo
    for f in files:
        photo.files.add(f)

    photo.main_file = main_file
    photo.save()

    if _attach_embedded_motion_video(user, photo, main_file):
        photo.save()

    util.logger.info(
        f"job {job_id}: Created Photo {photo.image_hash} with {len(files)} file(s)"
    )
    return photo


def _attach_metadata_sidecar(user, path) -> None:
    """Attach an XMP sidecar to the Photo it describes, if one exists."""
    photo_name = os.path.splitext(os.path.basename(path))[0]
    photo_dir = os.path.dirname(path)
    photo = Photo.objects.filter(
        Q(files__path__contains=photo_dir)
        & Q(files__path__contains=photo_name)
        & ~Q(files__path__contains=os.path.basename(path))
    ).first()

    if not photo:
        util.logger.warning(f"no photo to metadata file found {path}")
        return

    photo.files.add(File.create(path, user))
    photo.save()


def _attach_file_variant(user, path, photo: Photo, label, keep_image=False) -> Photo:
    """Attach a sibling file to an existing Photo as a variant."""
    if not photo.files.filter(path=path).exists():
        photo.files.add(File.create(path, user))
        if keep_image:
            photo.video = False
        photo.save()
        util.logger.info(
            f"Attached {label} {path} to existing Photo {photo.image_hash}"
        )
    return photo


def _adopt_as_variant(user, path) -> Photo | None:
    """
    Attach RAW files and Live Photo videos to the image Photo they belong to.

    Returns the adopting Photo, or None when the file stands on its own.
    """
    if is_raw(path):
        photo = find_matching_jpeg_photo(path, user)
        if photo:
            return _attach_file_variant(user, path, photo, "RAW file")

    if is_video(path):
        photo = find_matching_image_for_video(path, user)
        if photo:
            return _attach_file_variant(
                user, path, photo, "Live Photo video", keep_image=True
            )

    return None


def create_new_image(user, path) -> Photo | None:
    """
    Creates a new Photo object based on user input and file path.

    This is the legacy single-file creation function, kept for backwards
    compatibility with upload handling. For scan operations, use the
    two-phase approach (create_file_record + group_files_into_photo).

    Args:
        user: The owner of the photo.
        path: The file path of the image.

    Returns:
        The created Photo object if successful, otherwise returns None.

    Note:
        This function implements file variant grouping (PhotoPrism-like):
        - RAW files are attached to existing JPEG Photos as file variants
        - Live Photo videos (.mov) are attached to existing image Photos as file variants
        - Other files create new Photo entities
    """
    if not is_valid_media(path=path, user=user):
        return None
    hash_value = calculate_hash(user, path)
    if File.embedded_media.through.objects.filter(Q(to_file_id=hash_value)).exists():
        util.logger.warning(f"embedded content file found {path}")
        return None

    if is_metadata(path):
        _attach_metadata_sidecar(user, path)
        return None

    replaced_photo = reindex_replaced_file(user, path, hash_value)
    if replaced_photo:
        return replaced_photo

    existing_photo = _adopt_as_variant(user, path)
    if existing_photo:
        return existing_photo

    # === Standard Photo Creation ===
    photo = Photo()
    photo.image_hash = hash_value
    photo.owner = user
    photo.added_on = datetime.datetime.now().replace(tzinfo=pytz.utc)
    photo.geolocation_json = {}
    photo.video = is_video(path)
    photo.save()
    file = File.create(path, user)

    _attach_embedded_motion_video(user, photo, file)

    photo.files.add(file)
    photo.main_file = file
    photo.save()
    return photo


def handle_new_image(user, path, job_id, photo=None):
    """
    Handles the creation and all the processing of the photo needed for it to be displayed.

    Args:
        user: The owner of the photo.
        path: The file path of the image.
        job_id: The long-running job id, which gets updated when the task runs
        photo: An optional parameter, where you can input a photo instead of creating a new one. Used for uploading.

    Note:
        This function is used when uploading a picture, because rescanning does not perform machine learning tasks.
    """
    try:
        start = datetime.datetime.now()
        if photo is None:
            photo = create_new_image(user, path)
            elapsed = (datetime.datetime.now() - start).total_seconds()
            util.logger.info(f"job {job_id}: save image: {path}, elapsed: {elapsed}")
        if photo:
            _process_photo(photo, path, job_id, start)

    except Exception as e:
        try:
            util.logger.exception(
                f"job {job_id}: could not load image {path}. reason: {str(e)}"
            )
        except Exception:
            util.logger.exception(f"job {job_id}: could not load image {path}")
    finally:
        update_scan_counter(job_id)


def _collect_file_records(user, file_paths: list[str]) -> list[File]:
    """Create File records for every valid path in a group."""
    files = []
    for path in file_paths:
        file = create_file_record(user, path)
        if file:
            files.append(file)
    return files


def _log_file_group_failure(job_id, file_paths, error: Exception):
    try:
        util.logger.exception(
            f"job {job_id}: could not process file group {file_paths}. reason: {str(error)}"
        )
    except Exception:
        util.logger.exception(f"job {job_id}: could not process file group")


def handle_file_group(user, file_paths: list[str], job_id):
    """
    Phase 2 handler: Process a group of related files into a single Photo.

    This is called after Phase 1 has created File records for all paths.
    Files are grouped by (directory, basename) so RAW+JPEG pairs are processed together.

    Args:
        user: The owner of the files
        file_paths: List of file paths that share the same (directory, basename)
        job_id: Job ID for logging and progress tracking
    """
    try:
        start = datetime.datetime.now()

        files = _collect_file_records(user, file_paths)
        if not files:
            util.logger.warning(f"job {job_id}: No valid files in group: {file_paths}")
            return

        # Group files into a Photo
        photo = group_files_into_photo(user, files, job_id)

        if not photo:
            util.logger.warning(
                f"job {job_id}: Could not create photo for files: {file_paths}"
            )
            return

        elapsed = (datetime.datetime.now() - start).total_seconds()
        util.logger.info(
            f"job {job_id}: created photo with {len(files)} files, elapsed: {elapsed}"
        )

        # Process the photo (thumbnails, EXIF, etc.) using main_file
        if photo.main_file:
            _process_photo(photo, photo.main_file.path, job_id, start)

    except Exception as e:
        _log_file_group_failure(job_id, file_paths, e)
    finally:
        update_scan_counter(job_id)


def _process_photo(photo: Photo, path: str, job_id, start: datetime.datetime):
    """
    Process a photo: generate thumbnails, extract EXIF, calculate hashes, etc.

    This is the common processing logic shared between handle_new_image and handle_file_group.

    Args:
        photo: The Photo object to process
        path: The main file path (for logging)
        job_id: Job ID for logging
        start: Start time for elapsed time calculation
    """
    util.logger.info(f"job {job_id}: handling image {path}")

    # Create or get thumbnail instance
    thumbnail, _ = Thumbnail.objects.get_or_create(photo=photo)
    thumbnail._generate_thumbnail()
    elapsed = (datetime.datetime.now() - start).total_seconds()
    util.logger.info(f"job {job_id}: generate thumbnails: {path}, elapsed: {elapsed}")

    thumbnail._calculate_aspect_ratio()
    elapsed = (datetime.datetime.now() - start).total_seconds()
    util.logger.info(
        f"job {job_id}: calculate aspect ratio: {path}, elapsed: {elapsed}"
    )

    # Calculate perceptual hash for duplicate detection
    if thumbnail.thumbnail_big and os.path.exists(thumbnail.thumbnail_big.path):
        phash = calculate_hash_from_thumbnail(thumbnail.thumbnail_big.path)
        if phash:
            photo.perceptual_hash = phash
            photo.save(update_fields=["perceptual_hash"])
            elapsed = (datetime.datetime.now() - start).total_seconds()
            util.logger.info(
                f"job {job_id}: calculate perceptual hash: {path}, elapsed: {elapsed}"
            )

    from api.models.photo_metadata import PhotoMetadata

    PhotoMetadata.extract_exif_data(photo, commit=True)
    elapsed = (datetime.datetime.now() - start).total_seconds()
    util.logger.info(f"job {job_id}: extract exif data: {path}, elapsed: {elapsed}")

    # Categorise the photo (screenshot/document) from the freshly extracted
    # metadata. A manual correction ("user") is never overwritten by a rescan.
    # The value is persisted by the full ``photo.save()`` inside the
    # ``_extract_date_time_from_exif`` call immediately below.
    if photo.category_source != "user":
        from api.screenshot_detection import classify

        photo.is_screenshot = classify(photo)

    photo._extract_date_time_from_exif(True)
    elapsed = (datetime.datetime.now() - start).total_seconds()
    util.logger.info(f"job {job_id}: extract date time: {path}, elapsed: {elapsed}")

    thumbnail._get_dominant_color()
    elapsed = (datetime.datetime.now() - start).total_seconds()
    util.logger.info(f"job {job_id}: get dominant color: {path}, elapsed: {elapsed}")

    search_instance, created = PhotoSearch.objects.get_or_create(photo=photo)
    search_instance.recreate_search_captions()
    search_instance.save()
    elapsed = (datetime.datetime.now() - start).total_seconds()
    util.logger.info(
        f"job {job_id}: search caption recreated: {path}, elapsed: {elapsed}"
    )
