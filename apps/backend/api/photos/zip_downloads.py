"""The download archive: a job zips a selection of photos, and the archive
is deleted a day after it was built (``delete_zip_file``, a one-off
django-q schedule stored by dotted path).
"""

import logging
import os
import time
import uuid
import zipfile
from collections.abc import Collection, Sequence
from datetime import timedelta

from django.conf import settings
from django.db import DatabaseError
from django.utils import timezone

from api.jobs.queue import enqueue_job, schedule_once
from api.metadata.reader import existing_sidecars
from api.models.file import File
from api.models.long_running_job import LongRunningJob
from api.models.photo import Photo
from api.models.user import User

logger = logging.getLogger(__name__)


def zip_file_name(file_uuid: uuid.UUID | str, user_id: int) -> str | None:
    """Name of the archive a download job writes: ``<uuid><user id>.zip``.

    ``file_uuid`` comes from the client on the delete and serve routes, so it
    must be a canonical UUID. Returns ``None`` otherwise, which keeps a crafted
    value from naming a path outside the zip directory or another user's
    archive (``<uuid>1`` + user ``2`` would otherwise reach user ``12``'s file).
    """
    try:
        canonical = str(uuid.UUID(str(file_uuid)))
    except ValueError, TypeError, AttributeError:
        return None
    if canonical != str(file_uuid).lower():
        return None
    return f"{canonical}{int(user_id)}.zip"


def create_download_job(user: User, photos: list[Photo], filename: str | None) -> str:
    """Queue the archive of ``photos`` for ``user``; returns the job's id.

    Not exclusive: a user may build several archives at once.
    """
    lrj = enqueue_job(
        user,
        LongRunningJob.JOB_DOWNLOAD_PHOTOS,
        zip_photos_task,
        user,
        photos,
        filename,
        exclusive=False,
    )
    return lrj.job_id


def _photo_own_files(photo: Photo) -> list[File]:
    # NOTE: main_file is not guaranteed to be included in Photo.files.
    files: list[File] = []
    main_file = getattr(photo, "main_file", None)
    if main_file is not None:
        files.append(main_file)
    files.extend(list(photo.files.all()))
    return files


def _stacked_variant_files(photo: Photo) -> list[File]:
    # Back-compat: some datasets may still represent RAW+JPEG / Live Photo variants
    # as deprecated stacks. Include those stack members' files too.
    files: list[File] = []
    try:
        variant_stacks = photo.stacks.filter(
            stack_type__in=["raw_jpeg", "live_photo"]
        ).prefetch_related("photos", "photos__files", "photos__main_file")
        for stack in variant_stacks:
            for stack_photo in stack.photos.all():
                files.extend(_photo_own_files(stack_photo))
    except DatabaseError:
        # If stacks aren't available for some reason, just proceed with variants.
        logger.warning(
            "Could not read the variant stacks of photo %s",
            photo.image_hash,
            exc_info=True,
        )
    return files


def _embedded_media_files(files: Sequence[File | None]) -> list[File]:
    embedded: list[File] = []
    for file_obj in files:
        try:
            if file_obj and file_obj.embedded_media.exists():
                embedded.extend(list(file_obj.embedded_media.all()))
        except DatabaseError:
            logger.warning(
                "Could not list the embedded media of file %s",
                getattr(file_obj, "hash", None),
                exc_info=True,
            )
    return embedded


def _unique_arcname(file_name: str, taken_names: Collection[str]) -> str:
    if file_name not in taken_names:
        return file_name
    base_name, ext = os.path.splitext(file_name)
    counter = 1
    while f"{base_name}_{counter}{ext}" in taken_names:
        counter += 1
    return f"{base_name}_{counter}{ext}"


def _zippable_path(file_obj: File | None, files_added: dict[str, str]) -> str | None:
    if not file_obj or not file_obj.path:
        return None
    if not os.path.exists(file_obj.path):
        logger.warning("File not found, skipping: %s", file_obj.path)
        return None
    if file_obj.path in files_added:
        return None
    return file_obj.path


def _is_metadata_file(file_obj: File | None) -> bool:
    return getattr(file_obj, "type", None) == File.METADATA_FILE


def _sidecar_arcname(sidecar: str, media_path: str, media_arcname: str) -> str:
    """The name of ``sidecar`` in the archive, next to its media file's.

    ``IMG.jpg`` goes in as ``IMG_1.jpg`` when another folder's ``IMG.jpg``
    came first; its ``IMG.jpg.xmp`` then goes in as ``IMG_1.jpg.xmp`` and its
    ``IMG.xmp`` as ``IMG_1.xmp``, the names an editor looks for next to
    ``IMG_1.jpg``.
    """
    name = os.path.basename(sidecar)
    media_name = os.path.basename(media_path)
    if name.startswith(media_name):
        return media_arcname + name[len(media_name) :]
    media_stem = os.path.splitext(media_name)[0]
    return os.path.splitext(media_arcname)[0] + name[len(media_stem) :]


def _add_sidecars_to_zip(
    media_path: str,
    media_arcname: str,
    zf: zipfile.ZipFile,
    files_added: dict[str, str],
) -> list[str]:
    """Add the XMP sidecars on disk of ``media_path``; returns their paths.

    Read from disk rather than from the photo's files: a sidecar that
    write-back created or another app wrote since the last scan is no File
    of the photo yet.
    """
    added: list[str] = []
    for sidecar in existing_sidecars(media_path):
        if sidecar in files_added:
            continue
        file_name = _unique_arcname(
            _sidecar_arcname(sidecar, media_path, media_arcname),
            files_added.values(),
        )
        files_added[sidecar] = file_name
        zf.write(sidecar, arcname=file_name)
        added.append(sidecar)
    return added


def _is_added_sidecar(path: str, sidecars_added: Sequence[str]) -> bool:
    # A case-insensitive file system finds the scan's ``IMG.XMP`` as
    # ``IMG.xmp`` too: the same file under another path.
    for sidecar in sidecars_added:
        try:
            if os.path.samefile(path, sidecar):
                return True
        except OSError:
            continue
    return False


def _add_photo_files_to_zip(
    photo: Photo, zf: zipfile.ZipFile, files_added: dict[str, str]
) -> None:
    all_files = _photo_own_files(photo) + _stacked_variant_files(photo)
    all_files.extend(_embedded_media_files(list(all_files)))
    # The sidecars the scan attached go last: one named after a media file is
    # added with that file, under a name that pairs it with the file's.
    all_files.sort(key=_is_metadata_file)

    sidecars_added: list[str] = []
    for file_obj in all_files:
        path = _zippable_path(file_obj, files_added)
        if path is None:
            continue
        if _is_metadata_file(file_obj) and _is_added_sidecar(path, sidecars_added):
            continue

        file_name = _unique_arcname(os.path.basename(path), files_added.values())
        files_added[path] = file_name

        zf.write(path, arcname=file_name)
        if not _is_metadata_file(file_obj):
            sidecars_added.extend(
                _add_sidecars_to_zip(path, file_name, zf, files_added)
            )


def _remove_partial_zip(path: str) -> None:
    try:
        os.remove(path)
    except FileNotFoundError:
        pass
    except OSError as e:
        logger.error("Could not remove partial zip %s: %s", path, e)


def _remove_abandoned_partial_zips(output_directory: str) -> None:
    """Remove the partial archives of zip jobs whose worker was killed.

    A container restart mid-archive leaves its ``.part`` behind, and
    ``delete_zip_file`` is scheduled only for a finished archive. Untouched for
    a day, it is no running job's.
    """
    cutoff = time.time() - 24 * 60 * 60
    try:
        entries = list(os.scandir(output_directory))
    except OSError:
        return
    for entry in entries:
        try:
            abandoned = entry.name.endswith(".part") and entry.stat().st_mtime < cutoff
        except OSError:
            continue
        if abandoned:
            _remove_partial_zip(entry.path)


def zip_photos_task(
    user: User, photos: list[Photo], filename: str, job_id: str
) -> str | None:
    lrj = LongRunningJob.claim(user, LongRunningJob.JOB_DOWNLOAD_PHOTOS, job_id)
    if lrj is None:
        return None
    count = len(photos)
    lrj.update_progress(current=0, target=count)
    output_directory = os.path.join(settings.MEDIA_ROOT, "zip")
    output_path = os.path.join(output_directory, filename)
    # Streamed to disk rather than built in memory, which cost the worker the
    # whole archive's size in RAM, twice. Under another name until complete,
    # so that a partial archive is never served.
    partial_path = output_path + ".part"
    try:
        if not os.path.exists(output_directory):
            os.mkdir(output_directory)
        _remove_abandoned_partial_zips(output_directory)
        files_added: dict[str, str] = {}  # Track files by path to avoid duplicates

        with zipfile.ZipFile(
            partial_path, mode="w", compression=zipfile.ZIP_DEFLATED
        ) as zf:
            for done_count, photo in enumerate(photos, start=1):
                _add_photo_files_to_zip(photo, zf, files_added)
                lrj.update_progress(current=done_count, target=count)
        os.replace(partial_path, output_path)

    except Exception as e:
        # The job's boundary: whatever went wrong, the job must end failed and
        # its partial archive go, or the client polls a job that never ends.
        logger.exception("Error while converting files to zip: %s", e)
        _remove_partial_zip(partial_path)
        # Reported as such: the client would otherwise fetch an archive that
        # is not there.
        lrj.fail(error=e)
        return None

    lrj.complete()
    # scheduling a task to delete the zip file after a day
    execution_time = timezone.now() + timedelta(days=1)
    schedule_once(
        "api.photos.zip_downloads.delete_zip_file", filename, at=execution_time
    )
    return output_path


def delete_zip_file(filename: str) -> OSError | None:
    zip_dir = os.path.realpath(os.path.join(settings.MEDIA_ROOT, "zip"))
    file_path = os.path.realpath(os.path.join(zip_dir, filename))
    if os.path.dirname(file_path) != zip_dir:
        logger.error("Refusing to delete zip outside %s: %r", zip_dir, filename)
        return None
    try:
        if not os.path.exists(file_path):
            logger.error("Error while deleting file not found at : %s", file_path)
            return None
        else:
            os.remove(file_path)
            logger.info("file deleted sucessfully at path : %s", file_path)
            return None

    except OSError as e:
        logger.error("Error while deleting file: %s", e)
        return e
