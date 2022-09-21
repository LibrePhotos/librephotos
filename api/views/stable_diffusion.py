import os
import uuid
from datetime import datetime

import pytz
from diffusers import StableDiffusionPipeline
from django_rq import job
from rest_framework.response import Response
from rest_framework.views import APIView
from torch import autocast

import ownphotos.settings
from api.models import LongRunningJob
from api.util import logger


@job
def generate_image(user, job_id):
    if LongRunningJob.objects.filter(job_id=job_id).exists():
        lrj = LongRunningJob.objects.get(job_id=job_id)
        lrj.started_at = datetime.now().replace(tzinfo=pytz.utc)
        lrj.save()
    else:
        lrj = LongRunningJob.objects.create(
            started_by=user,
            job_id=job_id,
            queued_at=datetime.now().replace(tzinfo=pytz.utc),
            started_at=datetime.now().replace(tzinfo=pytz.utc),
            job_type=LongRunningJob.JOB_GENERATE_AUTO_ALBUM_TITLES,
        )
        lrj.save()
    try:
        pipe = StableDiffusionPipeline.from_pretrained(
            os.path.join(ownphotos.settings.LOGS_ROOT, "/stable-diffusion-v1-4")
        )
        pipe = pipe.to("cpu")

        prompt = "a photo of an astronaut riding a horse on mars"

        with autocast("cpu"):
            image = pipe(prompt)["sample"][0]
        image.save(os.path.join(ownphotos.settings.LOGS_ROOT, "/stable-diffusion.jpg"))

        lrj.finished = True
        lrj.finished_at = datetime.now().replace(tzinfo=pytz.utc)
        lrj.save()
        logger.info("job {}: updated lrj entry to db".format(job_id))

    except Exception:
        logger.exception("An error occured")
        lrj.failed = True
        lrj.finished = True
        lrj.finished_at = datetime.now().replace(tzinfo=pytz.utc)
        lrj.save()

    return 1


class StableDiffusionView(APIView):
    def get(self, request, format=None):
        try:
            job_id = uuid.uuid4()
            generate_image.delay(request.user, job_id)
            return Response({"status": True, "job_id": job_id})
        except BaseException as e:
            logger.error(str(e))
            return Response({"status": False})
