import io
import os
import zipfile

from django.conf import settings
from django.utils import timezone
from django_q.tasks import AsyncTask, schedule

from api import util
from api.models.long_running_job import LongRunningJob


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
        util.logger.warning(f"File not found, skipping: {file_obj.path}")
        return None
    if file_obj.path in files_added:
        return None
    return file_obj.path


def _add_photo_files_to_zip(photo, mf, files_added):
    all_files = _photo_own_files(photo) + _stacked_variant_files(photo)
    all_files.extend(_embedded_media_files(list(all_files)))

    for file_obj in all_files:
        path = _zippable_path(file_obj, files_added)
        if path is None:
            continue

        file_name = _unique_arcname(os.path.basename(path), files_added.values())
        files_added[path] = file_name

        with zipfile.ZipFile(mf, mode="a", compression=zipfile.ZIP_DEFLATED) as zf:
            zf.write(path, arcname=file_name)


def zip_photos_task(job_id, user, photos, filename):
    lrj = LongRunningJob.objects.get(job_id=job_id)
    lrj.start()
    count = len(photos)
    lrj.update_progress(current=0, target=count)
    output_directory = os.path.join(settings.MEDIA_ROOT, "zip")
    output_path = os.path.join(output_directory, filename)
    try:
        if not os.path.exists(output_directory):
            os.mkdir(output_directory)
        mf = io.BytesIO()
        files_added = {}  # Track files by path to avoid duplicates

        for done_count, photo in enumerate(photos, start=1):
            _add_photo_files_to_zip(photo, mf, files_added)
            lrj.update_progress(current=done_count, target=count)

        with open(output_path, "wb") as output_file:
            output_file.write(mf.getvalue())

    except Exception as e:
        util.logger.error(f"Error while converting files to zip: {e}")

    lrj.complete()
    # scheduling a task to delete the zip file after a day
    execution_time = timezone.now() + timezone.timedelta(days=1)
    schedule("api.all_tasks.delete_zip_file", filename, next_run=execution_time)
    return output_path


def delete_zip_file(filename):
    file_path = os.path.join(settings.MEDIA_ROOT, "zip", filename)
    try:
        if not os.path.exists(file_path):
            util.logger.error(f"Error while deleting file not found at : {file_path}")
            return
        else:
            os.remove(file_path)
            util.logger.info(f"file deleted sucessfully at path : {file_path}")
            return

    except Exception as e:
        util.logger.error(f"Error while deleting file: {e}")
        return e
