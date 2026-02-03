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
            zip_photos_task, job_id=lrj.job_id, user=user, photos=photos, filename=filename
        ).run()

    return lrj.job_id


def zip_photos_task(job_id, user, photos, filename):
    lrj = LongRunningJob.objects.get(job_id=job_id)
    lrj.start()
    count = len(photos)
    lrj.update_progress(current=0, target=count)
    output_directory = os.path.join(settings.MEDIA_ROOT, "zip")
    zip_file_name = filename
    done_count = 0
    try:
        if not os.path.exists(output_directory):
            os.mkdir(output_directory)
        mf = io.BytesIO()
        files_added = {}  # Track files by path to avoid duplicates

        for photo in photos:
            done_count = done_count + 1

            # Collect all files for this photo.
            # NOTE: main_file is not guaranteed to be included in Photo.files.
            all_files = []
            if getattr(photo, "main_file", None) is not None:
                all_files.append(photo.main_file)
            all_files.extend(list(photo.files.all()))

            # Back-compat: some datasets may still represent RAW+JPEG / Live Photo variants
            # as deprecated stacks. Include those stack members' files too.
            try:
                variant_stacks = photo.stacks.filter(
                    stack_type__in=["raw_jpeg", "live_photo"]
                ).prefetch_related("photos", "photos__files", "photos__main_file")
                for stack in variant_stacks:
                    for stack_photo in stack.photos.all():
                        if getattr(stack_photo, "main_file", None) is not None:
                            all_files.append(stack_photo.main_file)
                        all_files.extend(list(stack_photo.files.all()))
            except Exception:
                # If stacks aren't available for some reason, just proceed with variants.
                pass

            # Include embedded media variants for every collected file (not just main_file)
            for file_obj in list(all_files):
                try:
                    if file_obj and file_obj.embedded_media.exists():
                        all_files.extend(list(file_obj.embedded_media.all()))
                except Exception:
                    continue
            
            # Add each file to the zip
            for file_obj in all_files:
                if not file_obj or not file_obj.path:
                    continue
                    
                # Skip if file doesn't exist on disk
                if not os.path.exists(file_obj.path):
                    util.logger.warning(f"File not found, skipping: {file_obj.path}")
                    continue
                
                # Skip if already added (avoid duplicates)
                if file_obj.path in files_added:
                    continue
                
                file_name = os.path.basename(file_obj.path)
                
                # Handle duplicate filenames in the zip
                if file_name in files_added.values():
                    # Find a unique name by prepending a counter
                    counter = 1
                    base_name, ext = os.path.splitext(file_name)
                    while f"{base_name}_{counter}{ext}" in files_added.values():
                        counter += 1
                    file_name = f"{base_name}_{counter}{ext}"
                
                files_added[file_obj.path] = file_name
                
                with zipfile.ZipFile(mf, mode="a", compression=zipfile.ZIP_DEFLATED) as zf:
                    zf.write(file_obj.path, arcname=file_name)
            
            lrj.update_progress(current=done_count, target=count)
        
        with open(os.path.join(output_directory, zip_file_name), "wb") as output_file:
            output_file.write(mf.getvalue())

    except Exception as e:
        util.logger.error(f"Error while converting files to zip: {e}")

    lrj.complete()
    # scheduling a task to delete the zip file after a day
    execution_time = timezone.now() + timezone.timedelta(days=1)
    schedule("api.all_tasks.delete_zip_file", filename, next_run=execution_time)
    return os.path.join(output_directory, zip_file_name)


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
