

import zipfile
import os
import io
import uuid
from api.models.long_running_job import LongRunningJob
from datetime import datetime
from django_q.tasks import AsyncTask
import pytz
import api.util as util
from constance import config as site_config
def create_download_job(job_type, user,photos,filename):
    job_id = uuid.uuid4()
    lrj = LongRunningJob.objects.create(
        started_by=user,
        job_id=job_id,
        queued_at=datetime.now().replace(tzinfo=pytz.utc),
        job_type=job_type,
    )
    if job_type == LongRunningJob.JOB_DOWNLOAD_PHOTOS:
        AsyncTask(zip_photos_task, job_id=job_id,user=user,photos=photos,filename=filename).run()

    lrj.save()
    return job_id


def zip_photos_task(job_id,user,photos,filename):
    # import torch
    lrj = LongRunningJob.objects.get(job_id=job_id)
    lrj.started_at = datetime.now().replace(tzinfo=pytz.utc)
    count=len(photos)
    lrj.result = {"progress": {"current": 0, "target": count}}
    lrj.save()
    # num_threads = max(1, site_config.HEAVYWEIGHT_PROCESS)
    # torch.set_num_threads(num_threads)
    # os.environ["OMP_NUM_THREADS"] = str(num_threads)
    output_directory ="/protected_media/all_zip_folder/"
    zip_file_name = filename
    done_count = 0
    # util.logger.info("Using threads: {}".format(torch.get_num_threads()))
    try:
        if not os.path.exists(output_directory):
              os.mkdir(os.path.join(output_directory))  
        mf = io.BytesIO()
        photos_name = {}
        
        for photo in photos.values():
            done_count=done_count+1
            photo_name = os.path.basename(photo.main_file.path)
            if photo_name in photos_name:
                photos_name[photo_name] = photos_name[photo_name] + 1
                photo_name = str(photos_name[photo_name]) + "-" + photo_name
            else:
                photos_name[photo_name] = 1
            with zipfile.ZipFile(
                        mf, mode="a", compression=zipfile.ZIP_DEFLATED
                    ) as zf:
                        zf.write(photo.main_file.path, arcname=photo_name)
            lrj.result = {"progress": {"current": done_count, "target": count}}
            lrj.save()
        with open(os.path.join(output_directory, zip_file_name), 'wb') as output_file:
            output_file.write(mf.getvalue())
     
    except Exception as e:
        util.logger.error("Error while converting files to zip: {}".format(e))
    

    lrj.finished_at = datetime.now().replace(tzinfo=pytz.utc)
    lrj.finished = True
    lrj.save()  
    return os.path.join(output_directory, zip_file_name)      