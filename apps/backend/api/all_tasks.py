import logging
import os
import time
import uuid
import zipfile

from django.conf import settings
from django.utils import timezone
from django_q.tasks import AsyncTask, schedule

from api.models.long_running_job import LongRunningJob

logger = logging.getLogger(__name__)


def zip_file_name(file_uuid, user_id):
    """Name of the archive a download job writes: ``<uuid><user id>.zip``.

    ``file_uuid`` comes from the client on the delete and serve routes, so it
    must be a canonical UUID. Returns ``None`` otherwise, which keeps a crafted
    value from naming a path outside the zip directory or another user's
    archive (``<uuid>1`` + user ``2`` would otherwise reach user ``12``'s file).
    """
    try:
        canonical = str(uuid.UUID(str(file_uuid)))
    except (ValueError, TypeError, AttributeError):
        return None
    if canonical != str(file_uuid).lower():
        return None
    return f"{canonical}{int(user_id)}.zip"


def create_download_job(job_type, user, photos, filename):
    lrj = LongRunningJob.create_job(
        user=user,
        job_type=job_type,
    )
    if job_type == LongRunningJob.JOB_DOWNLOAD_PHOTOS:
        AsyncTask(
            zip_photos_task,
            job_id=lrj.job_id,
            user=user,
            photos=photos,
            filename=filename,
        ).run()

    return lrj.job_id


def _photo_own_files(photo):
    # NOTE: main_file is not guaranteed to be included in Photo.files.
    files = []
    if getattr(photo, "main_file", None) is not None:
        files.append(photo.main_file)
    files.extend(list(photo.files.all()))
    return files


def _stacked_variant_files(photo):
    # Back-compat: some datasets may still represent RAW+JPEG / Live Photo variants
    # as deprecated stacks. Include those stack members' files too.
    files = []
    try:
        variant_stacks = photo.stacks.filter(
            stack_type__in=["raw_jpeg", "live_photo"]
        ).prefetch_related("photos", "photos__files", "photos__main_file")
        for stack in variant_stacks:
            for stack_photo in stack.photos.all():
                files.extend(_photo_own_files(stack_photo))
    except Exception:
        # If stacks aren't available for some reason, just proceed with variants.
        pass
    return files


def _embedded_media_files(files):
    embedded = []
    for file_obj in files:
        try:
            if file_obj and file_obj.embedded_media.exists():
                embedded.extend(list(file_obj.embedded_media.all()))
        except Exception:
            continue
    return embedded


def _unique_arcname(file_name, taken_names):
    if file_name not in taken_names:
        return file_name
    base_name, ext = os.path.splitext(file_name)
    counter = 1
    while f"{base_name}_{counter}{ext}" in taken_names:
        counter += 1
    return f"{base_name}_{counter}{ext}"


def _zippable_path(file_obj, files_added):
    if not file_obj or not file_obj.path:
        return None
    if not os.path.exists(file_obj.path):
        logger.warning(f"File not found, skipping: {file_obj.path}")
        return None
    if file_obj.path in files_added:
        return None
    return file_obj.path


def _add_photo_files_to_zip(photo, zf, files_added):
    all_files = _photo_own_files(photo) + _stacked_variant_files(photo)
    all_files.extend(_embedded_media_files(list(all_files)))

    for file_obj in all_files:
        path = _zippable_path(file_obj, files_added)
        if path is None:
            continue

        file_name = _unique_arcname(os.path.basename(path), files_added.values())
        files_added[path] = file_name

        zf.write(path, arcname=file_name)


def _remove_partial_zip(path):
    try:
        os.remove(path)
    except FileNotFoundError:
        pass
    except OSError as e:
        logger.error(f"Could not remove partial zip {path}: {e}")


def _remove_abandoned_partial_zips(output_directory):
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


def zip_photos_task(job_id, user, photos, filename):
    lrj = LongRunningJob.objects.get(job_id=job_id)
    lrj.start()
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
        files_added = {}  # Track files by path to avoid duplicates

        with zipfile.ZipFile(
            partial_path, mode="w", compression=zipfile.ZIP_DEFLATED
        ) as zf:
            for done_count, photo in enumerate(photos, start=1):
                _add_photo_files_to_zip(photo, zf, files_added)
                lrj.update_progress(current=done_count, target=count)
        os.replace(partial_path, output_path)

    except Exception as e:
        logger.error(f"Error while converting files to zip: {e}")
        _remove_partial_zip(partial_path)
        # Reported as such: the client would otherwise fetch an archive that
        # is not there.
        lrj.fail(error=e)
        return None

    lrj.complete()
    # scheduling a task to delete the zip file after a day
    execution_time = timezone.now() + timezone.timedelta(days=1)
    schedule("api.all_tasks.delete_zip_file", filename, next_run=execution_time)
    return output_path


def delete_zip_file(filename):
    zip_dir = os.path.realpath(os.path.join(settings.MEDIA_ROOT, "zip"))
    file_path = os.path.realpath(os.path.join(zip_dir, filename))
    if os.path.dirname(file_path) != zip_dir:
        logger.error(f"Refusing to delete zip outside {zip_dir}: {filename!r}")
        return
    try:
        if not os.path.exists(file_path):
            logger.error(f"Error while deleting file not found at : {file_path}")
            return
        else:
            os.remove(file_path)
            logger.info(f"file deleted sucessfully at path : {file_path}")
            return

    except Exception as e:
        logger.error(f"Error while deleting file: {e}")
        return e
