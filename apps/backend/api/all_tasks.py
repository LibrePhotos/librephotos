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
        photos_name = {}

        for photo in photos:
            done_count = done_count + 1
            photo_name = os.path.basename(photo.main_file.path)
            if photo_name in photos_name:
                photos_name[photo_name] = photos_name[photo_name] + 1
                photo_name = str(photos_name[photo_name]) + "-" + photo_name
            else:
                photos_name[photo_name] = 1
            with zipfile.ZipFile(mf, mode="a", compression=zipfile.ZIP_DEFLATED) as zf:
                zf.write(photo.main_file.path, arcname=photo_name)
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
